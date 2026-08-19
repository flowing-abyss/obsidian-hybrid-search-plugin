import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import {
  applySuperchargedLinkAttributes,
  createInternalLink,
  fetchSimilarNotesDetailed,
  fileToDragWikiLink,
  getResultTitle,
  hookSuperchargedLinks,
  resolveSimilarTarget,
  unhookSuperchargedLinks,
} from '../src/ui/noteUtils';

const related: SearchResult = {
  path: 'related.md',
  title: 'Related',
  score: 0.84,
  tags: [],
  aliases: [],
};

describe('noteUtils', () => {
  it('fetchSimilarNotesDetailed returns semantic results without source note', async () => {
    const search = vi.fn().mockResolvedValue([{ ...related, path: 'source.md' }, related]);

    const result = await fetchSimilarNotesDetailed({ search }, 'source.md', {
      limit: 5,
      threshold: 0,
    });

    expect(search).toHaveBeenCalledWith('', { notePath: 'source.md', limit: 6 });
    expect(result.scoreMode).toBe('similarity');
    expect(result.results).toEqual([related]);
  });

  it('fetchSimilarNotesDetailed falls back to structural related search', async () => {
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([related]);

    const result = await fetchSimilarNotesDetailed({ search }, 'source.md', {
      limit: 3,
      threshold: 0,
    });

    expect(search).toHaveBeenNthCalledWith(1, '', {
      notePath: 'source.md',
      limit: 4,
    });
    expect(search).toHaveBeenNthCalledWith(2, 'source.md', { related: true, limit: 4 });
    expect(result.scoreMode).toBe('structural');
    expect(result.results).toEqual([related]);
  });

  it('fetchSimilarNotesDetailed passes threshold to semantic search and does not fall back to structural notes', async () => {
    const search = vi.fn().mockResolvedValueOnce([]);

    const result = await fetchSimilarNotesDetailed({ search }, 'source.md', {
      limit: 3,
      threshold: 0.7,
    });

    expect(search).toHaveBeenCalledWith('', {
      notePath: 'source.md',
      limit: 4,
      threshold: 0.7,
    });
    expect(result.scoreMode).toBe('similarity');
    expect(result.results).toEqual([]);
  });

  it('fileToDragWikiLink uses Obsidian fileToLinktext when available', () => {
    const file = Object.assign(new TFile(), { path: 'folder/target.md' });
    const app = {
      vault: { getAbstractFileByPath: () => file },
      metadataCache: {
        fileToLinktext: vi.fn().mockReturnValue('target'),
      },
    };

    expect(fileToDragWikiLink(app as never, 'folder/target.md', 'source.md')).toBe('[[target]]');
    expect(app.metadataCache.fileToLinktext).toHaveBeenCalledWith(file, 'source.md', true);
  });

  it('applySuperchargedLinkAttributes copies scalar frontmatter values', () => {
    const app = {
      metadataCache: {
        getCache: () => ({
          frontmatter: {
            type: 'book',
            rating: 5,
            archived: false,
            tags: ['skip'],
            position: 'skip',
          },
        }),
      },
    };
    const link = activeDocument.createEl('a');

    applySuperchargedLinkAttributes(app as never, link, 'note.md');

    expect(link.getAttribute('data-link-type')).toBe('book');
    expect(link.getAttribute('data-link-rating')).toBe('5');
    expect(link.getAttribute('data-link-archived')).toBe('false');
    expect(link.hasAttribute('data-link-tags')).toBe(false);
    expect(link.hasAttribute('data-link-position')).toBe(false);
  });

  it('getResultTitle falls back from empty title to filename', () => {
    const app = { metadataCache: { getCache: () => null } };
    expect(getResultTitle(app as never, { path: 'folder/Fallback.md', title: '' })).toBe(
      'Fallback',
    );
  });

  it('createInternalLink drag payload omits unescaped html', () => {
    const app = {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const parent = activeDocument.createDiv();
    const link = createInternalLink(app as never, parent, 'weird "note".md', 'Weird', 'test-link');
    const payloads = new Map<string, string>();
    const event = new Event('dragstart') as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        effectAllowed: '',
        setData: (type: string, value: string) => payloads.set(type, value),
      },
    });

    link.dispatchEvent(event);

    expect(payloads.get('text/plain')).toBe('[[weird "note"]]');
    expect(payloads.get('text/markdown')).toBe('[[weird "note"]]');
    expect(payloads.has('text/html')).toBe(false);
  });

  it('createInternalLink uses Obsidian-style link href without md extension', () => {
    const app = {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const parent = activeDocument.createDiv();
    const link = createInternalLink(
      app as never,
      parent,
      'folder/target.md',
      'Target',
      'test-link',
    );

    expect(link.getAttribute('href')).toBe('folder/target');
    expect(link.getAttribute('data-href')).toBe('folder/target');
  });
});

describe('resolveSimilarTarget', () => {
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (linktext: string) =>
        linktext === 'Zettelkasten' ? { path: 'Areas/Zettelkasten.md' } : null,
    },
  } as unknown as App;

  it('returns the active path for an active target', () => {
    expect(resolveSimilarTarget(app, { kind: 'active' }, 'Now/Today.md', '')).toBe('Now/Today.md');
  });

  it('returns null when there is no active file', () => {
    expect(resolveSimilarTarget(app, { kind: 'active' }, undefined, '')).toBeNull();
  });

  it('resolves a wikilink through the metadata cache', () => {
    expect(resolveSimilarTarget(app, { kind: 'note', ref: 'Zettelkasten' }, undefined, '')).toBe(
      'Areas/Zettelkasten.md',
    );
  });

  it('falls back to the raw ref when Obsidian cannot resolve it', () => {
    expect(resolveSimilarTarget(app, { kind: 'note', ref: 'Areas/PKM.md' }, undefined, '')).toBe(
      'Areas/PKM.md',
    );
  });
});

describe('supercharged-links watch scoping', () => {
  function appWithSl() {
    const observers: Array<[{ disconnect: () => void }, string]> = [];
    const app = {
      plugins: {
        plugins: {
          'supercharged-links-obsidian': {
            observers,
            _watchContainerDynamic: (watchKey: string) => {
              observers.push([{ disconnect: vi.fn() }, watchKey]);
            },
          },
        },
      },
    } as unknown as App;
    return { app, observers };
  }

  const container = () => activeDocument.createDiv();

  it('namespaces the watch key with the owner id', () => {
    const { app, observers } = appWithSl();

    hookSuperchargedLinks(app, { ownerId: 'hybrid-search', id: 'panel' }, container(), 'a', 'row');

    expect(observers.map(([, key]) => key)).toEqual(['hybrid-search:panel']);
  });

  it('falls back to the bare id when no owner is known', () => {
    const { app, observers } = appWithSl();

    hookSuperchargedLinks(app, { ownerId: undefined, id: 'panel' }, container(), 'a', 'row');

    expect(observers.map(([, key]) => key)).toEqual(['panel']);
  });

  it('unhooking one copy leaves another copy of the same container watching', () => {
    const { app, observers } = appWithSl();
    hookSuperchargedLinks(app, { ownerId: 'hybrid-search', id: 'panel' }, container(), 'a', 'row');
    hookSuperchargedLinks(
      app,
      { ownerId: 'hybrid-search-beta', id: 'panel' },
      container(),
      'a',
      'row',
    );

    unhookSuperchargedLinks(app, { ownerId: 'hybrid-search', id: 'panel' });

    expect(observers.map(([, key]) => key)).toEqual(['hybrid-search-beta:panel']);
  });

  it('unhooks several watches in one call', () => {
    const { app, observers } = appWithSl();
    const own = { ownerId: 'hybrid-search', id: 'panel' };
    const meta = { ownerId: 'hybrid-search', id: 'meta' };
    hookSuperchargedLinks(app, own, container(), 'a', 'row');
    hookSuperchargedLinks(app, meta, container(), 'a', 'row');

    unhookSuperchargedLinks(app, own, meta);

    expect(observers).toEqual([]);
  });

  it('disconnects the observer it removes', () => {
    const { app, observers } = appWithSl();
    const watch = { ownerId: 'hybrid-search', id: 'panel' };
    hookSuperchargedLinks(app, watch, container(), 'a', 'row');
    const disconnect = observers[0]![0].disconnect;

    unhookSuperchargedLinks(app, watch);

    expect(disconnect).toHaveBeenCalled();
  });

  it('continues removing owned observers when one disconnect throws', () => {
    const { app, observers } = appWithSl();
    const own = { ownerId: 'hybrid-search', id: 'panel' };
    const foreign = { ownerId: 'hybrid-search-beta', id: 'panel' };
    hookSuperchargedLinks(app, own, container(), 'a', 'row');
    const failure = new Error('disconnect failed');
    observers.push([
      {
        disconnect: vi.fn(() => {
          throw failure;
        }),
      },
      'hybrid-search:panel',
    ]);
    hookSuperchargedLinks(app, foreign, container(), 'a', 'row');
    const firstOwnDisconnect = observers[0]![0].disconnect;

    expect(() => unhookSuperchargedLinks(app, own)).toThrow(failure);

    expect(firstOwnDisconnect).toHaveBeenCalledOnce();
    expect(observers.map(([, key]) => key)).toEqual(['hybrid-search-beta:panel']);
  });
});
