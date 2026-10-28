import { MarkdownRenderer } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/search/contracts';
import { DEFAULT_SETTINGS, type HybridSearchSettings } from '../src/settings/model';
import { SearchModal } from '../src/ui/search/SearchModal';
import { createFile } from './support/obsidian';

const result: SearchResult = {
  path: 'notes/filename.md',
  title: 'Display title',
  score: 0.9,
  tags: ['pkm', 'notes', 'third', 'fourth', 'fifth', 'sixth'],
  aliases: [],
  snippet: 'Before **FN+D** and C++ after.',
  previewAnchors: [
    {
      kind: 'semantic',
      headingPath: 'Parent > Details',
      matchText: 'FN+D',
      charStart: null,
      charEnd: null,
    },
  ],
};
const search = vi.fn();
const cachedRead = vi.fn();
const openFile = vi.fn();
const file = createFile(result.path);
const app = {
  vault: { getAbstractFileByPath: vi.fn(() => file), cachedRead },
  metadataCache: {
    getCache: vi.fn(() => null),
    resolvedLinks: {},
    getFirstLinkpathDest: vi.fn(() => file),
  },
  workspace: { getLeaf: vi.fn(() => ({ openFile })), getLastOpenFiles: vi.fn(() => [result.path]) },
};
const makeModal = (settings: Partial<HybridSearchSettings> = {}, activePath?: string) =>
  new SearchModal(app as never, { search }, { ...DEFAULT_SETTINGS, ...settings }, vi.fn(), {
    activePath,
  });

async function query(modal: SearchModal, text = 'FN+D C++') {
  const pending = modal.getSuggestions(text);
  await vi.advanceTimersByTimeAsync(150);
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  search.mockResolvedValue([result]);
  cachedRead.mockResolvedValue('FN+D and C++');
});
afterEach(() => vi.useRealTimers());

describe('modal snippets', () => {
  const matrix = [false, true].flatMap((showResultSnippets) =>
    [false, true].flatMap((showMeta) =>
      [false, true].flatMap((showPreview) =>
        [false, true].map((scrollToSnippet) => ({
          showResultSnippets,
          showMeta,
          showPreview,
          scrollToSnippet,
        })),
      ),
    ),
  );
  it.each(matrix)('keeps request and display consumers independent: %j', async (settings) => {
    const modal = makeModal(settings);
    const results = await query(modal);
    const needContext =
      settings.showResultSnippets || (settings.showPreview && settings.scrollToSnippet);
    expect(search).toHaveBeenLastCalledWith(
      'FN+D C++',
      expect.objectContaining({ snippetLength: needContext ? 400 : 0, anchors: needContext }),
    );
    expect(results).toEqual([result]);
    const render = vi.spyOn(MarkdownRenderer, 'render');
    const row = createDiv();
    modal.renderSuggestion(result, row);
    expect(!!row.querySelector('.hybrid-search-excerpt')).toBe(settings.showResultSnippets);
    expect(!!row.querySelector('.hybrid-search-meta')).toBe(settings.showMeta);
    expect(row.querySelector('.hybrid-search-score')?.textContent).toBe('0.90');
    expect(cachedRead).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    if (settings.showResultSnippets) {
      expect([...row.querySelectorAll('mark')].map((el) => el.textContent)).toEqual([
        'FN+D',
        'C++',
      ]);
      expect(row.querySelector('.hybrid-search-excerpt-section')?.textContent).toBe('Details · ');
    }
    modal.onClose();
  });

  it.each(['hybrid', 'semantic', 'fulltext', 'title'] as const)(
    'preserves %s mode and filters while requesting context',
    async (mode) => {
      const modal = makeModal({
        showResultSnippets: true,
        defaultMode: mode,
        defaultSearchFilters: '-tag:archive',
        customPostfixes: [{ name: 'work', filters: 'folder:notes' }],
      });
      await query(modal, 'FN+D @work');
      expect(search).toHaveBeenLastCalledWith(
        'FN+D',
        expect.objectContaining({
          mode,
          scope: 'notes',
          tag: '-archive',
          snippetLength: 400,
          anchors: true,
        }),
      );
    },
  );

  it.each([false, true])(
    'shows every tag with snippets %s, including the filtered tag',
    async (showResultSnippets) => {
      const modal = makeModal({ showResultSnippets, showMeta: true });
      await query(modal, 'FN+D #sixth');
      const row = createDiv();
      modal.renderSuggestion(result, row);
      const meta = row.querySelector<HTMLElement>('.hybrid-search-meta')!;
      expect(meta.querySelector('.hybrid-search-meta-path')?.textContent).toBe(
        showResultSnippets ? 'notes/filename' : 'notes',
      );
      expect(meta.title).toContain(result.path);
      expect(meta.getAttribute('aria-label')).toContain('#sixth');
      expect(
        [...meta.querySelectorAll('.hybrid-search-tag')].map((tag) => tag.textContent),
      ).toEqual(result.tags.map((tag) => `#${tag}`));
      expect(meta.querySelector('.hybrid-search-tag-overflow')).toBeNull();
      expect(row.querySelector('a.internal-link')?.getAttribute('data-href')).toBe(
        'notes/filename',
      );
      if (showResultSnippets)
        expect(row.querySelector<HTMLElement>('.hybrid-search-excerpt-section')?.title).toBe(
          'Parent > Details',
        );
    },
  );

  it('omits redundant filenames, empty metadata and empty excerpt placeholders', async () => {
    const modal = makeModal({ showResultSnippets: true, showMeta: true });
    await query(modal);
    const row = createDiv();
    modal.renderSuggestion(
      { ...result, path: 'Note.md', title: 'Note', snippet: ' ', previewAnchors: [], tags: [] },
      row,
    );
    expect(row.querySelector('.hybrid-search-meta')).toBeNull();
    expect(row.querySelector('.hybrid-search-excerpt')).toBeNull();
  });

  it('renders unsafe input as inert text, without embeds or clickable excerpt content', async () => {
    const modal = makeModal({ showResultSnippets: true });
    await query(modal, 'alert');
    const row = createDiv();
    modal.renderSuggestion(
      {
        ...result,
        snippet: '<img src=x onerror=alert(1)> [[Target|alias]] <script>alert(1)</script>',
        previewAnchors: [],
      },
      row,
    );
    const excerpt = row.querySelector('.hybrid-search-excerpt')!;
    expect(excerpt).not.toBeNull();
    expect(excerpt.querySelector('img, script, a, iframe')).toBeNull();
    expect(excerpt.textContent).toContain('alias');
  });

  it('keeps the exact normal opening action when snippets are visible', async () => {
    const modal = makeModal({ showResultSnippets: true });
    await query(modal);
    modal.onChooseSuggestion(result, new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(openFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('keeps rows intact when selection changes and forwards the original preview data', async () => {
    const modal = makeModal({ showResultSnippets: true, showPreview: true });
    await query(modal);
    const row = createDiv();
    modal.renderSuggestion(result, row);
    const child = row.firstChild;
    const preview = vi
      .spyOn(
        modal as never as { updatePreview: (...args: unknown[]) => Promise<void> },
        'updatePreview',
      )
      .mockResolvedValue();
    modal.onSelectedChange(result);
    await vi.advanceTimersByTimeAsync(110);
    expect(preview).toHaveBeenCalledExactlyOnceWith(
      result.path,
      result.snippet,
      result.previewAnchors,
      undefined,
      result,
    );
    expect(row.firstChild).toBe(child);
    row.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(110);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(1);
    modal.onClose();
  });

  it('does not add snippets or request matches for filter-only, recent or similar modes', async () => {
    const modal = makeModal({ showResultSnippets: true, showPreview: true, scrollToSnippet: true });
    await query(modal);
    await query(modal, '#pkm');
    expect(search).toHaveBeenLastCalledWith(
      '',
      expect.objectContaining({ anchors: false, snippetLength: 0 }),
    );
    const filtered = createDiv();
    modal.renderSuggestion(result, filtered);
    expect(filtered.querySelector('.hybrid-search-excerpt')).toBeNull();
    await query(modal, '');
    const recent = createDiv();
    modal.renderSuggestion(result, recent);
    expect(recent.querySelector('.hybrid-search-excerpt')).toBeNull();
    expect(recent.querySelector('.hybrid-search-score')).toBeNull();

    const similar = makeModal({ showResultSnippets: true, showPreview: false }, result.path);
    await query(similar, '@similar');
    expect(search).toHaveBeenLastCalledWith(
      '',
      expect.objectContaining({ notePath: result.path, anchors: false, snippetLength: 0 }),
    );
    const similarRow = createDiv();
    similar.renderSuggestion(result, similarRow);
    expect(similarRow.querySelector('.hybrid-search-excerpt')).toBeNull();
  });

  it('reads updated display settings on the next query without replacing the client', async () => {
    const settings = { ...DEFAULT_SETTINGS, showResultSnippets: false };
    const modal = new SearchModal(app as never, { search }, settings, vi.fn());
    await query(modal);
    settings.showResultSnippets = true;
    await query(modal);
    expect(search).toHaveBeenLastCalledWith('FN+D C++', expect.objectContaining({ anchors: true }));
    const row = createDiv();
    modal.renderSuggestion(result, row);
    expect(row.querySelector('.hybrid-search-excerpt')).not.toBeNull();
  });

  it.each([false, true])(
    'preserves similar-note preview requests with snippets=%s',
    async (showResultSnippets) => {
      const modal = makeModal(
        { showResultSnippets, showPreview: true, scrollToSnippet: true },
        result.path,
      );
      await query(modal, '@similar');
      expect(search).toHaveBeenLastCalledWith(
        '',
        expect.objectContaining({ notePath: result.path, anchors: true, snippetLength: 400 }),
      );
      const row = createDiv();
      modal.renderSuggestion(result, row);
      expect(row.querySelector('.hybrid-search-excerpt')).toBeNull();
    },
  );

  it('refreshes an open modal once after a setting change and preserves selection by path', async () => {
    const modal = makeModal({ showResultSnippets: true });
    document.body.appendChild(modal.containerEl);
    modal.inputEl.value = 'FN+D';
    const other = { ...result, path: 'other.md' };
    const chooser = {
      values: [result, other],
      selectedItem: 1,
      setSuggestions: vi.fn(),
      setSelectedItem: vi.fn(),
    };
    Object.assign(modal, { chooser });
    search.mockResolvedValue([other, result]);
    const refresh = modal.refreshResultSnippets();
    await vi.advanceTimersByTimeAsync(150);
    await refresh;
    expect(search).toHaveBeenCalledOnce();
    expect(chooser.setSuggestions).toHaveBeenCalledExactlyOnceWith([other, result]);
    expect(chooser.setSelectedItem).toHaveBeenCalledWith(0, expect.any(KeyboardEvent));
    modal.containerEl.remove();
  });

  it('does not publish a display refresh after close or a newer query', async () => {
    for (const close of [false, true]) {
      const modal = makeModal({ showResultSnippets: true });
      document.body.appendChild(modal.containerEl);
      modal.inputEl.value = 'FN+D';
      const chooser = {
        values: [result],
        selectedItem: 0,
        setSuggestions: vi.fn(),
        setSelectedItem: vi.fn(),
      };
      Object.assign(modal, { chooser });
      const refresh = modal.refreshResultSnippets();
      if (close) modal.onClose();
      else void modal.getSuggestions('newer');
      await vi.advanceTimersByTimeAsync(150);
      await refresh;
      expect(chooser.setSuggestions).not.toHaveBeenCalled();
      modal.containerEl.remove();
    }
  });
});
