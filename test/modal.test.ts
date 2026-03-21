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

const mockOpenFile = vi.fn();
const mockGetLeaf = vi.fn().mockReturnValue({ openFile: mockOpenFile });
const mockGetLastOpenFiles = vi.fn().mockReturnValue([]);
const mockApp = {
  workspace: { getLeaf: mockGetLeaf, getLastOpenFiles: mockGetLastOpenFiles },
  vault: {
    adapter: { getBasePath: () => '/vault' },
    cachedRead: mockCachedRead,
    getAbstractFileByPath: mockGetAbstractFileByPath,
  },
  metadataCache: { getCache: mockGetCache, resolvedLinks: {} },
};

const sampleResult: SearchResult = {
  path: 'notes/pkm/zettelkasten.md',
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
    modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
  });

  it('constructs without throwing', () => {
    expect(modal).toBeDefined();
  });

  it('getSuggestions returns empty for blank query', async () => {
    const results = await modal.getSuggestions('');
    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('getSuggestions passes mode from query operator', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('semantic: zettel');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith(
      'zettel',
      expect.objectContaining({ mode: 'semantic' }),
    );
    vi.useRealTimers();
  });

  it('getSuggestions passes default mode when no operator', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith(
      'zettel',
      expect.objectContaining({ mode: DEFAULT_SETTINGS.defaultMode }),
    );
    vi.useRealTimers();
  });

  it('getSuggestions passes limit from query operator', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel limit:5');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith('zettel', expect.objectContaining({ limit: 5 }));
    vi.useRealTimers();
  });

  it('getSuggestions passes tag from query operator', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel tag:pkm');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith('zettel', expect.objectContaining({ tag: 'pkm' }));
    vi.useRealTimers();
  });

  it('getSuggestions passes scope from folder: operator', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel folder:notes');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith('zettel', expect.objectContaining({ scope: 'notes' }));
    vi.useRealTimers();
  });

  it('getSuggestions passes rerank from @rerank operator', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel @rerank');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith('zettel', expect.objectContaining({ rerank: true }));
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
    expect(link?.getAttribute('data-href')).toBe('notes/pkm/zettelkasten');
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

  it('renderSuggestion does not show tags when showMeta is false', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-meta')).toBeNull();
  });

  it('renderSuggestion shows meta line when showMeta is true', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient as never,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = document.createElement('div');
    modalWithMeta.renderSuggestion(sampleResult, el);
    const meta = el.querySelector('.hybrid-search-meta');
    expect(meta).not.toBeNull();
  });

  it('renderSuggestion meta line contains folder path', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient as never,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = document.createElement('div');
    modalWithMeta.renderSuggestion(sampleResult, el);
    const path = el.querySelector('.hybrid-search-meta-path');
    expect(path?.textContent).toBe('notes/pkm');
  });

  it('renderSuggestion meta line contains tags', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient as never,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = document.createElement('div');
    modalWithMeta.renderSuggestion(sampleResult, el);
    const tags = el.querySelectorAll('.hybrid-search-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]?.textContent).toBe('#pkm');
  });

  it('renderSuggestion meta line shows no tags when result has no tags', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient as never,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = document.createElement('div');
    modalWithMeta.renderSuggestion({ ...sampleResult, tags: [] }, el);
    expect(el.querySelectorAll('.hybrid-search-tag')).toHaveLength(0);
  });

  it('renderSuggestion falls back to path when title is empty', () => {
    const el = document.createElement('div');
    modal.renderSuggestion({ ...sampleResult, title: '' }, el);
    expect(el.querySelector('.hybrid-search-name')?.textContent).toBe(sampleResult.path);
  });

  it('onChooseSuggestion opens note in workspace', () => {
    modal.onChooseSuggestion(sampleResult, new MouseEvent('click'));
    expect(mockGetLeaf).toHaveBeenCalledWith(false);
    expect(mockOpenFile).toHaveBeenCalledWith(expect.objectContaining({ path: sampleResult.path }));
  });
});

type ModalInternals = {
  updatePreview: (path: string) => Promise<void>;
  onSelectedChange: (result: SearchResult | null) => void;
  previewEl: HTMLElement | undefined;
  previewChild: { unload: () => void } | undefined;
  currentPreviewPath: string | undefined;
  hidePreviewPanel(): void;
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
    modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
  });

  it('renderSuggestion does not render snippet element', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-snippet')).toBeNull();
  });

  it('updatePreview creates previewEl appended to document.body on first call', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(internals.previewEl).toBeDefined();
    expect(document.body.contains(internals.previewEl ?? null)).toBe(true);
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

  it('onClose unloads previewChild and removes previewEl from DOM', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    const child = internals.previewChild!;
    const previewEl = internals.previewEl!;
    const unloadSpy = vi.spyOn(child, 'unload');
    modal.onClose();
    expect(unloadSpy).toHaveBeenCalled();
    expect(document.body.contains(previewEl)).toBe(false);
  });

  it('onSelectedChange calls updatePreview for the selected result', () => {
    // Assign a mock directly (vi.spyOn requires the property to exist first)
    const updateMock = vi.fn();
    const internals = modal as unknown as ModalInternals;
    internals.updatePreview = updateMock;
    internals.onSelectedChange(sampleResult);
    expect(updateMock).toHaveBeenCalledWith(sampleResult.path);
  });

  it('updatePreview is skipped when showPreview is false', async () => {
    const modalNoPreview = new SearchModal(
      mockApp as never,
      mockClient as never,
      { ...DEFAULT_SETTINGS, showPreview: false },
      vi.fn(),
    );
    const internals = modalNoPreview as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(mockRender).not.toHaveBeenCalled();
    expect(internals.previewEl).toBeUndefined();
  });

  it('onSelectedChange is skipped when showPreview is false', () => {
    const modalNoPreview = new SearchModal(
      mockApp as never,
      mockClient as never,
      { ...DEFAULT_SETTINGS, showPreview: false },
      vi.fn(),
    );
    const updateMock = vi.fn();
    const internals = modalNoPreview as unknown as ModalInternals;
    internals.updatePreview = updateMock;
    internals.onSelectedChange(sampleResult);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('hidePreviewPanel removes previewEl and resets state', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(internals.previewEl).toBeDefined();
    const capturedEl = internals.previewEl!;
    internals.hidePreviewPanel();
    expect(internals.previewEl).toBeUndefined();
    expect(internals.previewChild).toBeUndefined();
    // currentPreviewPath must be reset so re-enabling preview triggers a fresh render
    expect(internals.currentPreviewPath).toBeUndefined();
    expect(document.body.contains(capturedEl)).toBe(false);
  });

  it('hidePreviewPanel is idempotent — safe to call twice', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    internals.hidePreviewPanel();
    expect(() => internals.hidePreviewPanel()).not.toThrow();
  });
});

describe('SearchModal — default behavior (S-102)', () => {
  const activeFilePath = 'notes/current.md';
  const relatedResult: SearchResult = {
    path: 'notes/related.md',
    title: 'Related Note',
    score: 0.9,
    tags: [],
    aliases: [],
  };
  const sourceResult: SearchResult = {
    path: activeFilePath,
    title: 'Current Note',
    score: 1.0,
    tags: [],
    aliases: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([relatedResult]);
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(new TFile(), { path: relatedResult.path }),
    );
    mockGetCache.mockReturnValue(null);
    mockGetLastOpenFiles.mockReturnValue([]);
  });

  it('getSuggestions with empty query and activePath calls search in semantic similarity mode', async () => {
    vi.useFakeTimers();
    const modal = new SearchModal(
      mockApp as never,
      mockClient as never,
      DEFAULT_SETTINGS,
      vi.fn(),
      activeFilePath,
    );
    const promise = modal.getSuggestions('');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith('', {
      notePath: activeFilePath,
    });
    vi.useRealTimers();
  });

  it('getSuggestions with empty query and activePath excludes the source note from results', async () => {
    mockSearch.mockResolvedValue([sourceResult, relatedResult]);
    vi.useFakeTimers();
    const modal = new SearchModal(
      mockApp as never,
      mockClient as never,
      DEFAULT_SETTINGS,
      vi.fn(),
      activeFilePath,
    );
    const promise = modal.getSuggestions('');
    vi.runAllTimers();
    const results = await promise;
    expect(results.every((r) => r.path !== activeFilePath)).toBe(true);
    expect(results).toHaveLength(1);
    vi.useRealTimers();
  });

  it('getSuggestions with activePath falls back to BFS when semantic returns empty', async () => {
    // First call (notePath/semantic) returns [], second call (related/BFS) returns result
    mockSearch.mockResolvedValueOnce([]).mockResolvedValueOnce([relatedResult]);
    vi.useFakeTimers();
    const modal = new SearchModal(
      mockApp as never,
      mockClient as never,
      DEFAULT_SETTINGS,
      vi.fn(),
      activeFilePath,
    );
    const promise = modal.getSuggestions('');
    vi.runAllTimers();
    const results = await promise;
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe(relatedResult.path);
    expect(mockSearch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('getSuggestions with empty query and no activePath returns recent files without server call', async () => {
    mockGetLastOpenFiles.mockReturnValue(['notes/a.md', 'notes/b.md']);
    mockGetAbstractFileByPath.mockImplementation((p: string) =>
      Object.assign(new TFile(), { path: p, extension: 'md' }),
    );
    const modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(mockSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0]?.path).toBe('notes/a.md');
    expect(results[1]?.path).toBe('notes/b.md');
  });

  it('getSuggestions recent files filters out non-markdown files', async () => {
    mockGetLastOpenFiles.mockReturnValue(['notes/a.md', 'notes/img.png']);
    mockGetAbstractFileByPath.mockImplementation((p: string) => {
      const ext = p.endsWith('.png') ? 'png' : 'md';
      return Object.assign(new TFile(), { path: p, extension: ext });
    });
    const modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('notes/a.md');
  });

  it('getSuggestions recent files filters out paths not found in vault', async () => {
    mockGetLastOpenFiles.mockReturnValue(['notes/exists.md', 'notes/gone.md']);
    mockGetAbstractFileByPath.mockImplementation((p: string) =>
      p === 'notes/exists.md' ? Object.assign(new TFile(), { path: p, extension: 'md' }) : null,
    );
    const modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('notes/exists.md');
  });

  it('getSuggestions recent files caps at RECENT_FILES_LIMIT', async () => {
    const manyPaths = Array.from({ length: 50 }, (_, i) => `notes/note-${i}.md`);
    mockGetLastOpenFiles.mockReturnValue(manyPaths);
    mockGetAbstractFileByPath.mockImplementation((p: string) =>
      Object.assign(new TFile(), { path: p, extension: 'md' }),
    );
    const modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('renderSuggestion hides score when in recent mode', async () => {
    mockGetLastOpenFiles.mockReturnValue(['notes/a.md']);
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(new TFile(), { path: 'notes/a.md', extension: 'md' }),
    );
    const modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    const el = document.createElement('div');
    modal.renderSuggestion(results[0]!, el);
    expect(el.querySelector('.hybrid-search-score')).toBeNull();
  });

  it('renderSuggestion shows score after a real search query', async () => {
    vi.useFakeTimers();
    const modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS, vi.fn());
    const promise = modal.getSuggestions('zettel');
    vi.runAllTimers();
    await promise;
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-score')).not.toBeNull();
    vi.useRealTimers();
  });
});
