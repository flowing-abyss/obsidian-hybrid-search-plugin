import { MarkdownRenderer, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SearchModal } from '../src/ui/SearchModal';

const mockSearch = vi.fn();
const mockClient = { search: mockSearch };

const mockGetCache = vi.fn().mockReturnValue(null);
const mockCachedRead = vi.fn().mockResolvedValue('# Note Content\n\nSome body text.');
const mockGetAbstractFileByPath = vi.fn();
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockRender = vi.mocked(MarkdownRenderer.render);

const mockApp = {
  workspace: { openLinkText: vi.fn() },
  vault: {
    adapter: { getBasePath: () => '/vault' },
    cachedRead: mockCachedRead,
    getAbstractFileByPath: mockGetAbstractFileByPath,
  },
  metadataCache: { getCache: mockGetCache },
};

const sampleResult: SearchResult = {
  path: 'notes/zettelkasten.md',
  title: 'Zettelkasten',
  score: 0.87,
  snippet: 'A method for note-taking...',
  tags: ['pkm', 'notes'],
  aliases: [],
};

describe('SearchModal', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(new TFile(), { path: sampleResult.path }),
    );
    mockRender.mockClear();
    modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS);
  });

  it('constructs without throwing', () => {
    expect(modal).toBeDefined();
  });

  it('getSuggestions returns empty for blank query', async () => {
    const results = await modal.getSuggestions('');
    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('getSuggestions calls client.search with settings options', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel');
    vi.runAllTimers();
    const results = await promise;
    expect(mockSearch).toHaveBeenCalledWith('zettel', {
      mode: DEFAULT_SETTINGS.defaultMode,
      limit: DEFAULT_SETTINGS.limit,
      snippetLength: DEFAULT_SETTINGS.snippetLength,
    });
    expect(results).toHaveLength(1);
    vi.useRealTimers();
  });

  it('getSuggestions returns empty array on client error', async () => {
    mockSearch.mockRejectedValue(new Error('connection failed'));
    vi.useFakeTimers();
    const promise = modal.getSuggestions('broken');
    vi.runAllTimers();
    const results = await promise;
    expect(results).toEqual([]);
    vi.useRealTimers();
  });

  it('renderSuggestion creates title element with note name', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-name')?.textContent).toBe('Zettelkasten');
  });

  it('renderSuggestion renders title as internal-link anchor with data-href', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link.hybrid-search-name');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('data-href')).toBe('notes/zettelkasten');
  });

  it('renderSuggestion sets data-link-* attributes and CSS vars from frontmatter', () => {
    mockGetCache.mockReturnValue({ frontmatter: { status: 'done', priority: 1 } });
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link') as HTMLElement;
    expect(link.getAttribute('data-link-status')).toBe('done');
    expect(link.getAttribute('data-link-priority')).toBe('1');
    expect(link.style.getPropertyValue('--data-link-status')).toBe('done');
    expect(link.style.getPropertyValue('--data-link-priority')).toBe('1');
  });

  it('renderSuggestion adds Supercharged Links classes', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link');
    expect(link?.classList.contains('data-link-icon')).toBe(true);
    expect(link?.classList.contains('data-link-icon-after')).toBe(true);
    expect(link?.classList.contains('data-link-text')).toBe(true);
  });

  it('renderSuggestion skips frontmatter arrays and position key', () => {
    mockGetCache.mockReturnValue({
      frontmatter: { position: {}, tags: ['a', 'b'], status: 'active' },
    });
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link');
    expect(link?.hasAttribute('data-link-position')).toBe(false);
    expect(link?.hasAttribute('data-link-tags')).toBe(false);
    expect(link?.getAttribute('data-link-status')).toBe('active');
  });

  it('renderSuggestion shows score', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-score')?.textContent).toBe('0.87');
  });

  it('renderSuggestion shows tags', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const tags = el.querySelectorAll('.hybrid-search-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]?.textContent).toBe('#pkm');
  });

  it('renderSuggestion falls back to path when title is empty', () => {
    const el = document.createElement('div');
    modal.renderSuggestion({ ...sampleResult, title: '' }, el);
    expect(el.querySelector('.hybrid-search-name')?.textContent).toBe(sampleResult.path);
  });

  it('onChooseSuggestion opens note in workspace', () => {
    modal.onChooseSuggestion(sampleResult, new MouseEvent('click'));
    expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(sampleResult.path, '', false);
  });
});

type ModalInternals = {
  updatePreview: (path: string) => Promise<void>;
  previewEl: HTMLElement | undefined;
  previewChild: { unload: () => void };
  modalEl: HTMLElement | undefined;
};

describe('SearchModal — hover preview', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(new TFile(), { path: sampleResult.path }),
    );
    modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS);
  });

  it('renderSuggestion does not render snippet element', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-snippet')).toBeNull();
  });

  it('updatePreview creates previewEl and adds hybrid-search-expanded to modalEl on first call', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(internals.previewEl).toBeDefined();
    expect(internals.modalEl?.classList.contains('hybrid-search-expanded')).toBe(true);
  });

  it('updatePreview calls MarkdownRenderer.render with correct arguments', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(mockRender).toHaveBeenCalledWith(
      mockApp,
      '# Note Content\n\nSome body text.',
      expect.any(HTMLElement),
      sampleResult.path,
      expect.any(Object),
    );
  });

  it('updatePreview skips re-render for the same path', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    await internals.updatePreview(sampleResult.path);
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it('updatePreview hides panel on cachedRead error', async () => {
    mockCachedRead.mockRejectedValue(new Error('read error'));
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(internals.previewEl?.style.display).toBe('none');
  });

  it('onClose unloads previewChild and removes hybrid-search-expanded', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    const child = internals.previewChild;
    const unloadSpy = vi.spyOn(child, 'unload');
    modal.onClose();
    expect(unloadSpy).toHaveBeenCalled();
    expect(internals.modalEl?.classList.contains('hybrid-search-expanded')).toBe(false);
  });

  it('onSelectedChange calls updatePreview for the selected result', () => {
    const updateSpy = vi.spyOn(modal as unknown, 'updatePreview').mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (modal as unknown).onSelectedChange(sampleResult);
    expect(updateSpy).toHaveBeenCalledWith(sampleResult.path);
  });
});
