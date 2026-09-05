import { App, HoverPopover, TFile, type HoverParent } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { DEFAULT_SETTINGS } from '../src/settings';
import { PagePreviewSimilarNotesManager } from '../src/ui/PagePreviewSimilarNotes';

const related: SearchResult = {
  path: 'related.md',
  title: 'Related',
  score: 0.82,
  snippet: 'Relevant context from the related note.',
  tags: [],
  aliases: [],
};

function createHarness(search = vi.fn().mockResolvedValue([related])) {
  const app = new App();
  let hoverCallback: ((payload: unknown) => void) | undefined;
  const workspaceOn = app.workspace.on as unknown as ReturnType<typeof vi.fn>;
  workspaceOn.mockImplementation((eventName: string, callback: (payload: unknown) => void) => {
    if (eventName === 'hover-link') hoverCallback = callback;
    return {};
  });
  app.metadataCache.getFirstLinkpathDest = vi
    .fn()
    .mockReturnValue(Object.assign(new TFile(), { path: 'target.md', extension: 'md' }));
  const plugin = {
    manifest: { id: 'hybrid-search' },
    settings: { ...DEFAULT_SETTINGS, showSimilarNotesInPagePreview: true },
    client: { search },
  };
  const manager = new PagePreviewSimilarNotesManager(app, plugin as never);
  manager.load();
  return {
    app,
    manager,
    plugin,
    search,
    emitHover(
      hoverParent: HoverParent,
      targetEl: HTMLElement,
      linktext = 'target',
      sourcePath: string | null = 'source.md',
    ) {
      const payload = {
        event: new MouseEvent('mouseover', { ctrlKey: true }),
        source: 'markdown',
        hoverParent,
        targetEl,
        linktext,
      };
      hoverCallback?.(sourcePath === null ? payload : { ...payload, sourcePath });
    },
  };
}

function createLivePopover(targetEl: HTMLElement): {
  hoverParent: HoverParent;
  popover: HoverPopover;
} {
  const hoverParent: HoverParent = { hoverPopover: null };
  const popover = new HoverPopover(hoverParent, targetEl);
  activeDocument.body.appendChild(popover.hoverEl);
  popover.load();
  return { hoverParent, popover };
}

describe('PagePreviewSimilarNotesManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(activeWindow, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(activeWindow, 'innerHeight', { value: 768, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    activeDocument
      .querySelectorAll('.popover.hover-popover')
      .forEach((element) => element.remove());
  });

  it('does nothing while the feature is disabled', () => {
    const harness = createHarness();
    harness.plugin.settings.showSimilarNotesInPagePreview = false;
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent } = createLivePopover(targetEl);

    harness.emitHover(hoverParent, targetEl);
    vi.runAllTimers();

    expect(harness.search).not.toHaveBeenCalled();
    expect(activeDocument.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    harness.manager.unload();
    targetEl.remove();
  });

  it('resolves heading and block hover links using their file path', () => {
    const harness = createHarness();
    const resolver = vi.fn((linktext: string, sourcePath: string) => {
      if (linktext === 'Folder/Target.md' && sourcePath === 'source.md') {
        return Object.assign(new TFile(), { path: 'Folder/Target.md', extension: 'md' });
      }
      return null;
    });
    harness.app.metadataCache.getFirstLinkpathDest = resolver;
    const targetEl = activeDocument.body.createDiv();
    const hoverParent: HoverParent = { hoverPopover: null };

    harness.emitHover(hoverParent, targetEl, 'Folder/Target.md#Overview');
    harness.emitHover(hoverParent, targetEl, 'Folder/Target.md^summary-block');

    expect(resolver).toHaveBeenNthCalledWith(1, 'Folder/Target.md', 'source.md');
    expect(resolver).toHaveBeenNthCalledWith(2, 'Folder/Target.md', 'source.md');
    harness.manager.unload();
    targetEl.remove();
  });

  it('resolves a directory-qualified hover link without a source path', () => {
    const harness = createHarness();
    const resolver = vi.fn((linktext: string, sourcePath: string) => {
      if (linktext === 'Folder/Target.md' && sourcePath === '') {
        return Object.assign(new TFile(), { path: 'Folder/Target.md', extension: 'md' });
      }
      return null;
    });
    harness.app.metadataCache.getFirstLinkpathDest = resolver;
    const targetEl = activeDocument.body.createDiv();
    const hoverParent: HoverParent = { hoverPopover: null };

    expect(() => {
      harness.emitHover(hoverParent, targetEl, 'Folder/Target.md', null);
    }).not.toThrow();

    expect(resolver).toHaveBeenCalledWith('Folder/Target.md', '');
    harness.manager.unload();
    targetEl.remove();
  });

  it('attaches hidden content to the native popover and renders live results', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    const companion = popover.hoverEl.querySelector<HTMLElement>(
      '.hybrid-search-page-preview-similar',
    );
    expect(companion).not.toBeNull();
    expect(companion?.hidden).toBe(true);

    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();

    expect(companion?.hidden).toBe(false);
    expect(
      companion?.querySelector('.hybrid-search-page-preview-similar-heading')?.textContent,
    ).toBe('Similar notes');
    expect(companion?.querySelector('.hybrid-search-similar-note-link')?.textContent).toBe(
      'Related',
    );
    expect(companion?.querySelector('.tree-item-flair')?.textContent).toBe('0.82');
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      true,
    );

    harness.manager.unload();
    targetEl.remove();
  });

  it('removes the hidden companion when no similar notes exist', async () => {
    const harness = createHarness(vi.fn().mockResolvedValue([]));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);

    harness.emitHover(hoverParent, targetEl);
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );
    harness.manager.unload();
    targetEl.remove();
  });

  it('removes the hidden companion when loading fails', async () => {
    const harness = createHarness(vi.fn().mockRejectedValue(new Error('offline')));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);

    harness.emitHover(hoverParent, targetEl);
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    harness.manager.unload();
    targetEl.remove();
  });

  it('attaches only one companion when a popover emits repeated hover events', async () => {
    const harness = createHarness();
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);

    harness.emitHover(hoverParent, targetEl);
    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelectorAll('.hybrid-search-page-preview-similar')).toHaveLength(1);
    harness.manager.unload();
    targetEl.remove();
  });

  it('removes a live companion when the feature is disabled', async () => {
    const harness = createHarness();
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).not.toBeNull();

    harness.plugin.settings.showSimilarNotesInPagePreview = false;
    harness.manager.settingsChanged();

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );
    harness.manager.unload();
    targetEl.remove();
  });

  it('cancels a pending attachment when the feature is disabled', () => {
    const harness = createHarness();
    const targetEl = activeDocument.body.createDiv();
    const hoverParent: HoverParent = { hoverPopover: null };

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(150);
    harness.plugin.settings.showSimilarNotesInPagePreview = false;
    harness.manager.settingsChanged();
    const popover = new HoverPopover(hoverParent, targetEl);
    activeDocument.body.appendChild(popover.hoverEl);
    popover.load();
    vi.runAllTimers();

    expect(harness.search).not.toHaveBeenCalled();
    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    harness.manager.unload();
    targetEl.remove();
  });

  it('ignores a result that arrives after manager unload', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);

    harness.manager.unload();
    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );
    targetEl.remove();
  });

  it('waits for Obsidian to assign the native popover', async () => {
    const harness = createHarness();
    const targetEl = activeDocument.body.createDiv();
    const hoverParent: HoverParent = { hoverPopover: null };

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    const popover = new HoverPopover(hoverParent, targetEl);
    activeDocument.body.appendChild(popover.hoverEl);
    popover.load();
    vi.advanceTimersByTime(25);
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).not.toBeNull();
    expect(harness.search).toHaveBeenCalled();
    harness.manager.unload();
    targetEl.remove();
  });

  it('waits through Obsidian native 300 ms page preview delay', async () => {
    const harness = createHarness();
    const targetEl = activeDocument.body.createDiv();
    const hoverParent: HoverParent = { hoverPopover: null };

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(299);
    const popover = new HoverPopover(hoverParent, targetEl);
    activeDocument.body.appendChild(popover.hoverEl);
    popover.load();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).not.toBeNull();
    expect(harness.search).toHaveBeenCalled();
    harness.manager.unload();
    targetEl.remove();
  });

  it('keeps only the latest hover attempt for a shared hover parent', async () => {
    const harness = createHarness();
    harness.app.metadataCache.getFirstLinkpathDest = vi.fn((linktext: string) =>
      Object.assign(new TFile(), { path: `${linktext}.md`, extension: 'md' }),
    );
    const firstTargetEl = activeDocument.body.createDiv();
    const secondTargetEl = activeDocument.body.createDiv();
    const hoverParent: HoverParent = { hoverPopover: null };

    harness.emitHover(hoverParent, firstTargetEl, 'first');
    vi.advanceTimersByTime(100);
    harness.emitHover(hoverParent, secondTargetEl, 'second');
    vi.advanceTimersByTime(199);
    const popover = new HoverPopover(hoverParent, secondTargetEl);
    activeDocument.body.appendChild(popover.hoverEl);
    popover.load();
    vi.advanceTimersByTime(101);
    await Promise.resolve();
    await Promise.resolve();

    expect(popover.hoverEl.querySelectorAll('.hybrid-search-page-preview-similar')).toHaveLength(1);
    expect(harness.search).toHaveBeenCalledTimes(1);
    expect(harness.search).toHaveBeenCalledWith('', {
      limit: harness.plugin.settings.similarNotesPagePreviewLimit + 1,
      notePath: 'second.md',
    });
    harness.manager.unload();
    firstTargetEl.remove();
    secondTargetEl.remove();
  });

  it('deduplicates concurrent requests for the same previewed note', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const firstTarget = activeDocument.body.createDiv();
    const secondTarget = activeDocument.body.createDiv();
    const first = createLivePopover(firstTarget);
    const second = createLivePopover(secondTarget);

    harness.emitHover(first.hoverParent, firstTarget);
    harness.emitHover(second.hoverParent, secondTarget);
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    expect(harness.search).toHaveBeenCalledTimes(1);

    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();
    expect(first.popover.hoverEl.querySelector('.hybrid-search-similar-note-link')).not.toBeNull();
    expect(second.popover.hoverEl.querySelector('.hybrid-search-similar-note-link')).not.toBeNull();

    harness.manager.unload();
    firstTarget.remove();
    secondTarget.remove();
  });

  it('positions the rendered companion using native preview geometry', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    vi.spyOn(popover.hoverEl, 'getBoundingClientRect').mockReturnValue({
      left: 600,
      top: 300,
      right: 1200,
      bottom: 700,
      width: 600,
      height: 400,
    } as DOMRect);
    Object.defineProperty(activeWindow, 'innerWidth', { value: 1900, configurable: true });
    Object.defineProperty(activeWindow, 'innerHeight', { value: 792, configurable: true });
    vi.spyOn(activeWindow, 'getComputedStyle').mockReturnValue({
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
    } as CSSStyleDeclaration);

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    const companion = popover.hoverEl.querySelector<HTMLElement>(
      '.hybrid-search-page-preview-similar',
    )!;
    Object.defineProperty(companion, 'scrollHeight', { value: 180, configurable: true });
    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();

    expect(companion.dataset.placement).toBe('right');
    expect(companion.style.getPropertyValue('--hybrid-search-page-preview-similar-left')).toBe(
      '608px',
    );
    expect(companion.style.getPropertyValue('--hybrid-search-page-preview-similar-top')).toBe(
      '0px',
    );
    expect(companion.style.getPropertyValue('--hybrid-search-page-preview-similar-width')).toBe(
      '600px',
    );
    expect(companion.style.width).toBe('600px');
    expect(
      companion.style.getPropertyValue('--hybrid-search-page-preview-similar-max-height'),
    ).toBe('182px');
    harness.manager.unload();
    targetEl.remove();
  });

  it('keeps a below companion in place when expanding a result needs scrolling', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    vi.spyOn(popover.hoverEl, 'getBoundingClientRect').mockReturnValue({
      left: 600,
      top: 300,
      right: 1200,
      bottom: 700,
      width: 600,
      height: 400,
    } as DOMRect);
    Object.defineProperty(activeWindow, 'innerWidth', { value: 1900, configurable: true });
    Object.defineProperty(activeWindow, 'innerHeight', { value: 900, configurable: true });

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    const companion = popover.hoverEl.querySelector<HTMLElement>(
      '.hybrid-search-page-preview-similar',
    )!;
    Object.defineProperty(companion, 'scrollHeight', {
      get: () => (companion.querySelector('.search-result-file-match') ? 360 : 180),
      configurable: true,
    });
    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();
    expect(companion.dataset.placement).toBe('below');

    companion.querySelector<HTMLElement>('.collapse-icon')?.click();

    expect(companion.dataset.placement).toBe('below');
    expect(
      companion.style.getPropertyValue('--hybrid-search-page-preview-similar-max-height'),
    ).toBe('192px');
    expect(companion.querySelector('.search-result-file-match')).not.toBeNull();
    harness.manager.unload();
    targetEl.remove();
  });

  it('keeps a no-space companion hidden across repeated callbacks and restores it on resize', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    vi.spyOn(popover.hoverEl, 'getBoundingClientRect').mockReturnValue({
      left: 305,
      top: 300,
      right: 905,
      bottom: 700,
      width: 600,
      height: 400,
    } as DOMRect);
    Object.defineProperty(activeWindow, 'innerWidth', { value: 1210, configurable: true });
    Object.defineProperty(activeWindow, 'innerHeight', { value: 790, configurable: true });
    vi.spyOn(activeWindow, 'getComputedStyle').mockReturnValue({
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
    } as CSSStyleDeclaration);

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    const companion = popover.hoverEl.querySelector<HTMLElement>(
      '.hybrid-search-page-preview-similar',
    )!;
    Object.defineProperty(companion, 'scrollHeight', {
      get: () => (companion.hidden ? 0 : 217),
      configurable: true,
    });
    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();

    expect(companion.hidden).toBe(true);
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );

    activeWindow.dispatchEvent(new Event('resize'));

    expect(companion.hidden).toBe(true);
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );

    Object.defineProperty(activeWindow, 'innerHeight', { value: 930, configurable: true });
    activeWindow.dispatchEvent(new Event('resize'));

    expect(companion.hidden).toBe(false);
    expect(companion.dataset.placement).toBe('below');
    harness.manager.unload();
    targetEl.remove();
  });

  it('repositions on resize and disconnects its observer on unload', async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const harness = createHarness(vi.fn().mockReturnValue(searchPromise));
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    vi.spyOn(popover.hoverEl, 'getBoundingClientRect').mockReturnValue({
      left: 600,
      top: 300,
      right: 1200,
      bottom: 700,
      width: 600,
      height: 400,
    } as DOMRect);
    Object.defineProperty(activeWindow, 'innerWidth', { value: 1900, configurable: true });
    Object.defineProperty(activeWindow, 'innerHeight', { value: 792, configurable: true });

    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    const companion = popover.hoverEl.querySelector<HTMLElement>(
      '.hybrid-search-page-preview-similar',
    )!;
    Object.defineProperty(companion, 'scrollHeight', { value: 180, configurable: true });
    resolveSearch([related]);
    await Promise.resolve();
    await Promise.resolve();
    expect(companion.dataset.placement).toBe('right');

    Object.defineProperty(activeWindow, 'innerHeight', { value: 1200, configurable: true });
    resizeCallback?.(
      [
        {
          target: popover.hoverEl,
          borderBoxSize: [],
          contentBoxSize: [],
          contentRect: new DOMRectReadOnly(),
          devicePixelContentBoxSize: [],
        },
      ],
      {} as ResizeObserver,
    );
    expect(companion.dataset.placement).toBe('below');
    expect(observe).toHaveBeenCalledWith(popover.hoverEl);
    expect(observe).toHaveBeenCalledWith(companion);

    harness.manager.unload();
    expect(disconnect).toHaveBeenCalledOnce();
    targetEl.remove();
  });

  it('refreshes cached results after 30 seconds', async () => {
    const harness = createHarness();
    const firstTarget = activeDocument.body.createDiv();
    const first = createLivePopover(firstTarget);
    harness.emitHover(first.hoverParent, firstTarget);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.search).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    const secondTarget = activeDocument.body.createDiv();
    const second = createLivePopover(secondTarget);
    harness.emitHover(second.hoverParent, secondTarget);
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    expect(harness.search).toHaveBeenCalledTimes(2);
    harness.manager.unload();
    firstTarget.remove();
    secondTarget.remove();
  });

  it('invalidates cached results when the client changes', async () => {
    const harness = createHarness();
    const firstTarget = activeDocument.body.createDiv();
    const first = createLivePopover(firstTarget);
    harness.emitHover(first.hoverParent, firstTarget);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.search).toHaveBeenCalledTimes(1);

    harness.manager.clientChanged();
    const secondTarget = activeDocument.body.createDiv();
    const second = createLivePopover(secondTarget);
    harness.emitHover(second.hoverParent, secondTarget);
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    expect(harness.search).toHaveBeenCalledTimes(2);
    harness.manager.unload();
    firstTarget.remove();
    secondTarget.remove();
  });

  it('continues unloading remaining companions and listeners after one detach fails', async () => {
    const harness = createHarness();
    const firstTarget = activeDocument.body.createDiv();
    const secondTarget = activeDocument.body.createDiv();
    const first = createLivePopover(firstTarget);
    const second = createLivePopover(secondTarget);
    harness.emitHover(first.hoverParent, firstTarget);
    harness.emitHover(second.hoverParent, secondTarget);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    const failure = new Error('detach failed');
    vi.spyOn(first.popover, 'removeChild').mockImplementation(() => {
      throw failure;
    });

    expect(() => harness.manager.unload()).toThrow(failure);

    expect(second.popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    expect(harness.app.workspace.offref).toHaveBeenCalled();
    firstTarget.remove();
    secondTarget.remove();
  });

  it('restores companion DOM when Supercharged Links cleanup throws', async () => {
    const harness = createHarness();
    const failure = new Error('observer disconnect failed');
    const removeEventListener = vi.spyOn(activeWindow, 'removeEventListener');
    const observer = { disconnect: vi.fn(() => void 0) };
    const supercharged = {
      observers: [] as Array<[typeof observer, string, string]>,
      _watchContainerDynamic(id: string) {
        this.observers.push([observer, id, 'search-result-file-title']);
      },
    };
    (harness.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins = {
      plugins: { 'supercharged-links-obsidian': supercharged },
    };
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    observer.disconnect.mockImplementation(() => {
      throw failure;
    });

    expect(() => harness.manager.unload()).toThrow(failure);

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(harness.app.workspace.offref).toHaveBeenCalled();
    targetEl.remove();
  });

  it('restores companion DOM when ResizeObserver cleanup throws', async () => {
    const failure = new Error('resize observer disconnect failed');
    class ResizeObserverStub {
      observe = vi.fn();
      disconnect = vi.fn(() => {
        throw failure;
      });
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const harness = createHarness();
    const targetEl = activeDocument.body.createDiv();
    const { hoverParent, popover } = createLivePopover(targetEl);
    harness.emitHover(hoverParent, targetEl);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(() => harness.manager.unload()).toThrow(failure);

    expect(popover.hoverEl.querySelector('.hybrid-search-page-preview-similar')).toBeNull();
    expect(popover.hoverEl.classList.contains('hybrid-search-page-preview-with-similar')).toBe(
      false,
    );
    expect(harness.app.workspace.offref).toHaveBeenCalled();
    targetEl.remove();
  });
});
