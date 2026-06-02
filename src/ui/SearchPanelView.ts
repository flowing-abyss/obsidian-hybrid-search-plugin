import { ItemView, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import type { SearchResult } from '../ipc';
import type HybridSearchPlugin from '../main';
import {
  createInternalLink,
  fileToDragWikiLink,
  getResultTitle,
  hookSuperchargedLinks,
  modeLabel,
  openResult,
  scoreColor,
  type SearchMode,
  unhookSuperchargedLinks,
} from './noteUtils';
import { parseQuery } from './queryParser';

export const SEARCH_PANEL_VIEW_TYPE = 'hybrid-search-panel';
const DEFAULT_SEARCH_PANEL_LIMIT = 20;

export class SearchPanelView extends ItemView {
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private debounce?: number;
  private requestId = 0;
  private selectedIndex = -1;
  private results: SearchResult[] = [];
  private closed = true;
  private panelMode: SearchMode;
  private modeEl?: HTMLSpanElement;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: HybridSearchPlugin,
  ) {
    super(leaf);
    this.panelMode = plugin.settings.defaultMode;
  }

  getViewType(): string {
    return SEARCH_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Hybrid search';
  }

  getIcon(): string {
    return 'search';
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    this.closed = false;
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('hybrid-search-panel');

    const inputWrap = container.createDiv({ cls: 'hybrid-search-panel-input-wrap' });
    this.inputEl = inputWrap.createEl('input', {
      cls: 'hybrid-search-panel-input',
      attr: { type: 'text', placeholder: 'Search notes' },
    });
    this.modeEl = inputWrap.createSpan({
      cls: 'hybrid-search-mode-badge hybrid-search-panel-mode-badge',
      text: modeLabel(this.panelMode, false),
    });
    this.modeEl.setAttribute('aria-label', 'Search mode');
    this.modeEl.setAttribute('title', 'Search mode. Select to cycle modes.');
    this.resultsEl = container.createDiv({ cls: 'hybrid-search-panel-results' });

    this.registerDomEvent(this.inputEl, 'input', () => this.scheduleSearch());
    this.registerDomEvent(container, 'keydown', (evt) => this.handleKeydown(evt));
    this.registerDomEvent(this.modeEl, 'click', () => this.cycleMode());
    this.registerDomEvent(this.resultsEl, 'mouseover', (evt) => this.handleHoverPreview(evt));
    this.registerDomEvent(this.resultsEl, 'click', (evt) => this.handleClick(evt));
    hookSuperchargedLinks(
      this.app,
      SEARCH_PANEL_VIEW_TYPE,
      this.resultsEl,
      'a.hybrid-search-panel-link',
      'hybrid-search-panel-row',
    );
    this.inputEl.focus();
  }

  async onClose(): Promise<void> {
    await Promise.resolve();
    this.closed = true;
    this.requestId++;
    if (this.debounce !== undefined) window.clearTimeout(this.debounce);
    unhookSuperchargedLinks(this.app, SEARCH_PANEL_VIEW_TYPE);
  }

  private scheduleSearch(): void {
    if (this.debounce !== undefined) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => {
      this.debounce = undefined;
      void this.search(this.inputEl.value);
    }, 180);
  }

  private async search(rawQuery: string): Promise<void> {
    const query = rawQuery.trim();
    const requestId = ++this.requestId;
    this.selectedIndex = -1;
    if (!query) {
      this.results = [];
      this.renderEmpty('Type to search.');
      return;
    }
    if (!this.plugin.client) {
      this.results = [];
      this.renderEmpty('Search client not ready.');
      return;
    }

    this.renderEmpty('Searching...');
    const { query: parsedQuery, overrides } = parseQuery(query);
    const mode = overrides.mode ?? this.panelMode;
    this.updateModeBadge(mode, overrides.rerank ?? false);
    try {
      const results = await this.plugin.client.search(parsedQuery, {
        mode,
        limit: overrides.limit ?? DEFAULT_SEARCH_PANEL_LIMIT,
        ...(overrides.tag !== undefined && { tag: overrides.tag }),
        ...(overrides.scope !== undefined && { scope: overrides.scope }),
        ...(overrides.frontmatter !== undefined && { frontmatter: overrides.frontmatter }),
        ...(overrides.rerank !== undefined && { rerank: overrides.rerank }),
        ...(overrides.threshold !== undefined && { threshold: overrides.threshold }),
      });
      if (this.closed || requestId !== this.requestId) return;
      this.results = [...results].sort((a, b) => b.score - a.score);
      this.selectedIndex = this.results.length > 0 ? 0 : -1;
      this.renderResults();
    } catch {
      if (!this.closed && requestId === this.requestId) {
        this.results = [];
        this.renderEmpty('Search failed.');
      }
    }
  }

  private renderEmpty(text: string): void {
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'search-empty-state', text });
  }

  private renderResults(): void {
    this.resultsEl.empty();
    if (this.results.length === 0) {
      this.renderEmpty('No results.');
      return;
    }
    for (let index = 0; index < this.results.length; index++) {
      const result = this.results[index]!;
      const row = this.resultsEl.createDiv({
        cls: `hybrid-search-panel-row${index === this.selectedIndex ? ' is-selected' : ''}`,
        attr: { 'data-index': String(index) },
      });
      const title = getResultTitle(this.app, result);
      const link = createInternalLink(
        this.app,
        row,
        result.path,
        title,
        'hybrid-search-panel-link',
      );
      link.addEventListener('mouseover', (evt) => this.handleHoverPreview(evt));
      const scoreEl = row.createSpan({
        cls: 'hybrid-search-panel-score',
        text: result.score.toFixed(2),
      });
      scoreEl.style.color = scoreColor(result.score);
      if (this.plugin.settings.showMeta) {
        const folder = result.path.includes('/') ? result.path.replace(/\/[^/]+$/, '') : '';
        if (folder) row.createDiv({ cls: 'hybrid-search-panel-meta', text: folder });
      }
    }
  }

  private handleClick(evt: Event): void {
    const mouseEvt = evt as MouseEvent;
    const row = (mouseEvt.target as HTMLElement).closest<HTMLElement>('.hybrid-search-panel-row');
    if (!row) return;
    const index = Number(row.dataset.index);
    const result = this.results[index];
    if (!result) return;
    mouseEvt.preventDefault();
    this.openResultFromPanel(result.path, mouseEvt.ctrlKey || mouseEvt.metaKey);
  }

  private handleHoverPreview(evt: Event): void {
    const mouseEvt = evt as MouseEvent;
    if (!mouseEvt.ctrlKey && !mouseEvt.metaKey) return;
    const link = (mouseEvt.target as HTMLElement).closest<HTMLElement>(
      'a.hybrid-search-panel-link',
    );
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href');
    if (!href) return;
    // @ts-ignore - hover-link is not typed in the public Obsidian API.
    this.app.workspace.trigger('hover-link', {
      event: mouseEvt,
      source: 'hybrid-search-panel',
      hoverParent: { hoverPopover: null },
      targetEl: link,
      linktext: href,
      sourcePath: this.app.workspace.getActiveFile()?.path ?? '',
    });
  }

  private handleKeydown(evt: KeyboardEvent): void {
    if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && evt.key === 'j') {
      evt.preventDefault();
      this.moveSelection(1);
      return;
    }
    if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && evt.key === 'k') {
      evt.preventDefault();
      this.moveSelection(-1);
      return;
    }
    if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && evt.key === 'o') {
      evt.preventDefault();
      if (evt.shiftKey) this.openAllResultsInNewTabs();
      else this.openSelectedInNewTab();
      return;
    }
    if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey && !evt.altKey) {
      const mode = modeForShortcut(evt.key);
      if (mode) {
        evt.preventDefault();
        this.setMode(mode);
        return;
      }
    }
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      evt.preventDefault();
      this.moveSelection(evt.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (evt.altKey && evt.key === 'Enter') {
      evt.preventDefault();
      if (evt.shiftKey) this.insertAllLinksAtCursor();
      else this.insertSelectedLinkAtCursor();
      return;
    }
    if (evt.key === 'Enter') {
      const result = this.results[this.selectedIndex];
      if (!result) return;
      evt.preventDefault();
      this.openResultFromPanel(result.path, evt.ctrlKey || evt.metaKey);
      return;
    }
    if (evt.key === 'Escape') {
      evt.preventDefault();
      this.inputEl.value = '';
      this.results = [];
      this.renderEmpty('Type to search.');
    }
  }

  private moveSelection(delta: number): void {
    if (this.results.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(this.results.length - 1, this.selectedIndex + delta));
    this.renderResults();
    this.resultsEl
      .querySelector<HTMLElement>(`.hybrid-search-panel-row[data-index="${this.selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  private openSelectedInNewTab(): void {
    const result = this.results[this.selectedIndex];
    if (result) openResult(this.app, result.path, true);
  }

  private openAllResultsInNewTabs(): void {
    for (const result of this.results) openResult(this.app, result.path, true);
  }

  private insertSelectedLinkAtCursor(): void {
    const result = this.results[this.selectedIndex];
    if (result) this.insertLinksAtCursor([result]);
  }

  private insertAllLinksAtCursor(): void {
    this.insertLinksAtCursor(this.results);
  }

  private insertLinksAtCursor(results: SearchResult[]): void {
    if (results.length === 0) return;
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return;
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
    const text = results
      .map((result) => fileToDragWikiLink(this.app, result.path, sourcePath))
      .join('\n');
    editor.replaceRange(text, editor.getCursor());
  }

  focusSearch(): void {
    this.inputEl?.focus();
  }

  setMode(mode: SearchMode): void {
    this.panelMode = mode;
    this.updateModeBadge(mode, false);
    if (this.inputEl?.value.trim()) {
      void this.search(this.inputEl.value);
    }
    this.inputEl?.focus();
  }

  private cycleMode(): void {
    const modes: SearchMode[] = ['hybrid', 'semantic', 'fulltext', 'title'];
    const currentIdx = modes.indexOf(this.panelMode);
    this.setMode(modes[(currentIdx + 1) % modes.length]!);
  }

  private updateModeBadge(mode: SearchMode, rerank: boolean): void {
    if (!this.modeEl) return;
    this.modeEl.textContent = modeLabel(mode, rerank);
    this.modeEl.setAttribute('title', `Search mode: ${mode}`);
  }

  private openResultFromPanel(path: string, newLeaf: boolean): void {
    if (newLeaf) {
      openResult(this.app, path, true);
      return;
    }
    const nfcPath = path.normalize('NFC');
    const abstract = this.app.vault.getAbstractFileByPath(nfcPath);
    if (!(abstract instanceof TFile)) return;
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const target = leaves.find((leaf) => leaf !== this.leaf) ?? this.app.workspace.getLeaf('tab');
    void target.openFile(abstract);
  }
}

export async function revealSearchPanel(
  plugin: HybridSearchPlugin,
  mode?: SearchMode,
): Promise<void> {
  const existing = plugin.app.workspace.getLeavesOfType(SEARCH_PANEL_VIEW_TYPE)[0];
  const leaf = existing ?? plugin.app.workspace.getRightLeaf(false);
  if (!leaf) {
    new Notice('Hybrid search: could not open search panel.');
    return;
  }
  await leaf.setViewState({ type: SEARCH_PANEL_VIEW_TYPE, active: true });
  const revealLeaf = (
    plugin.app.workspace as unknown as {
      revealLeaf?: (workspaceLeaf: WorkspaceLeaf) => void | Promise<void>;
    }
  )['revealLeaf'];
  await revealLeaf?.(leaf);
  const view = leaf.view;
  if (view instanceof SearchPanelView) {
    if (mode) view.setMode(mode);
    else view.focusSearch();
  }
}

function modeForShortcut(key: string): SearchMode | undefined {
  if (key === '1') return 'hybrid';
  if (key === '2') return 'semantic';
  if (key === '3') return 'fulltext';
  if (key === '4') return 'title';
  return undefined;
}
