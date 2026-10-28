import { MarkdownRenderer } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchAnchor, SearchResult } from '../src/search/contracts';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { SearchModal } from '../src/ui/search/SearchModal';
import { createFile } from './support/obsidian';

type Internals = {
  previewEl?: HTMLElement;
  currentMode: string;
  currentQueryWords: string[];
  currentAnchorKey?: string;
  updatePreview(
    path: string,
    snippet?: string,
    anchors?: MatchAnchor[],
    primary?: number,
  ): Promise<void>;
  scheduleSnippetScroll(target: HTMLElement): void;
};
const file = createFile('note.md');
const anchor: MatchAnchor = {
  kind: 'semantic',
  headingPath: null,
  matchText: 'alpha beta C++ FN+D foo_bar',
  charStart: null,
  charEnd: null,
};
const result: SearchResult = {
  path: file.path,
  title: 'Note',
  score: 0.9,
  tags: [],
  aliases: [],
  snippet: anchor.matchText,
  previewAnchors: [anchor],
};
const search = vi.fn();
const cachedRead = vi.fn();
const app = {
  vault: { getAbstractFileByPath: () => file, cachedRead },
  metadataCache: { getCache: () => null, resolvedLinks: {} },
  workspace: { getLastOpenFiles: () => [] },
};
let modal: SearchModal;
let internals: Internals;
let html: string;
let settings: typeof DEFAULT_SETTINGS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  html = '<p>alpha beta C++ FN+D foo_bar</p>';
  cachedRead.mockResolvedValue(anchor.matchText);
  search.mockResolvedValue([result]);
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _source, el) => {
    el.innerHTML = html;
  });
  settings = {
    ...DEFAULT_SETTINGS,
    showPreview: true,
    scrollToSnippet: true,
    showPreviewMeta: false,
  };
  modal = new SearchModal(app as never, { search }, settings, vi.fn());
  internals = modal as unknown as Internals;
  internals.currentQueryWords = ['alpha'];
});
afterEach(() => {
  modal.onClose();
  modal.containerEl.remove();
  vi.useRealTimers();
});

describe('preview context and DOM scroll edges', () => {
  it('updates words and mode on the same anchor without rereading or rendering Markdown', async () => {
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    const preview = internals.previewEl!;
    const paragraph = preview.querySelector('p');
    expect(preview.querySelector('.hybrid-search-word-match')?.textContent).toBe('alpha');
    internals.currentQueryWords = ['beta'];
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    expect(preview.querySelector('.hybrid-search-word-match')?.textContent).toBe('beta');
    internals.currentMode = 'title';
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    expect(
      preview.querySelector('.hybrid-search-word-match,.hybrid-search-semantic-match'),
    ).toBeNull();
    expect(preview.querySelector('p')).toBe(paragraph);
    expect(cachedRead).toHaveBeenCalledOnce();
    expect(MarkdownRenderer.render).toHaveBeenCalledOnce();
  });

  it('clears and restores highlighting when scroll is toggled on the same result', async () => {
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    settings.scrollToSnippet = false;
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    expect(
      internals.previewEl!.querySelector('.hybrid-search-semantic-match,.hybrid-search-word-match'),
    ).toBeNull();
    settings.scrollToSnippet = true;
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    expect(internals.previewEl!.querySelector('.hybrid-search-semantic-match')).not.toBeNull();
    expect(MarkdownRenderer.render).toHaveBeenCalledOnce();
  });

  it('finds rendered semantic anchors containing Markdown and link aliases', async () => {
    html = '<p>A <strong>bold</strong> <a>alias</a> passage.</p>';
    internals.currentMode = 'semantic';
    await internals.updatePreview(file.path, undefined, [
      { ...anchor, matchText: 'A **bold** [[Note|alias]] passage.' },
    ]);
    expect(internals.previewEl!.querySelector('.hybrid-search-semantic-match')?.textContent).toBe(
      'A bold alias passage.',
    );
  });

  it('uses literal technical query terms in preview highlights', async () => {
    const pending = modal.getSuggestions('C++ FN+D foo_bar');
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    expect(
      [...internals.previewEl!.querySelectorAll('.hybrid-search-word-match')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['C++', 'FN+D', 'foo_bar']);
  });

  it('removes preview and graph when the latest search has no results', async () => {
    document.body.appendChild(modal.containerEl);
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    const graph = { hide: vi.fn(), unload: vi.fn() };
    Object.assign(modal, { graphPanel: graph });
    search.mockResolvedValue([]);
    const pending = modal.getSuggestions('missing');
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(internals.previewEl).toBeUndefined();
    expect(graph.hide).toHaveBeenCalled();
  });

  it('repositions a delayed DOM target, then cancels old scrolls on a newer query', async () => {
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    const preview = internals.previewEl!,
      target = preview.querySelector('p')!;
    let position = 180;
    vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(() => ({ top: 0 }) as DOMRect);
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => ({ top: position - preview.scrollTop }) as DOMRect,
    );
    internals.scheduleSnippetScroll(target);
    await vi.advanceTimersByTimeAsync(150);
    expect(preview.scrollTop).toBe(164);
    position = 320;
    await vi.advanceTimersByTimeAsync(250);
    expect(preview.scrollTop).toBe(304);
    internals.scheduleSnippetScroll(target);
    void modal.getSuggestions('new query');
    preview.scrollTop = 20;
    await vi.advanceTimersByTimeAsync(400);
    expect(preview.scrollTop).toBe(20);
  });

  it('does not scroll a detached target or after the setting is disabled', async () => {
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    const preview = internals.previewEl!,
      target = preview.querySelector('p')!;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);
    internals.scheduleSnippetScroll(target);
    settings.scrollToSnippet = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(preview.scrollTop).toBe(0);
    settings.scrollToSnippet = true;
    internals.scheduleSnippetScroll(target);
    target.remove();
    await vi.advanceTimersByTimeAsync(400);
    expect(preview.scrollTop).toBe(0);
  });

  it('falls back from an out-of-range primary index without throwing', async () => {
    await expect(
      internals.updatePreview(file.path, result.snippet, [anchor], 9),
    ).resolves.toBeUndefined();
    expect(internals.previewEl!.querySelector('.hybrid-search-semantic-match')).not.toBeNull();
  });

  it('moves to another occurrence when only the source offset changes', async () => {
    const filler = 'other text '.repeat(40);
    html = `<p>alpha</p><p>${filler}</p><p>alpha</p>`;
    const content = `alpha\n\n${filler}\n\nalpha`;
    cachedRead.mockResolvedValue(content);
    const first = { ...anchor, matchText: 'alpha', charStart: 0 };
    await internals.updatePreview(file.path, undefined, [first]);
    const paragraphs = internals.previewEl!.querySelectorAll('p');
    expect(paragraphs[0]!.classList.contains('hybrid-search-semantic-match')).toBe(true);
    await internals.updatePreview(file.path, undefined, [
      { ...first, charStart: content.lastIndexOf('alpha') },
    ]);
    expect(paragraphs[0]!.classList.contains('hybrid-search-semantic-match')).toBe(false);
    expect(paragraphs[2]!.classList.contains('hybrid-search-semantic-match')).toBe(true);
    expect(MarkdownRenderer.render).toHaveBeenCalledOnce();
  });

  it('finds a callout passage across source whitespace and inline formatting', async () => {
    html =
      '<div class="callout"><div class="callout-content"><p>alpha <strong>beta</strong></p></div></div>';
    internals.currentMode = 'semantic';
    await internals.updatePreview(file.path, undefined, [
      { ...anchor, matchText: 'alpha\n **beta**' },
    ]);
    expect(internals.previewEl!.querySelector('.hybrid-search-semantic-match')?.textContent).toBe(
      'alpha beta',
    );
  });

  it('locates a backend anchor clipped inside a wiki-link using its source line', async () => {
    html = '<ul><li>Read alias;</li></ul>';
    cachedRead.mockResolvedValue('- Read [[Folder/Long note title|alias]];');
    internals.currentMode = 'semantic';
    await internals.updatePreview(file.path, undefined, [
      { ...anchor, matchText: 'note title|alias]];' },
    ]);
    expect(internals.previewEl!.querySelector('.hybrid-search-semantic-match')?.textContent).toBe(
      'Read alias;',
    );
  });

  it('does not clear the current preview when a superseded request resolves empty', async () => {
    await internals.updatePreview(file.path, result.snippet, [anchor]);
    const preview = internals.previewEl;
    let resolveOld!: (value: SearchResult[]) => void;
    search.mockImplementationOnce(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const old = modal.getSuggestions('old');
    await vi.advanceTimersByTimeAsync(150);
    const current = modal.getSuggestions('new');
    await vi.advanceTimersByTimeAsync(150);
    await current;
    resolveOld([]);
    await old;
    expect(internals.previewEl).toBe(preview);
    expect(preview!.isConnected).toBe(true);
  });
});
