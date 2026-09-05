import {
  Component,
  HoverPopover,
  parseLinktext,
  TFile,
  type App,
  type EventRef,
  type HoverParent,
} from 'obsidian';
import type HybridSearchPlugin from '../main';
import { runAllCleanupSteps } from './cleanup';
import type { SimilarNotesFetchResult } from './noteUtils';
import { fetchSimilarNotesDetailed } from './noteUtils';
import { calculatePagePreviewCompanionPlacement } from './pagePreviewPlacement';
import { SimilarNotesResults } from './SimilarNotesResults';

interface HoverLinkEventPayload {
  event: MouseEvent;
  source: string;
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  linktext: string;
  sourcePath?: string;
}

interface HoverLinkWorkspace {
  on(name: 'hover-link', callback: (payload: HoverLinkEventPayload) => void): EventRef;
}

let nextCompanionId = 0;
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<SimilarNotesFetchResult>;
}

export class PagePreviewSimilarNotesManager {
  private readonly eventRefs: EventRef[] = [];
  private readonly timers = new Set<number>();
  private readonly hoverAttempts = new WeakMap<HoverParent, number>();
  private readonly attachedPopovers = new WeakSet<HoverPopover>();
  private readonly views = new Set<PagePreviewSimilarNotesView>();
  private readonly cache = new Map<string, CacheEntry>();
  private generation = 0;
  private clientGeneration = 0;

  constructor(
    private readonly app: App,
    private readonly plugin: HybridSearchPlugin,
  ) {}

  load(): void {
    if (typeof this.app.workspace.on !== 'function') return;
    const workspace = this.app.workspace as unknown as HoverLinkWorkspace;
    this.eventRefs.push(
      workspace.on('hover-link', (payload) => {
        this.handleHoverLink(payload);
      }),
    );
  }

  unload(): void {
    this.generation++;
    this.cache.clear();
    this.clearAttachmentTimers();
    const views = [...this.views];
    this.views.clear();
    const cleanupSteps = views.map((view) => () => view.detach());
    if (typeof this.app.workspace.offref === 'function') {
      cleanupSteps.push(
        ...this.eventRefs.splice(0).map((eventRef) => () => this.app.workspace.offref(eventRef)),
      );
    }
    runAllCleanupSteps(...cleanupSteps);
  }

  settingsChanged(): void {
    this.cache.clear();
    if (this.plugin.settings.showSimilarNotesInPagePreview) return;
    this.generation++;
    this.clearAttachmentTimers();
    const views = [...this.views];
    this.views.clear();
    runAllCleanupSteps(...views.map((view) => () => view.detach()));
  }

  clientChanged(): void {
    this.clientGeneration++;
    this.cache.clear();
  }

  private handleHoverLink(payload: HoverLinkEventPayload): void {
    const attempt = (this.hoverAttempts.get(payload.hoverParent) ?? 0) + 1;
    this.hoverAttempts.set(payload.hoverParent, attempt);
    if (!this.plugin.settings.showSimilarNotesInPagePreview || !payload.targetEl.isConnected)
      return;
    const file = this.app.metadataCache.getFirstLinkpathDest(
      parseLinktext(payload.linktext).path,
      payload.sourcePath ?? '',
    );
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    const generation = this.generation;
    const attemptTimers: number[] = [];
    const cancelAttempt = () => {
      for (const timer of attemptTimers) {
        window.clearTimeout(timer);
        this.timers.delete(timer);
      }
    };
    for (const delay of [0, 25, 75, 150, 300, 350, 500, 750, 1_000]) {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        if (
          generation !== this.generation ||
          this.hoverAttempts.get(payload.hoverParent) !== attempt ||
          !this.plugin.settings.showSimilarNotesInPagePreview ||
          !payload.targetEl.isConnected
        ) {
          cancelAttempt();
          return;
        }
        const popover = payload.hoverParent.hoverPopover;
        if (!popover) return;
        cancelAttempt();
        if (this.attachedPopovers.has(popover)) return;
        this.attach(popover, file);
      }, delay);
      attemptTimers.push(timer);
      this.timers.add(timer);
    }
  }

  private attach(popover: HoverPopover, file: TFile): void {
    this.attachedPopovers.add(popover);
    const view = new PagePreviewSimilarNotesView({
      app: this.app,
      plugin: this.plugin,
      popover,
      file,
      loadResults: () => this.loadResults(file),
      onDetach: () => this.views.delete(view),
    });
    this.views.add(view);
    popover.addChild(view);
  }

  private clearAttachmentTimers(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
  }

  private loadResults(file: TFile): Promise<SimilarNotesFetchResult> {
    const client = this.plugin.client;
    if (!client) return Promise.reject(new Error('Search client not ready'));
    const limit = this.plugin.settings.similarNotesPagePreviewLimit;
    const threshold = this.plugin.settings.similarNotesThreshold;
    const cacheKey = [this.clientGeneration, file.path.normalize('NFC'), limit, threshold].join(
      '\x00',
    );
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = fetchSimilarNotesDetailed(client, file.path, { limit, threshold });
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
    void promise.catch(() => {
      if (this.cache.get(cacheKey)?.promise === promise) this.cache.delete(cacheKey);
    });
    return promise;
  }
}

interface PagePreviewSimilarNotesViewOptions {
  app: App;
  plugin: HybridSearchPlugin;
  popover: HoverPopover;
  file: TFile;
  loadResults: () => Promise<SimilarNotesFetchResult>;
  onDetach: () => void;
}

class PagePreviewSimilarNotesView extends Component {
  private readonly containerEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly resultsView: SimilarNotesResults;
  private readonly nestedHoverParent: HoverParent = { hoverPopover: null };
  private readonly expandedPaths = new Set<string>();
  private result?: SimilarNotesFetchResult;
  private resizeObserver?: ResizeObserver;
  private ownerWindow?: Window;
  private lastContentHeight?: number;
  private requestId = 0;
  private ownerCleaned = false;
  private readonly onOwnerWindowResize = () => this.position();

  constructor(private readonly options: PagePreviewSimilarNotesViewOptions) {
    super();
    this.containerEl = options.popover.hoverEl.createDiv({
      cls: 'hybrid-search-page-preview-similar',
    });
    this.containerEl.hidden = true;
    this.containerEl.createDiv({
      cls: 'hybrid-search-page-preview-similar-heading',
      text: 'Similar notes',
    });
    this.resultsEl = this.containerEl.createDiv({ cls: 'search-result-container' });
    this.resultsView = new SimilarNotesResults({
      app: options.app,
      containerEl: this.resultsEl,
      ownerId: options.plugin.manifest.id,
      watchId: `hybrid-search-page-preview-similar-${nextCompanionId++}`,
      getSourcePath: (targetEl) =>
        targetEl?.closest<HTMLElement>('[data-source-path]')?.dataset.sourcePath ??
        options.file.path,
      hoverParent: this.nestedHoverParent,
      onToggle: (path) => this.toggleResult(path),
      onContentChanged: () => this.position(),
    });
    this.addChild(this.resultsView);
  }

  override onload(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.position());
      this.resizeObserver.observe(this.options.popover.hoverEl);
      this.resizeObserver.observe(this.containerEl);
    }
    const ownerWindow = this.containerEl.ownerDocument.defaultView;
    if (ownerWindow) {
      this.ownerWindow = ownerWindow;
      ownerWindow.addEventListener('resize', this.onOwnerWindowResize);
    }
    const requestId = ++this.requestId;
    void this.options
      .loadResults()
      .then((result) => {
        if (requestId !== this.requestId || !this.containerEl.isConnected) return;
        if (result.results.length === 0) {
          this.detach();
          return;
        }
        this.result = result;
        this.render();
        this.options.popover.hoverEl.addClass('hybrid-search-page-preview-with-similar');
        this.containerEl.hidden = false;
        this.position();
      })
      .catch(() => {
        if (requestId === this.requestId) this.detach();
      });
  }

  override unload(): void {
    runAllCleanupSteps(
      () => super.unload(),
      () => this.cleanupOwner(),
    );
  }

  override onunload(): void {
    this.cleanupOwner();
  }

  detach(): void {
    this.options.popover.removeChild(this);
  }

  private toggleResult(path: string): void {
    if (this.expandedPaths.has(path)) this.expandedPaths.delete(path);
    else this.expandedPaths.add(path);
    this.render();
  }

  private render(): void {
    if (!this.result) return;
    this.resultsView.render(this.result.results, this.result.scoreMode, this.expandedPaths);
  }

  private cleanupOwner(): void {
    if (this.ownerCleaned) return;
    this.ownerCleaned = true;
    this.requestId++;
    const resizeObserver = this.resizeObserver;
    this.resizeObserver = undefined;
    const ownerWindow = this.ownerWindow;
    this.ownerWindow = undefined;
    runAllCleanupSteps(
      () => ownerWindow?.removeEventListener('resize', this.onOwnerWindowResize),
      () => resizeObserver?.disconnect(),
      () => this.options.popover.hoverEl.removeClass('hybrid-search-page-preview-with-similar'),
      () => this.containerEl.remove(),
      () => this.options.onDetach(),
    );
  }

  private position(): void {
    if (!this.result || !this.containerEl.isConnected) return;
    const ownerWindow = this.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const style = ownerWindow.getComputedStyle(this.containerEl);
    const borderTopWidth = Number.parseFloat(style.borderTopWidth);
    const borderBottomWidth = Number.parseFloat(style.borderBottomWidth);
    const borderHeight =
      (Number.isFinite(borderTopWidth) ? borderTopWidth : 0) +
      (Number.isFinite(borderBottomWidth) ? borderBottomWidth : 0);
    const measuredContentHeight = this.containerEl.scrollHeight;
    if (!this.containerEl.hidden && measuredContentHeight > 0) {
      this.lastContentHeight = measuredContentHeight;
    }
    const contentHeight = this.containerEl.hidden
      ? (this.lastContentHeight ?? measuredContentHeight)
      : measuredContentHeight;
    const placement = calculatePagePreviewCompanionPlacement({
      previewRect: this.options.popover.hoverEl.getBoundingClientRect(),
      viewportWidth: ownerWindow.innerWidth,
      viewportHeight: ownerWindow.innerHeight,
      contentHeight,
      borderHeight,
    });
    if (!placement) {
      this.containerEl.hidden = true;
      this.options.popover.hoverEl.removeClass('hybrid-search-page-preview-with-similar');
      return;
    }
    this.containerEl.setCssProps({
      '--hybrid-search-page-preview-similar-left': `${placement.left}px`,
      '--hybrid-search-page-preview-similar-top': `${placement.top}px`,
      '--hybrid-search-page-preview-similar-width': `${placement.width}px`,
      '--hybrid-search-page-preview-similar-max-height': `${placement.maxHeight}px`,
      width: `${placement.width}px`,
    });
    this.containerEl.dataset.placement = placement.side;
    this.options.popover.hoverEl.addClass('hybrid-search-page-preview-with-similar');
    this.containerEl.hidden = false;
  }
}
