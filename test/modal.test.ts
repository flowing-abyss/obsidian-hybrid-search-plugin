import { MarkdownRenderer } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchAnchor, SearchResult } from '../src/search/contracts';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { SearchModal } from '../src/ui/search/SearchModal';
import { BODY_PANEL_CLASSES, PANEL_OWNER_ATTR } from '../src/ui/shared/strayPanels';
import { createFile } from './support/obsidian';

const mockSearch = vi.fn();
const mockClient = { search: mockSearch };

const mockGetCache = vi.fn().mockReturnValue(null);
const mockCachedRead = vi.fn().mockResolvedValue('# Note Content\n\nSome body text.');
const mockGetAbstractFileByPath = vi.fn();
// eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
const mockRender = vi.fn<typeof MarkdownRenderer.render>();

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
      Object.assign(createFile(), { path: sampleResult.path }),
    );
    mockRender.mockImplementation((_app, source, el) => {
      el.textContent = source;
      return Promise.resolve();
    });
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(mockRender);
    modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
  });

  it('constructs without throwing', () => {
    expect(modal).toBeDefined();
  });

  it('getSuggestions returns empty for blank query', async () => {
    const results = await modal.getSuggestions('');
    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('onClose settles and cancels a debounced search before it reaches the backend', async () => {
    vi.useFakeTimers();
    const pending = modal.getSuggestions('zettel');

    modal.onClose();
    vi.runAllTimers();

    await expect(pending).resolves.toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('settles a superseded debounce and only searches the newest query', async () => {
    vi.useFakeTimers();
    const superseded = modal.getSuggestions('first');
    const current = modal.getSuggestions('second');

    vi.runAllTimers();

    await expect(superseded).resolves.toEqual([]);
    await expect(current).resolves.toEqual([sampleResult]);
    expect(mockSearch).toHaveBeenCalledOnce();
    expect(mockSearch).toHaveBeenCalledWith('second', expect.any(Object));
    vi.useRealTimers();
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

  it('getSuggestions sends notePath when the query uses @sim', async () => {
    mockSearch.mockResolvedValue([]);
    const simModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      activePath: 'Now/Today.md',
    });
    vi.useFakeTimers();
    const promise = simModal.getSuggestions('@sim #system/meta');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ notePath: 'Now/Today.md', tag: 'system/meta' }),
    );
    vi.useRealTimers();
  });

  it('getSuggestions does not search when @sim has no active note', async () => {
    mockSearch.mockResolvedValue([]);
    const simModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    vi.useFakeTimers();
    const promise = simModal.getSuggestions('@sim');
    vi.runAllTimers();
    const results = await promise;
    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(simModal.emptyStateText).toBe('Open a note to use @similar.');
    vi.useRealTimers();
  });

  it('getSuggestions resets the @similar message on the next query', async () => {
    mockSearch.mockResolvedValue([]);
    const simModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    vi.useFakeTimers();
    await simModal.getSuggestions('@sim');
    const promise = simModal.getSuggestions('zettel');
    vi.runAllTimers();
    await promise;
    expect(simModal.emptyStateText).not.toBe('Open a note to use @similar.');
    vi.useRealTimers();
  });

  it('getSuggestions resets the @similar message when the query is cleared', async () => {
    mockSearch.mockResolvedValue([]);
    const simModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    vi.useFakeTimers();
    await simModal.getSuggestions('@sim');
    await simModal.getSuggestions('');
    expect(simModal.emptyStateText).not.toBe('Open a note to use @similar.');
    vi.useRealTimers();
  });

  it('getSuggestions resets the @similar message when falling back to similar-to-active', async () => {
    mockSearch.mockResolvedValue([]);
    const simModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      activePath: 'Now/Today.md',
    });
    vi.useFakeTimers();
    // Force the "no target" branch even though a snapshot exists: an unresolvable note ref.
    (simModal as unknown as { emptyStateText: string }).emptyStateText =
      'Open a note to use @similar.';
    const promise = simModal.getSuggestions('');
    vi.runAllTimers();
    await promise;
    expect(simModal.emptyStateText).not.toBe('Open a note to use @similar.');
    vi.useRealTimers();
  });

  it('getSuggestions does not highlight leftover query words when @sim is active', async () => {
    mockSearch.mockResolvedValue([]);
    const simModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      activePath: 'Now/Today.md',
    });
    vi.useFakeTimers();
    const promise = simModal.getSuggestions('@sim leftover words');
    vi.runAllTimers();
    await promise;
    expect((simModal as unknown as { currentQueryWords: string[] }).currentQueryWords).toEqual([]);
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
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-name')?.textContent).toBe('Zettelkasten');
  });

  it('renderSuggestion renders title as internal-link anchor with data-href', () => {
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link.hybrid-search-name');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('data-href')).toBe('notes/pkm/zettelkasten');
  });

  it('renderSuggestion sets data-link-* attributes and CSS vars from frontmatter', () => {
    mockGetCache.mockReturnValue({ frontmatter: { status: 'done', priority: 1 } });
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link') as HTMLElement;
    expect(link.getAttribute('data-link-status')).toBe('done');
    expect(link.getAttribute('data-link-priority')).toBe('1');
    expect(link.style.getPropertyValue('--data-link-status')).toBe('done');
    expect(link.style.getPropertyValue('--data-link-priority')).toBe('1');
  });

  it('renderSuggestion skips frontmatter keys with invalid attribute names', () => {
    mockGetCache.mockReturnValue({
      frontmatter: { 'description:"bad': 'value', valid: 'ok' },
    });
    const el = createDiv();
    expect(() => modal.renderSuggestion(sampleResult, el)).not.toThrow();
    const link = el.querySelector('a.internal-link') as HTMLElement;
    expect(link.getAttribute('data-link-valid')).toBe('ok');
  });

  it('renderSuggestion adds Supercharged Links classes', () => {
    const el = createDiv();
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
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link');
    expect(link?.hasAttribute('data-link-position')).toBe(false);
    expect(link?.hasAttribute('data-link-tags')).toBe(false);
    expect(link?.getAttribute('data-link-status')).toBe('active');
  });

  it('renderSuggestion shows score', () => {
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-score')?.textContent).toBe('0.87');
  });

  it('renderSuggestion does not show tags when showMeta is false', () => {
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-meta')).toBeNull();
  });

  it('renderSuggestion shows meta line when showMeta is true', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = createDiv();
    modalWithMeta.renderSuggestion(sampleResult, el);
    const meta = el.querySelector('.hybrid-search-meta');
    expect(meta).not.toBeNull();
  });

  it('renderSuggestion meta line contains folder path', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = createDiv();
    modalWithMeta.renderSuggestion(sampleResult, el);
    const path = el.querySelector('.hybrid-search-meta-path');
    expect(path?.textContent).toBe('notes/pkm');
  });

  it('renderSuggestion meta line contains tags', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = createDiv();
    modalWithMeta.renderSuggestion(sampleResult, el);
    const tags = el.querySelectorAll('.hybrid-search-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]?.textContent).toBe('#pkm');
  });

  it('renderSuggestion meta line shows no tags when result has no tags', () => {
    const modalWithMeta = new SearchModal(
      mockApp as never,
      mockClient,
      {
        ...DEFAULT_SETTINGS,
        showMeta: true,
      },
      vi.fn(),
    );
    const el = createDiv();
    modalWithMeta.renderSuggestion({ ...sampleResult, tags: [] }, el);
    expect(el.querySelectorAll('.hybrid-search-tag')).toHaveLength(0);
  });

  it('renderSuggestion falls back to path when title is empty', () => {
    const el = createDiv();
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
  updatePreview: (
    path: string,
    snippet?: string,
    anchors?: MatchAnchor[],
    primaryIdx?: number,
  ) => Promise<void>;
  onSelectedChange: (result: SearchResult | null) => void;
  previewEl: HTMLElement | undefined;
  previewMetaEl: HTMLElement | undefined;
  previewChild: { unload: () => void } | undefined;
  currentPreviewPath: string | undefined;
  graphPanel: { unload: () => void } | undefined;
  hidePreviewPanel(): void;
};

describe('SearchModal — hover preview', () => {
  let modal: SearchModal;

  // Body-level panels outlive their modal, so sweep them even when an assertion fails midway.
  afterEach(() => {
    activeDocument
      .querySelectorAll(BODY_PANEL_CLASSES.map((cls) => `.${cls}`).join(', '))
      .forEach((el) => el.remove());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockImplementation((_app, source, el) => {
      el.textContent = source;
      return Promise.resolve();
    });
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(mockRender);
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(createFile(), { path: sampleResult.path }),
    );
    modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
  });

  it('renderSuggestion does not render snippet element', () => {
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-snippet')).toBeNull();
  });

  it('updatePreview creates previewEl appended to document.body on first call', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(internals.previewEl).toBeDefined();
    expect(activeDocument.body.contains(internals.previewEl ?? null)).toBe(true);
    expect(internals.previewEl?.classList.contains('hybrid-search-preview')).toBe(true);
    expect(internals.previewEl?.classList.contains('markdown-preview-view')).toBe(true);
    expect(internals.previewEl?.classList.contains('markdown-rendered')).toBe(true);
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

  it('discards Markdown that finishes rendering after a newer preview', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mockCachedRead.mockResolvedValueOnce('old note').mockResolvedValueOnce('new note');
    mockRender.mockImplementation(async (_app, markdown, container) => {
      if (markdown === 'old note') await blocked;
      container.createDiv({ text: markdown });
    });
    const internal = modal as unknown as ModalInternals;
    const old = internal.updatePreview('old.md');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await internal.updatePreview('new.md');
    finish();
    await old;
    expect(internal.previewEl!.textContent).toBe('new note');
  });

  it('ignores a failed read after the preview is closed', async () => {
    let reject!: (error: Error) => void;
    mockCachedRead.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const pending = (modal as unknown as ModalInternals).updatePreview('old.md');
    modal.hidePreviewPanel();
    reject(new Error('old read failed'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('unloads Markdown when the modal closes between publication and ownership', async () => {
    const cleanup = vi.fn();
    mockRender.mockImplementation(async (_app, text, el, _path, child) => {
      child.register(cleanup);
      el.createEl('p', { text });
    });
    const internals = modal as unknown as ModalInternals;
    const pending = internals.updatePreview(sampleResult.path);
    const preview = internals.previewEl!;
    const observer = new MutationObserver(() => {
      if (preview.childElementCount) modal.onClose();
    });
    observer.observe(preview, { childList: true });
    try {
      await pending;
      expect(cleanup).toHaveBeenCalledOnce();
      expect(internals.currentPreviewPath).toBeUndefined();
      expect(internals.previewChild).toBeUndefined();
      expect(preview.isConnected).toBe(false);
    } finally {
      observer.disconnect();
      modal.onClose();
    }
  });

  it('does not hide a newer preview when an older read fails', async () => {
    let reject!: (error: Error) => void;
    mockCachedRead.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const internal = modal as unknown as ModalInternals;
    const pending = internal.updatePreview('old.md');
    await internal.updatePreview('new.md');
    reject(new Error('old read failed'));
    await pending;
    expect(internal.previewEl!.style.display).not.toBe('none');
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
    expect(activeDocument.body.contains(previewEl)).toBe(false);
  });

  it('onClose notifies its owner after removing the body-level preview', async () => {
    const onDidClose = vi.fn();
    const ownedModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      onDidClose,
    });
    const internals = ownedModal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    const previewEl = internals.previewEl!;

    ownedModal.onClose();

    expect(activeDocument.body.contains(previewEl)).toBe(false);
    expect(onDidClose).toHaveBeenCalledOnce();
    expect(onDidClose).toHaveBeenCalledWith(ownedModal);
  });

  it('onClose finishes every cleanup stage when preview child unload fails', async () => {
    const failure = new Error('preview child unload failed');
    const onDidClose = vi.fn();
    const ownedModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      onDidClose,
    });
    const internals = ownedModal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    const previewEl = internals.previewEl!;
    const previewMetaEl = internals.previewMetaEl!;
    internals.previewChild = {
      unload: vi.fn(() => {
        throw failure;
      }),
    };
    const graphUnload = vi.fn();
    internals.graphPanel = { unload: graphUnload };
    ownedModal.modalEl.style.left = '12px';
    ownedModal.modalEl.style.transform = 'translateX(8px)';

    expect(() => ownedModal.onClose()).toThrow(failure);

    expect(activeDocument.body.contains(previewEl)).toBe(false);
    expect(activeDocument.body.contains(previewMetaEl)).toBe(false);
    expect(internals.previewEl).toBeUndefined();
    expect(internals.previewMetaEl).toBeUndefined();
    expect(internals.previewChild).toBeUndefined();
    expect(graphUnload).toHaveBeenCalledOnce();
    expect(internals.graphPanel).toBeUndefined();
    expect(ownedModal.modalEl.style.left).toBe('');
    expect(ownedModal.modalEl.style.transform).toBe('');
    expect(onDidClose).toHaveBeenCalledOnce();
  });

  it('stamps its body-level panels with the owner id so the sweep can scope by instance', async () => {
    const ownedModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      ownerId: 'hybrid-search-beta',
    });
    const internals = ownedModal as unknown as ModalInternals;

    await internals.updatePreview(sampleResult.path);

    expect(internals.previewEl!.getAttribute(PANEL_OWNER_ATTR)).toBe('hybrid-search-beta');
    expect(internals.previewMetaEl?.getAttribute(PANEL_OWNER_ATTR)).toBe('hybrid-search-beta');
  });

  it('leaves its body-level panels unstamped when it has no owner', async () => {
    const orphanModal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    const internals = orphanModal as unknown as ModalInternals;

    await internals.updatePreview(sampleResult.path);

    expect(internals.previewEl!.hasAttribute(PANEL_OWNER_ATTR)).toBe(false);
  });

  it('onSelectedChange calls updatePreview for the selected result', () => {
    // Assign a mock directly (vi.spyOn requires the property to exist first)
    const updateMock = vi.fn();
    const internals = modal as unknown as ModalInternals;
    internals.updatePreview = updateMock;
    vi.useFakeTimers();
    internals.onSelectedChange(sampleResult);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();
    expect(updateMock).toHaveBeenCalledWith(
      sampleResult.path,
      sampleResult.snippet,
      undefined,
      undefined,
      sampleResult,
    );
  });

  it('updatePreview is skipped when showPreview is false', async () => {
    const modalNoPreview = new SearchModal(
      mockApp as never,
      mockClient,
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
      mockClient,
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
    expect(activeDocument.body.contains(capturedEl)).toBe(false);
  });

  it('hidePreviewPanel is idempotent — safe to call twice', async () => {
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    internals.hidePreviewPanel();
    expect(() => internals.hidePreviewPanel()).not.toThrow();
  });

  it('updatePreviewMeta does not throw on frontmatter keys with quotes', async () => {
    mockGetCache.mockReturnValue({
      frontmatter: { 'description:"bad': 'value', valid: 'ok' },
    });
    const internals = modal as unknown as ModalInternals;
    await internals.updatePreview(sampleResult.path);
    expect(() =>
      (modal as unknown as { updatePreviewMeta(p: string): void }).updatePreviewMeta(
        sampleResult.path,
      ),
    ).not.toThrow();
  });

  it('updatePreview scrolls to snippet for semantic heading breadcrumbs', async () => {
    mockCachedRead.mockResolvedValue('# Section A\n\nbody text here\n\n# Section B\n\nmore text');
    const modalWithScroll = new SearchModal(
      mockApp as never,
      mockClient,
      { ...DEFAULT_SETTINGS, showPreview: true, scrollToSnippet: true },
      vi.fn(),
    );
    await (modalWithScroll as unknown as ModalInternals).updatePreview(
      sampleResult.path,
      'Section A > Sub\nbody text here',
    );
    expect(mockRender).toHaveBeenCalled();
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
      Object.assign(createFile(), { path: relatedResult.path }),
    );
    mockGetCache.mockReturnValue(null);
    mockGetLastOpenFiles.mockReturnValue([]);
  });

  it('getSuggestions with empty query and activePath calls search in semantic similarity mode', async () => {
    vi.useFakeTimers();
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      activePath: activeFilePath,
    });
    const promise = modal.getSuggestions('');
    vi.runAllTimers();
    await promise;
    expect(mockSearch).toHaveBeenCalledWith('', {
      limit: DEFAULT_SETTINGS.similarNotesBottomLimit + 1,
      notePath: activeFilePath,
    });
    vi.useRealTimers();
  });

  it('getSuggestions with empty query and activePath excludes the source note from results', async () => {
    mockSearch.mockResolvedValue([sourceResult, relatedResult]);
    vi.useFakeTimers();
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      activePath: activeFilePath,
    });
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
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn(), {
      activePath: activeFilePath,
    });
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
      Object.assign(createFile(), { path: p, extension: 'md' }),
    );
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(mockSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0]?.path).toBe('notes/a.md');
    expect(results[1]?.path).toBe('notes/b.md');
  });

  it('getSuggestions recent files caps at RECENT_FILES_LIMIT', async () => {
    const manyPaths = Array.from({ length: 50 }, (_, i) => `notes/note-${i}.md`);
    mockGetLastOpenFiles.mockReturnValue(manyPaths);
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('getSuggestions recent files skips deleted (non-existent) files', async () => {
    mockGetLastOpenFiles.mockReturnValue([
      'notes/existing.md',
      'notes/deleted.md',
      'notes/also-existing.md',
    ]);
    mockGetAbstractFileByPath.mockImplementation((p: string) => {
      if (p === 'notes/deleted.md') return null;
      return Object.assign(createFile(), { path: p, extension: 'md' });
    });
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.path)).not.toContain('notes/deleted.md');
  });

  it('renderSuggestion hides score when in recent mode', async () => {
    mockGetLastOpenFiles.mockReturnValue(['notes/a.md']);
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(createFile(), { path: 'notes/a.md', extension: 'md' }),
    );
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    const results = await modal.getSuggestions('');
    const el = createDiv();
    modal.renderSuggestion(results[0]!, el);
    expect(el.querySelector('.hybrid-search-score')).toBeNull();
  });

  it('renderSuggestion shows score after a real search query', async () => {
    vi.useFakeTimers();
    const modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
    const promise = modal.getSuggestions('zettel');
    vi.runAllTimers();
    await promise;
    const el = createDiv();
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-score')).not.toBeNull();
    vi.useRealTimers();
  });
});

describe('getHeadingSiblings', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(createFile(), { path: sampleResult.path }),
    );
    modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
  });

  it('returns siblings until next same-level heading', () => {
    const container = createDiv();
    const makeEl = (tag: keyof HTMLElementTagNameMap, text?: string) => {
      const el = createEl(tag);
      if (text) el.textContent = text;
      return el;
    };
    container.append(
      makeEl('h2', 'Section A'),
      makeEl('p', 'Para 1'),
      makeEl('p', 'Para 2'),
      makeEl('h3', 'Subsection'),
      makeEl('p', 'Sub para'),
      makeEl('h2', 'Section B'),
      makeEl('p', 'B para'),
    );
    const h2a = container.querySelector('h2') as HTMLElement;
    const siblings = (
      modal as unknown as {
        getHeadingSiblings(h: HTMLElement): Element[];
      }
    ).getHeadingSiblings(h2a);
    // Should include p, p, h3, p — stop at second h2
    expect(siblings.length).toBe(4);
    expect(siblings[0]!.tagName).toBe('P');
    expect(siblings[2]!.tagName).toBe('H3');
    // Should NOT include "B para"
    expect(siblings.some((el) => el.textContent?.includes('B para'))).toBe(false);
  });

  it('returns all remaining siblings when no closing heading', () => {
    const container = createDiv();
    const h2El = createEl('h2');
    h2El.textContent = 'Heading';
    const p1 = createEl('p');
    p1.textContent = 'First paragraph';
    const p2 = createEl('p');
    p2.textContent = 'Second paragraph';
    container.append(h2El, p1, p2);
    const h2 = container.querySelector('h2') as HTMLElement;
    const siblings = (
      modal as unknown as {
        getHeadingSiblings(h: HTMLElement): Element[];
      }
    ).getHeadingSiblings(h2);
    expect(siblings.length).toBe(2);
  });
});

describe('findHeadingElement', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(createFile(), { path: sampleResult.path }),
    );
    modal = new SearchModal(mockApp as never, mockClient, DEFAULT_SETTINGS, vi.fn());
  });

  it('finds leaf heading by headingPath', () => {
    const preview = createDiv();
    const h2 = createEl('h2');
    h2.textContent = 'Parent';
    const h3 = createEl('h3');
    h3.textContent = 'Child section';
    const p = createEl('p');
    p.textContent = 'Content';
    preview.append(h2, h3, p);
    (modal as unknown as { previewEl: HTMLElement }).previewEl = preview;

    const result = (
      modal as unknown as {
        findHeadingElement(hp: string | null): HTMLElement | undefined;
      }
    ).findHeadingElement('Parent > Child section');

    expect(result).toBeDefined();
    expect(result!.tagName).toBe('H3');
    expect(result!.textContent?.trim()).toBe('Child section');
  });

  it('returns undefined for null headingPath', () => {
    (modal as unknown as { previewEl: HTMLElement }).previewEl = createDiv();
    const result = (
      modal as unknown as {
        findHeadingElement(hp: string | null): HTMLElement | undefined;
      }
    ).findHeadingElement(null);
    expect(result).toBeUndefined();
  });
});

describe('anchor-based highlight', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(
      Object.assign(createFile(), { path: sampleResult.path }),
    );
    mockRender.mockImplementation((_app, source, el) => {
      el.textContent = source;
      return Promise.resolve();
    });
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(mockRender);
    modal = new SearchModal(
      mockApp as never,
      mockClient,
      { ...DEFAULT_SETTINGS, showPreview: true, scrollToSnippet: true },
      vi.fn(),
    );
  });

  it('updatePreview: same path + same anchor → no re-render', async () => {
    const anchors: MatchAnchor[] = [
      {
        kind: 'bm25',
        headingPath: 'Note > Section',
        matchText: 'some body text',
        charStart: null,
        charEnd: null,
      },
    ];

    // First call — renders
    await (
      modal as unknown as {
        updatePreview(p: string, s?: string, a?: MatchAnchor[], i?: number): Promise<void>;
      }
    ).updatePreview('notes/pkm/zettelkasten.md', 'snippet', anchors, 0);

    const renderCount1 = mockRender.mock.calls.length;

    // Second call — same path, same anchor → should NOT re-render
    await (
      modal as unknown as {
        updatePreview(p: string, s?: string, a?: MatchAnchor[], i?: number): Promise<void>;
      }
    ).updatePreview('notes/pkm/zettelkasten.md', 'snippet', anchors, 0);

    expect(mockRender.mock.calls.length).toBe(renderCount1);
  });

  it('updatePreview: same path + different anchor → re-highlights without re-render', async () => {
    const anchor1: MatchAnchor[] = [
      {
        kind: 'bm25',
        headingPath: 'Section A',
        matchText: 'first match',
        charStart: null,
        charEnd: null,
      },
    ];
    const anchor2: MatchAnchor[] = [
      {
        kind: 'bm25',
        headingPath: 'Section B',
        matchText: 'second match',
        charStart: null,
        charEnd: null,
      },
    ];

    await (
      modal as unknown as {
        updatePreview(p: string, s?: string, a?: MatchAnchor[], i?: number): Promise<void>;
      }
    ).updatePreview('notes/pkm/zettelkasten.md', 'snippet', anchor1, 0);

    const renderCount1 = mockRender.mock.calls.length;

    await (
      modal as unknown as {
        updatePreview(p: string, s?: string, a?: MatchAnchor[], i?: number): Promise<void>;
      }
    ).updatePreview('notes/pkm/zettelkasten.md', 'snippet', anchor2, 0);

    // Still same number of renders (no re-render for same path)
    expect(mockRender.mock.calls.length).toBe(renderCount1);
  });
});
