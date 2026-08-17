import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { findInlineSearchTrigger, InlineSearchSuggest } from '../src/ui/InlineSearchSuggest';
import { PANEL_OWNER_ATTR } from '../src/ui/strayPanels';

describe('findInlineSearchTrigger', () => {
  it('finds the last trigger before the cursor', () => {
    expect(findInlineSearchTrigger('alpha ;;project tag:work', ';;')).toEqual({
      ch: 6,
      query: 'project tag:work',
    });
  });

  it('allows empty query immediately after the trigger', () => {
    expect(findInlineSearchTrigger(';;', ';;')).toEqual({ ch: 0, query: '' });
  });

  it('ignores escaped triggers', () => {
    expect(findInlineSearchTrigger('\\;;literal', ';;')).toBeNull();
  });

  it('returns null when no trigger is present', () => {
    expect(findInlineSearchTrigger('plain text', ';;')).toBeNull();
  });

  it('supports custom triggers', () => {
    expect(findInlineSearchTrigger('note ::semantic', '::')).toEqual({
      ch: 5,
      query: 'semantic',
    });
  });
});

describe('InlineSearchSuggest @similar', () => {
  function createSuggest(activeFile: { path: string } | null, search: ReturnType<typeof vi.fn>) {
    const app = {
      workspace: { getActiveFile: () => activeFile },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
      settings: { ...DEFAULT_SETTINGS },
      client: { search },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);
    return suggest as unknown as {
      runSearch: (query: string, requestId: number) => Promise<unknown[]>;
    };
  }

  it('sends notePath when the query uses @sim', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const suggest = createSuggest({ path: 'Now/Today.md' }, search);

    await suggest.runSearch('@sim #system/meta', 0);

    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ notePath: 'Now/Today.md', tag: 'system/meta' }),
    );
  });

  it('does not search when @sim has no active note', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const suggest = createSuggest(null, search);

    const suggestions = await suggest.runSearch('@sim', 0);

    expect(search).not.toHaveBeenCalled();
    expect(suggestions).toEqual([{ kind: 'status', message: 'Open a note to use @similar.' }]);
  });
});

describe('InlineSearchSuggest preview panel', () => {
  afterEach(() => {
    activeDocument.querySelectorAll('.hybrid-search-inline-preview').forEach((el) => el.remove());
  });

  it('stamps its body-level preview with the plugin id so the sweep can scope by instance', () => {
    const app = {
      workspace: { getActiveFile: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn() },
      manifest: { id: 'hybrid-search-beta' },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never) as unknown as {
      ensurePreview: () => void;
      previewWrapEl?: HTMLElement;
    };

    suggest.ensurePreview();

    expect(suggest.previewWrapEl?.getAttribute(PANEL_OWNER_ATTR)).toBe('hybrid-search-beta');
  });

  it('close settles a pending debounced search without contacting the backend', async () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const app = {
      workspace: { getActiveFile: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      client: { search },
      manifest: { id: 'hybrid-search' },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);
    let settled: unknown;
    void suggest.getSuggestions({ query: 'target' } as never).then((value) => {
      settled = value;
    });

    suggest.close();
    vi.runAllTimers();
    await Promise.resolve();

    expect(settled).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('settles a superseded debounce and only searches the newest inline query', async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue([]);
    const app = {
      workspace: { getActiveFile: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      client: { search },
      manifest: { id: 'hybrid-search' },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);

    const superseded = suggest.getSuggestions({ query: 'first' } as never);
    const current = suggest.getSuggestions({ query: 'second' } as never);
    vi.runAllTimers();

    await expect(superseded).resolves.toEqual([]);
    await expect(current).resolves.toEqual([
      { kind: 'status', message: 'No results. Try another query or add filters.' },
    ]);
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith('second', expect.any(Object));
    vi.useRealTimers();
  });

  it('close removes the preview and disconnects observers when renderer unload fails', () => {
    const slDisconnect = vi.fn();
    const observers: Array<[{ disconnect: () => void }, string]> = [];
    const app = {
      workspace: { getActiveFile: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
      plugins: { plugins: { 'supercharged-links-obsidian': { observers } } },
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn() },
      manifest: { id: 'hybrid-search' },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never) as unknown as {
      close: () => void;
      previewRenderer?: { unload: () => void };
      previewWrapEl?: HTMLElement;
      previewEl?: HTMLElement;
      selectedObserver?: { disconnect: () => void };
      renderedContainer?: HTMLElement;
      slWatch: { ownerId?: string; id: string };
    };
    const failure = new Error('renderer unload failed');
    const wrapper = activeDocument.body.createDiv('hybrid-search-inline-preview');
    const selectedDisconnect = vi.fn();
    suggest.previewRenderer = {
      unload: vi.fn(() => {
        throw failure;
      }),
    };
    suggest.previewWrapEl = wrapper;
    suggest.previewEl = wrapper.createDiv();
    suggest.selectedObserver = { disconnect: selectedDisconnect };
    suggest.renderedContainer = activeDocument.createDiv();
    const watchKey = `${suggest.slWatch.ownerId}:${suggest.slWatch.id}`;
    observers.push([{ disconnect: slDisconnect }, watchKey]);

    expect(() => suggest.close()).toThrow(failure);

    expect(activeDocument.body.contains(wrapper)).toBe(false);
    expect(suggest.previewRenderer).toBeUndefined();
    expect(suggest.previewWrapEl).toBeUndefined();
    expect(suggest.previewEl).toBeUndefined();
    expect(selectedDisconnect).toHaveBeenCalledOnce();
    expect(suggest.selectedObserver).toBeUndefined();
    expect(suggest.renderedContainer).toBeUndefined();
    expect(slDisconnect).toHaveBeenCalledOnce();
    expect(observers).toHaveLength(0);
  });

  it('close still unhooks Supercharged Links when the selection observer fails', () => {
    const failure = new Error('selection observer failed');
    const slDisconnect = vi.fn();
    const observers: Array<[{ disconnect: () => void }, string]> = [];
    const app = {
      workspace: { getActiveFile: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
      plugins: { plugins: { 'supercharged-links-obsidian': { observers } } },
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn() },
      manifest: { id: 'hybrid-search' },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never) as unknown as {
      close: () => void;
      selectedObserver?: { disconnect: () => void };
      renderedContainer?: HTMLElement;
      slWatch: { ownerId?: string; id: string };
    };
    suggest.selectedObserver = {
      disconnect: vi.fn(() => {
        throw failure;
      }),
    };
    suggest.renderedContainer = activeDocument.createDiv();
    const watchKey = `${suggest.slWatch.ownerId}:${suggest.slWatch.id}`;
    observers.push([{ disconnect: slDisconnect }, watchKey]);

    expect(() => suggest.close()).toThrow(failure);

    expect(suggest.selectedObserver).toBeUndefined();
    expect(suggest.renderedContainer).toBeUndefined();
    expect(slDisconnect).toHaveBeenCalledOnce();
    expect(observers).toHaveLength(0);
  });
});
