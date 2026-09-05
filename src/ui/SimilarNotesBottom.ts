import {
  Component,
  MarkdownView,
  Notice,
  setIcon,
  TFile,
  type App,
  type EventRef,
  type HoverParent,
  type WorkspaceLeaf,
} from 'obsidian';
import type { SearchResult } from '../ipc';
import type HybridSearchPlugin from '../main';
import { runAllCleanupSteps } from './cleanup';
import { fetchSimilarNotesDetailed, fileToDragWikiLink, getResultTitle } from './noteUtils';
import { SimilarNotesResults } from './SimilarNotesResults';
import { stampPanelOwner } from './strayPanels';

const WATCH_ID_PREFIX = 'hybrid-search-similar-bottom';
const REFRESH_INTERVAL_MS = 10_000;
let nextViewId = 0;

export class SimilarNotesBottomManager {
  private readonly views = new Map<MarkdownView, SimilarNotesBottomView>();
  private readonly eventRefs: EventRef[] = [];
  private refreshTimer?: number;
  private refreshInterval?: number;
  private pendingRefreshForce = false;
  private retryCount = 0;

  constructor(
    private app: App,
    private plugin: HybridSearchPlugin,
  ) {}

  load(): void {
    if (typeof this.app.workspace.on !== 'function') return;
    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.handleActiveLeafChange(leaf);
      }),
    );
    this.eventRefs.push(
      this.app.workspace.on('layout-change', () => {
        this.scheduleRefresh();
      }),
    );
    this.refreshInterval = window.setInterval(() => {
      if (this.plugin.settings.showSimilarNotesAtBottom && this.views.size > 0) {
        this.refreshAll(true, true);
      }
    }, REFRESH_INTERVAL_MS);
    this.scheduleRefresh();
  }

  unload(): void {
    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.pendingRefreshForce = false;
    if (this.refreshInterval !== undefined) {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
    const eventRefs = this.eventRefs.splice(0);
    const views = [...this.views.values()];
    this.views.clear();
    const cleanupSteps: Array<() => void> = [];
    if (typeof this.app.workspace.offref === 'function') {
      cleanupSteps.push(...eventRefs.map((ref) => () => this.app.workspace.offref(ref)));
    }
    cleanupSteps.push(...views.map((view) => () => view.unload()));
    runAllCleanupSteps(...cleanupSteps);
  }

  settingsChanged(): void {
    if (!this.plugin.settings.showSimilarNotesAtBottom) {
      const views = [...this.views.values()];
      this.views.clear();
      runAllCleanupSteps(...views.map((view) => () => view.unload()));
      return;
    }
    this.refresh(true);
  }

  refresh(force = false): void {
    this.scheduleRefresh(force);
  }

  private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    this.scheduleRefresh();
  }

  private scheduleRefresh(force = false): void {
    this.pendingRefreshForce = this.pendingRefreshForce || force;
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      const refreshForce = this.pendingRefreshForce;
      this.pendingRefreshForce = false;
      const attached = this.refreshAll(refreshForce);
      if (!attached && this.retryCount < 10) {
        this.retryCount++;
        this.scheduleRefresh(refreshForce);
      } else {
        this.retryCount = 0;
      }
    }, 150);
  }

  private refreshAll(force = false, silent = false): boolean {
    if (typeof this.app.workspace.getLeavesOfType !== 'function') return false;
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const liveViews = new Set<MarkdownView>();
    let attached = false;

    for (const leaf of leaves) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      liveViews.add(leaf.view);
      attached = this.ensureView(leaf.view, force, silent) || attached;
    }

    const staleViews: SimilarNotesBottomView[] = [];
    for (const [markdownView, view] of this.views) {
      if (!liveViews.has(markdownView)) {
        this.views.delete(markdownView);
        staleViews.push(view);
      }
    }
    runAllCleanupSteps(...staleViews.map((view) => () => view.unload()));
    return attached;
  }

  private ensureView(markdownView: MarkdownView, force = false, silent = false): boolean {
    if (!this.plugin.settings.showSimilarNotesAtBottom || !markdownView.file) return false;

    const insertion = findInsertionPoint(markdownView);
    if (!insertion) return false;

    let view = this.views.get(markdownView);
    if (!view) {
      view = new SimilarNotesBottomView(this.app, this.plugin, markdownView, insertion.parentEl);
      this.views.set(markdownView, view);
    }
    if (
      !view.getContainerEl().isConnected ||
      view.getContainerEl().parentElement !== insertion.parentEl ||
      view.getContainerEl().nextElementSibling !== insertion.beforeEl
    ) {
      insertion.parentEl.insertBefore(view.getContainerEl(), insertion.beforeEl);
    }
    view.refresh(force, silent);
    return true;
  }
}

class SimilarNotesBottomView extends Component {
  private readonly containerEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly searchWrapEl: HTMLElement;
  private readonly searchInputEl: HTMLInputElement;
  private readonly thresholdInputEl: HTMLInputElement;
  private readonly titleWrapEl: HTMLElement;
  private readonly expandAllButtonEl: HTMLButtonElement;
  private readonly hoverParent: HoverParent = { hoverPopover: null };
  private readonly resultsView: SimilarNotesResults;
  private expandedPaths = new Set<string>();
  private results: SearchResult[] = [];
  private filterQuery = '';
  private allExpanded = false;
  private sectionCollapsed = false;
  private currentPath = '';
  private lastRefreshKey = '';
  private lastResultsSignature = '';
  private requestId = 0;
  private scoreMode: 'similarity' | 'structural' = 'similarity';
  private readonly viewId = nextViewId++;

  constructor(
    private app: App,
    private plugin: HybridSearchPlugin,
    private markdownView: MarkdownView,
    parentEl: HTMLElement,
  ) {
    super();
    this.containerEl = stampPanelOwner(
      parentEl.createDiv({ cls: 'embedded-similar-notes hybrid-search-similar-bottom' }),
      plugin.manifest.id,
    );

    const pane = this.containerEl.createDiv({ cls: 'similar-notes-pane' });
    const heading = pane.createDiv({ cls: 'hybrid-search-similar-heading' });
    this.titleWrapEl = heading.createDiv({
      cls: 'tree-item-self hybrid-search-similar-title-wrap is-clickable',
      attr: { tabindex: '0', 'aria-label': 'Click to collapse', title: 'Click to collapse' },
    });
    this.titleWrapEl.addEventListener('click', () => {
      this.sectionCollapsed = !this.sectionCollapsed;
      this.renderResults(this.results);
    });
    this.titleWrapEl.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        this.sectionCollapsed = !this.sectionCollapsed;
        this.renderResults(this.results);
      }
    });
    const titleInnerEl = this.titleWrapEl.createDiv({ cls: 'tree-item-inner' });
    titleInnerEl.textContent = 'Similar notes';
    const titleFlairOuter = this.titleWrapEl.createDiv({ cls: 'tree-item-flair-outer' });
    this.countEl = titleFlairOuter.createSpan({
      cls: 'tree-item-flair hybrid-search-similar-count',
    });
    this.countEl.textContent = '0';

    const controls = heading.createDiv({
      cls: 'nav-buttons-container hybrid-search-similar-controls',
    });
    this.expandAllButtonEl = this.createToolbarButton(
      controls,
      'bullet-list',
      'Expand all results',
      () => {
        this.toggleAllResults();
      },
    );
    this.createToolbarButton(controls, 'search', 'Search similar notes', () => {
      if (this.searchWrapEl.classList.contains('is-hidden')) {
        this.searchWrapEl.removeClass('is-hidden');
        this.searchWrapEl.show();
        this.searchInputEl.focus();
      } else {
        this.searchWrapEl.addClass('is-hidden');
        this.searchWrapEl.hide();
      }
    });
    this.createToolbarButton(controls, 'copy', 'Copy similar note links', () => {
      void this.copyResults();
    });

    this.searchWrapEl = pane.createDiv({
      cls: 'hybrid-search-similar-search is-hidden',
    });
    const thresholdWrap = this.searchWrapEl.createDiv({
      cls: 'hybrid-search-similar-threshold-wrap',
      attr: { title: 'Minimum similarity' },
    });
    thresholdWrap.createSpan({ cls: 'hybrid-search-similar-threshold-label', text: '>=' });
    this.thresholdInputEl = thresholdWrap.createEl('input', {
      cls: 'hybrid-search-similar-threshold',
      attr: {
        type: 'number',
        min: '0',
        max: '1',
        step: '0.05',
        value: String(this.plugin.settings.similarNotesThreshold),
        'aria-label': 'Minimum similarity',
        title: 'Minimum similarity',
      },
    });
    this.searchInputEl = this.searchWrapEl.createEl('input', {
      attr: { type: 'search', placeholder: 'Filter similar notes' },
    });

    this.resultsEl = pane.createDiv({ cls: 'search-result-container' });
    this.resultsView = new SimilarNotesResults({
      app: this.app,
      containerEl: this.resultsEl,
      ownerId: this.plugin.manifest.id,
      watchId: `${WATCH_ID_PREFIX}-${this.viewId}`,
      getSourcePath: (targetEl) => this.getSourcePathForLink(targetEl),
      hoverParent: this.hoverParent,
      onToggle: (path) => this.toggleResult(path),
    });
    this.resultsView.load();
    this.registerDomEvent(this.searchInputEl, 'input', () => {
      this.filterQuery = this.searchInputEl.value.trim().toLowerCase();
      this.renderResults(this.results);
    });
    this.registerDomEvent(this.thresholdInputEl, 'change', () => {
      const threshold = Number(this.thresholdInputEl.value);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        this.thresholdInputEl.value = String(this.plugin.settings.similarNotesThreshold);
        return;
      }
      this.plugin.settings.similarNotesThreshold = threshold;
      void this.plugin.saveSettings();
      this.refresh(true);
    });
  }

  getContainerEl(): HTMLElement {
    return this.containerEl;
  }

  refresh(force = false, silent = false): void {
    const file = this.markdownView.file;
    const refreshKey = `${file?.path ?? ''}\x00${this.plugin.settings.similarNotesBottomLimit}\x00${this.plugin.settings.similarNotesThreshold}`;
    if (!file || (!force && this.lastRefreshKey === refreshKey)) return;
    this.currentPath = file.path;
    this.lastRefreshKey = refreshKey;
    if (!silent) this.renderLoading();
    void this.loadResults(file, silent);
  }

  override unload(): void {
    this.requestId++;
    runAllCleanupSteps(
      () => this.resultsView.unload(),
      () => super.unload(),
      () => this.containerEl.remove(),
    );
  }

  private async loadResults(file: TFile, silent: boolean): Promise<void> {
    const requestId = ++this.requestId;
    try {
      if (!this.plugin.client) {
        this.lastRefreshKey = '';
        this.renderEmpty('Search client not ready.');
        return;
      }
      const result = await fetchSimilarNotesDetailed(this.plugin.client, file.path, {
        limit: this.plugin.settings.similarNotesBottomLimit,
        threshold: this.plugin.settings.similarNotesThreshold,
      });
      if (requestId !== this.requestId) return;
      const signature = getResultsSignature(result.scoreMode, result.results);
      if (silent && signature === this.lastResultsSignature) return;
      this.lastResultsSignature = signature;
      this.scoreMode = result.scoreMode;
      this.results = result.results;
      this.pruneExpandedPaths(result.results);
      this.renderResults(result.results);
    } catch {
      if (requestId === this.requestId) {
        this.lastRefreshKey = '';
        this.renderEmpty('No similar notes found.');
      }
    }
  }

  private renderLoading(): void {
    this.countEl.textContent = '0';
    this.resultsEl.empty();
    if (this.sectionCollapsed) this.resultsEl.hide();
    else this.resultsEl.show();
    this.resultsEl.createDiv({ cls: 'search-empty-state', text: 'Loading similar notes...' });
  }

  private renderEmpty(text: string): void {
    this.countEl.textContent = '0';
    this.resultsEl.empty();
    if (this.sectionCollapsed) this.resultsEl.hide();
    else this.resultsEl.show();
    if (this.sectionCollapsed) return;
    this.resultsEl.createDiv({ cls: 'search-empty-state', text });
  }

  private renderResults(results: SearchResult[]): void {
    this.resultsEl.empty();
    const filtered = this.filterResults(results);
    this.countEl.textContent = String(filtered.length);
    this.updateSectionTitle();
    this.updateExpandButton();
    if (!this.sectionCollapsed && !this.searchWrapEl.classList.contains('is-hidden')) {
      this.searchWrapEl.show();
    } else {
      this.searchWrapEl.hide();
    }
    if (this.sectionCollapsed) this.resultsEl.hide();
    else this.resultsEl.show();
    if (this.sectionCollapsed) return;
    if (filtered.length === 0) {
      this.resultsEl.createDiv({ cls: 'search-empty-state', text: 'No similar notes found.' });
      return;
    }
    this.resultsView.render(filtered, this.scoreMode, this.expandedPaths);
  }

  private getSourcePathForLink(targetEl?: HTMLElement): string {
    return (
      targetEl?.closest<HTMLElement>('[data-source-path]')?.dataset.sourcePath ?? this.currentPath
    );
  }

  private createToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (evt: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: 'clickable-icon hybrid-search-similar-toolbar-btn',
      attr: { 'aria-label': label, title: label, type: 'button' },
    });
    setIcon(button, icon);
    button.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      onClick(evt);
    });
    return button;
  }

  private filterResults(results: SearchResult[]): SearchResult[] {
    if (!this.filterQuery) return results;
    return results.filter((result) => {
      const title = getResultTitle(this.app, result).toLowerCase();
      return (
        title.includes(this.filterQuery) ||
        result.path.toLowerCase().includes(this.filterQuery) ||
        (result.snippet ?? '').toLowerCase().includes(this.filterQuery)
      );
    });
  }

  private toggleResult(path: string): void {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path);
    } else {
      this.expandedPaths.add(path);
    }
    this.renderResults(this.results);
  }

  private toggleAllResults(): void {
    const filtered = this.filterResults(this.results);
    this.allExpanded = !this.allExpanded;
    this.expandedPaths = this.allExpanded
      ? new Set(filtered.map((result) => result.path.normalize('NFC')))
      : new Set();
    this.renderResults(this.results);
  }

  private pruneExpandedPaths(results: SearchResult[]): void {
    const visiblePaths = new Set(results.map((result) => result.path.normalize('NFC')));
    for (const path of Array.from(this.expandedPaths)) {
      if (!visiblePaths.has(path)) this.expandedPaths.delete(path);
    }
    if (this.allExpanded) {
      this.expandedPaths = new Set(visiblePaths);
    }
  }

  private updateExpandButton(): void {
    const label = this.allExpanded ? 'Collapse all results' : 'Expand all results';
    this.expandAllButtonEl.setAttribute('aria-label', label);
    this.expandAllButtonEl.setAttribute('title', label);
    this.expandAllButtonEl.toggleClass('is-active', this.allExpanded);
  }

  private updateSectionTitle(): void {
    const label = this.sectionCollapsed ? 'Click to expand' : 'Click to collapse';
    this.titleWrapEl.setAttribute('aria-label', label);
    this.titleWrapEl.setAttribute('title', label);
    this.titleWrapEl.toggleClass('is-collapsed', this.sectionCollapsed);
  }

  private async copyResults(): Promise<void> {
    const filtered = this.filterResults(this.results);
    const text = filtered.map((result) => fileToDragWikiLink(this.app, result.path)).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      new Notice('Similar notes copied.');
    } catch {
      new Notice('Failed to copy similar notes.');
    }
  }
}

interface InsertionPoint {
  parentEl: HTMLElement;
  beforeEl: Element | null;
}

function findInsertionPoint(markdownView: MarkdownView): InsertionPoint | null {
  const backlinksEl = markdownView.containerEl.querySelector('.embedded-backlinks');
  if (backlinksEl?.parentElement) {
    return { parentEl: backlinksEl.parentElement, beforeEl: backlinksEl };
  }

  const contentEl = (markdownView as unknown as { contentEl?: HTMLElement }).contentEl;
  const parentEl =
    markdownView.containerEl.querySelector<HTMLElement>('.markdown-preview-sizer') ??
    markdownView.containerEl.querySelector<HTMLElement>('.cm-sizer') ??
    markdownView.containerEl.querySelector<HTMLElement>('.markdown-preview-view') ??
    markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view') ??
    contentEl ??
    markdownView.containerEl;
  return parentEl ? { parentEl, beforeEl: null } : null;
}

function getResultsSignature(
  scoreMode: 'similarity' | 'structural',
  results: SearchResult[],
): string {
  return `${scoreMode}\n${results
    .map((result) => {
      const score = Number.isFinite(result.score) ? result.score.toFixed(6) : '';
      return [result.path.normalize('NFC'), score, result.title ?? '', result.snippet ?? ''].join(
        '\x1f',
      );
    })
    .join('\n')}`;
}
