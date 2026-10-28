import { MarkdownRenderer } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/search/contracts';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { InlineSearchSuggest } from '../src/ui/search/InlineSearchSuggest';
import { SearchModal } from '../src/ui/search/SearchModal';
import { SearchPanelView } from '../src/ui/search/SearchPanelView';
import { createApp, createFile, createLeaf } from './support/obsidian';

const result: SearchResult = {
  path: 'notes/example.md',
  title: 'Example',
  score: 0.9,
  tags: [],
  aliases: [],
  snippet: 'Example passage',
  matchedBy: ['title', 'semantic', 'bm25'],
};
const file = createFile(result.path);
const search = vi.fn();
const cachedRead = vi.fn();
const app = {
  vault: { getAbstractFileByPath: () => file, cachedRead },
  metadataCache: { getCache: () => null, resolvedLinks: {}, getFirstLinkpathDest: () => file },
  workspace: { getLastOpenFiles: () => [], getActiveFile: () => file },
};
let settings: typeof DEFAULT_SETTINGS;
let modal: SearchModal;

async function query(text = 'check') {
  const pending = modal.getSuggestions(text);
  await vi.advanceTimersByTimeAsync(150);
  return pending;
}
function render(value = result) {
  const row = modal.containerEl.createDiv();
  modal.renderSuggestion(value, row);
  return row;
}
function badge(row: HTMLElement) {
  return row.querySelector<HTMLElement>('.hybrid-search-match-sources');
}
async function preview(value = result) {
  modal.onSelectedChange(value);
  await vi.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  search.mockResolvedValue([result]);
  cachedRead.mockResolvedValue(result.snippet);
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
    el.createEl('p', { text: 'Example passage' });
  });
  settings = { ...DEFAULT_SETTINGS, showMatchSources: true, showPreviewMeta: true };
  modal = new SearchModal(app as never, { search }, settings, vi.fn());
  document.body.appendChild(modal.containerEl);
});
afterEach(() => {
  modal.onClose();
  modal.containerEl.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('hybrid match provenance', () => {
  it.each([false, true])('shows sources next to the score with snippets %s', async (snippets) => {
    settings.showResultSnippets = snippets;
    settings.showMeta = false;
    await query();
    const row = render();
    expect(badge(row)?.textContent).toBe('F·S·T');
    expect(badge(row)?.nextElementSibling?.classList.contains('hybrid-search-score')).toBe(true);
    expect(badge(row)?.title).toContain('title / aliases');
    expect(badge(row)?.getAttribute('aria-label')).toContain('full-text');
    expect(row.querySelector('.hybrid-search-score')?.textContent).toBe('0.90');
    expect(!!row.querySelector('.hybrid-search-excerpt')).toBe(snippets);
    expect(row.querySelector('.hybrid-search-meta')).toBeNull();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it.each([
    { evidence: { matchedBy: ['semantic', 'bm25', 'semantic', 'future'] }, want: 'F·S' },
    { evidence: { matchedBy: ['semantic'] }, want: 'S' },
    { evidence: { matchedBy: ['title'] }, want: 'T' },
    { evidence: { matchedBy: ['link', 'future'] }, want: undefined },
    { evidence: { matchedBy: [] }, want: undefined },
    {
      evidence: { matchedBy: undefined, scores: { bm25: 0, semantic: 0.6, fuzzy_title: null } },
      want: 'F·S',
    },
    {
      evidence: { matchedBy: undefined, scores: { bm25: null, semantic: null, hybrid: 0.9 } },
      want: undefined,
    },
    {
      evidence: {
        matchedBy: undefined,
        previewAnchors: [
          {
            kind: 'semantic' as const,
            headingPath: null,
            matchText: 'passage',
            charStart: 0,
            charEnd: 7,
          },
        ],
      },
      want: undefined,
    },
  ])('uses reported result channels, not excerpt hints: $want', async ({ evidence, want }) => {
    await query();
    expect(badge(render({ ...result, ...evidence }))?.textContent).toBe(want);
  });

  it.each(['check @fulltext', 'semantic: check', 'check @title', '#tag', 'check @sim', ''])(
    'omits hybrid provenance for %s',
    async (text) => {
      await query(text);
      expect(badge(render())).toBeNull();
      await preview();
      expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
    },
  );

  it('honors the effective override when the default is fulltext', async () => {
    settings.defaultMode = 'fulltext';
    await query('check');
    expect(badge(render())).toBeNull();
    await query('check @hybrid');
    expect(badge(render())?.textContent).toBe('F·S·T');
  });

  it('hides hybrid badges during a single-mode query and does not relabel retained single-mode rows', async () => {
    await query();
    const hybridRow = render();
    const fulltext = modal.getSuggestions('check @fulltext');
    expect(badge(hybridRow)).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    await fulltext;
    const fulltextRow = render();
    const hybrid = modal.getSuggestions('check @hybrid');
    settings.showMatchSources = false;
    modal.refreshMatchSources();
    settings.showMatchSources = true;
    modal.refreshMatchSources();
    expect(badge(fulltextRow)).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    await hybrid;
    expect(badge(render())?.textContent).toBe('F·S·T');
  });

  it('toggles sources without searching, replacing rows, or rendering the preview again', async () => {
    await query();
    const row = render();
    await preview();
    const paragraph = document.querySelector('.hybrid-search-preview p');
    settings.showMatchSources = false;
    modal.refreshMatchSources();
    expect(badge(row)).toBeNull();
    expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
    settings.showMatchSources = true;
    modal.refreshMatchSources();
    expect(badge(row)?.textContent).toBe('F·S·T');
    expect(document.querySelector('.hybrid-search-preview p')).toBe(paragraph);
    expect(search).toHaveBeenCalledOnce();
    expect(MarkdownRenderer.render).toHaveBeenCalledOnce();
  });

  it('does not label a retained fulltext preview while a hybrid query is pending', async () => {
    const fulltextResult = { ...result, matchedBy: ['bm25'] };
    search.mockResolvedValueOnce([fulltextResult]);
    await query('check @fulltext');
    const row = render(fulltextResult);
    await preview(fulltextResult);
    const pending = modal.getSuggestions('check @hybrid');
    await preview(fulltextResult);
    expect(badge(row)).toBeNull();
    expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
    settings.showMatchSources = false;
    modal.refreshMatchSources();
    settings.showMatchSources = true;
    modal.refreshMatchSources();
    expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    render();
    await preview();
    expect(document.querySelector('.hybrid-search-preview-match-sources')?.textContent).toBe(
      'Full-text + semantic + title / aliases',
    );
  });

  it('updates same-file preview provenance before the folder without rereading the note', async () => {
    await query();
    await preview();
    const first = document.querySelector('.hybrid-search-preview-match-sources')!;
    expect(first.textContent).toBe('Full-text + semantic + title / aliases');
    expect(
      first.nextElementSibling?.querySelector('.hybrid-search-preview-meta-folder')?.textContent,
    ).toBe('notes');
    await query('another');
    await preview({ ...result, matchedBy: ['semantic'] });
    expect(document.querySelector('.hybrid-search-preview-match-sources')?.textContent).toBe(
      'Semantic',
    );
    expect(cachedRead).toHaveBeenCalledOnce();
    expect(MarkdownRenderer.render).toHaveBeenCalledOnce();
    await query('another @fulltext');
    await preview();
    expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
  });

  it('respects hidden preview metadata and does not infer provenance when fields are absent', async () => {
    settings.showPreviewMeta = false;
    await query();
    await preview();
    expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
    expect(badge(render({ ...result, matchedBy: undefined }))).toBeNull();
  });

  it('preserves provenance when a shortcut restores the preview', async () => {
    await query();
    modal.triggerPreview(
      result.path,
      result.snippet,
      result.previewAnchors,
      result.primaryAnchorIndex,
      result,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.hybrid-search-preview-match-sources')?.textContent).toBe(
      'Full-text + semantic + title / aliases',
    );
  });

  it('does not publish provenance from a preview read cancelled by a new query', async () => {
    await query();
    let finish!: (value: string) => void;
    cachedRead.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    await preview();
    await query('check @fulltext');
    finish('Old content');
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.hybrid-search-preview-match-sources')).toBeNull();
    expect(MarkdownRenderer.render).not.toHaveBeenCalled();
  });

  it('can show provenance as the only preview metadata for a root note', async () => {
    await query();
    await preview({ ...result, path: 'example.md', matchedBy: ['semantic'] });
    expect(document.querySelector('.hybrid-search-preview-match-sources')?.textContent).toBe(
      'Semantic',
    );
    expect(
      document.querySelector<HTMLElement>('.hybrid-search-preview-meta-panel')?.style.display,
    ).not.toBe('none');
    settings.showMatchSources = false;
    modal.refreshMatchSources();
    expect(
      document.querySelector<HTMLElement>('.hybrid-search-preview-meta-panel')?.style.display,
    ).toBe('none');
  });

  it('restores metadata for the current note after selection changed while metadata was hidden', async () => {
    await query();
    await preview();
    settings.showPreviewMeta = false;
    modal.refreshMatchSources();
    await preview({ ...result, path: 'other/next.md', matchedBy: ['semantic'] });
    settings.showPreviewMeta = true;
    modal.refreshMatchSources();
    expect(document.querySelector('.hybrid-search-preview-meta-folder')?.textContent).toBe('other');
    expect(document.querySelector('.hybrid-search-preview-match-sources')?.textContent).toBe(
      'Semantic',
    );
    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(2);
  });

  it('keeps old preview metadata hidden while reading a newly selected note', async () => {
    await query();
    await preview();
    let finish!: (text: string) => void;
    cachedRead.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    await preview({ ...result, path: 'other/next.md', matchedBy: ['semantic'] });
    settings.showMatchSources = false;
    modal.refreshMatchSources();
    settings.showMatchSources = true;
    modal.refreshMatchSources();
    expect(
      document.querySelector<HTMLElement>('.hybrid-search-preview-meta-panel')?.style.display,
    ).toBe('none');
    finish('Next note');
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.hybrid-search-preview-meta-folder')?.textContent).toBe('other');
  });
});

describe('other search surfaces', () => {
  it('does not restart a pending inline preview when only a source badge changes', async () => {
    const plugin = { manifest: { id: 'hybrid-search' }, settings, client: { search } };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);
    await (
      suggest as unknown as { runSearch(text: string, id: number): Promise<unknown> }
    ).runSearch('check', 0);
    cachedRead.mockImplementation(() => new Promise(() => {}));
    const container = createDiv({ cls: 'suggestion-container' });
    const row = container.createDiv({ cls: 'suggestion-item is-selected' });
    document.body.appendChild(container);
    suggest.renderSuggestion(result, row);
    await vi.advanceTimersByTimeAsync(20);
    const reads = cachedRead.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    settings.showMatchSources = false;
    suggest.refreshMatchSources();
    await vi.advanceTimersByTimeAsync(20);
    const after = cachedRead.mock.calls.length;
    suggest.close();
    container.remove();
    expect(after).toBe(reads);
  });

  it('updates sidebar sources without resetting selection, expansion or scroll', async () => {
    const host = createApp();
    const plugin = { app: host, manifest: { id: 'hybrid-search' }, settings, client: { search } };
    const panel = new SearchPanelView(createLeaf(host), plugin as never);
    await panel.onOpen();
    const internal = panel as unknown as {
      search(text: string): Promise<void>;
      toggleResult(i: number): void;
      selectedIndex: number;
    };
    await internal.search('check');
    internal.toggleResult(0);
    const row = panel.containerEl.querySelector<HTMLElement>('.hybrid-search-panel-row')!;
    const snippet = panel.containerEl.querySelector('.hybrid-search-panel-snippet');
    const results = panel.containerEl.querySelector<HTMLElement>('.hybrid-search-panel-results')!;
    results.scrollTop = 35;
    expect(badge(row)?.textContent).toBe('F·S·T');
    settings.showMatchSources = false;
    panel.refreshMatchSources();
    expect(badge(row)).toBeNull();
    settings.showMatchSources = true;
    panel.refreshMatchSources();
    expect(badge(row)?.textContent).toBe('F·S·T');
    expect(panel.containerEl.querySelector('.hybrid-search-panel-snippet')).toBe(snippet);
    expect(internal.selectedIndex).toBe(0);
    expect(results.scrollTop).toBe(35);
    expect(search).toHaveBeenCalledOnce();
    await internal.search('check @semantic');
    expect(badge(panel.containerEl)).toBeNull();
    await internal.search('#tag');
    expect(badge(panel.containerEl)).toBeNull();
    await panel.onClose();
  });

  it('uses the effective query mode in inline suggestions, including similar lookups', async () => {
    const plugin = { manifest: { id: 'hybrid-search' }, settings, client: { search } };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);
    const internal = suggest as unknown as {
      runSearch(text: string, id: number): Promise<unknown>;
    };
    for (const [text, want] of [
      ['check', 'F·S·T'],
      ['check @fulltext', undefined],
      ['check @hybrid', 'F·S·T'],
      ['check @sim', undefined],
      ['#tag', undefined],
    ]) {
      await internal.runSearch(text!, 0);
      const row = createDiv();
      suggest.renderSuggestion(result, row);
      expect(badge(row)?.textContent).toBe(want);
    }
    suggest.close();
  });

  it('refreshes an open inline list without rerunning its search', async () => {
    settings.inlineSearchShowPreview = false;
    const plugin = { manifest: { id: 'hybrid-search' }, settings, client: { search } };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);
    await (
      suggest as unknown as { runSearch(text: string, id: number): Promise<unknown> }
    ).runSearch('check', 0);
    const container = createDiv({ cls: 'suggestion-container' });
    const row = container.createDiv({ cls: 'suggestion-item is-selected' });
    suggest.renderSuggestion(result, row);
    const title = row.querySelector('.hybrid-search-inline-name');
    settings.showMatchSources = false;
    suggest.refreshMatchSources();
    expect(badge(row)).toBeNull();
    settings.showMatchSources = true;
    suggest.refreshMatchSources();
    expect(badge(row)?.textContent).toBe('F·S·T');
    expect(row.querySelector('.hybrid-search-inline-name')).toBe(title);
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(search).toHaveBeenCalledOnce();
    suggest.close();
  });
});
