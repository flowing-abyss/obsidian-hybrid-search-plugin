import { ItemView, Notice, setIcon, TFile, type WorkspaceLeaf } from 'obsidian';
import type { SearchResult } from '../ipc';
import type HybridSearchPlugin from '../main';
import {
  createInternalLink,
  fileToDragWikiLink,
  getAnchorOffset,
  getPrimaryAnchor,
  getResultTitle,
  hookSuperchargedLinks,
  modeLabel,
  offsetToEditorPosition,
  openResult,
  resolveSimilarTarget,
  scoreColor,
  type SearchMode,
  unhookSuperchargedLinks,
} from './noteUtils';
import { applyCustomPostfixes, applyDefaultFilters, parseQuery } from './queryParser';

export const SEARCH_PANEL_VIEW_TYPE = 'hybrid-search-panel';
const SEARCH_PANEL_SNIPPET_LENGTH = 400;

export class SearchPanelView extends ItemView {
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private debounce?: number;
  private requestId = 0;
  private selectedIndex = -1;
  private results: SearchResult[] = [];
  private expandedPaths = new Set<string>();
  private allExpanded = false;
  private closed = true;
  private panelMode: SearchMode;
  private modeEl?: HTMLSpanElement;
  private optionsEl?: HTMLElement;
  private limitInputEl?: HTMLInputElement;
  private thresholdInputEl?: HTMLInputElement;
  private expandAllButtonEl?: HTMLButtonElement;
  private panelLimit: number;
  private panelThreshold: number;
  /** Resolved `@similar` target of the current query, or null when the query has none.
   *  Held on the view (not folded into `panelMode`) so mode cycling re-renders the badge
   *  through the same helper and cannot overwrite the `~` with a stale mode letter. */
  private similarPath: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: HybridSearchPlugin,
  ) {
    super(leaf);
    this.panelMode = plugin.settings.defaultMode;
    this.panelLimit = plugin.settings.searchPanelLimit;
    this.panelThreshold = plugin.settings.searchPanelThreshold;
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
    this.createToolbarButton(inputWrap, 'settings', 'Search options', () => this.toggleOptions());
    this.optionsEl = container.createDiv({ cls: 'hybrid-search-panel-options is-hidden' });
    this.optionsEl.hide();
    this.expandAllButtonEl = this.createToolbarButton(
      this.optionsEl,
      'list',
      'Expand all results',
      () => this.toggleAllResults(),
    );
    this.createToolbarButton(
      this.optionsEl,
      'copy',
      'Copy result links',
      () => void this.copyResults(),
    );
    this.optionsEl.createSpan({ cls: 'hybrid-search-panel-option-label', text: 'Limit' });
    this.limitInputEl = this.optionsEl.createEl('input', {
      cls: 'hybrid-search-panel-option-input',
      attr: {
        type: 'number',
        min: '1',
        max: '200',
        step: '1',
        value: String(this.panelLimit),
        'aria-label': 'Search result limit',
      },
    });
    this.optionsEl.createSpan({ cls: 'hybrid-search-panel-option-label', text: '>=' });
    this.thresholdInputEl = this.optionsEl.createEl('input', {
      cls: 'hybrid-search-panel-option-input',
      attr: {
        type: 'number',
        min: '0',
        max: '1',
        step: '0.05',
        value: String(this.panelThreshold),
        'aria-label': 'Minimum relevance threshold',
      },
    });
    this.resultsEl = container.createDiv({ cls: 'hybrid-search-panel-results' });

    this.registerDomEvent(this.inputEl, 'input', () => this.scheduleSearch());
    this.registerDomEvent(container, 'keydown', (evt) => this.handleKeydown(evt));
    this.registerDomEvent(this.modeEl, 'click', () => this.cycleMode());
    this.registerDomEvent(this.limitInputEl, 'change', () => this.updateSearchOptions());
    this.registerDomEvent(this.thresholdInputEl, 'change', () => this.updateSearchOptions());
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
    this.expandedPaths.clear();
    this.allExpanded = false;
    if (!query) {
      this.results = [];
      // `similarPath` describes the results currently on screen; an empty query has none,
      // so leaving it set would let a later setMode paint a "~" the panel is not honouring.
      this.similarPath = null;
      this.updateModeBadge(this.panelMode, false);
      this.renderEmpty('Type to search.');
      return;
    }
    if (!this.plugin.client) {
      this.results = [];
      this.renderEmpty('Search client not ready.');
      return;
    }

    this.renderEmpty('Searching...');
    const { query: parsedQuery, overrides } = parseQuery(
      applyDefaultFilters(
        applyCustomPostfixes(query, this.plugin.settings.customPostfixes),
        this.plugin.settings.defaultSearchFilters,
      ),
    );
    const activePath = this.app.workspace.getActiveFile()?.path;
    this.similarPath = overrides.similar
      ? resolveSimilarTarget(this.app, overrides.similar, activePath, activePath ?? '')
      : null;
    if (overrides.similar && !this.similarPath) {
      this.results = [];
      this.renderEmpty('Open a note to use @similar.');
      return;
    }
    const mode = overrides.mode ?? this.panelMode;
    this.updateModeBadge(mode, overrides.rerank ?? false);
    const limit = overrides.limit ?? this.panelLimit;
    const threshold = overrides.threshold ?? this.panelThreshold;
    try {
      // The backend ignores the query string during a path lookup, so send '' rather than
      // the leftover free text — it would only look like it had been searched for.
      const results = await this.plugin.client.search(this.similarPath ? '' : parsedQuery, {
        mode,
        ...(this.similarPath && { notePath: this.similarPath }),
        limit,
        anchors: true,
        snippetLength: SEARCH_PANEL_SNIPPET_LENGTH,
        ...(overrides.tag !== undefined && { tag: overrides.tag }),
        ...(overrides.scope !== undefined && { scope: overrides.scope }),
        ...(overrides.frontmatter !== undefined && { frontmatter: overrides.frontmatter }),
        ...(overrides.rerank !== undefined && { rerank: overrides.rerank }),
        ...(threshold > 0 && { threshold }),
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
    this.updateExpandButton();
    for (let index = 0; index < this.results.length; index++) {
      const result = this.results[index]!;
      const nfcPath = result.path.normalize('NFC');
      const isExpanded = this.expandedPaths.has(nfcPath);
      const item = this.resultsEl.createDiv({
        cls: `tree-item hybrid-search-panel-result${isExpanded ? '' : ' is-collapsed'}`,
      });
      const row = item.createDiv({
        cls: `tree-item-self hybrid-search-panel-row is-clickable${index === this.selectedIndex ? ' is-selected' : ''}`,
        attr: { 'data-index': String(index), 'data-path': nfcPath },
      });
      const collapseIcon = row.createDiv({
        cls: `tree-item-icon collapse-icon${isExpanded ? '' : ' is-collapsed'}`,
      });
      collapseIcon.dataset.index = String(index);
      collapseIcon.setAttribute('aria-label', isExpanded ? 'Collapse result' : 'Expand result');
      setIcon(collapseIcon, 'right-triangle');
      const title = getResultTitle(this.app, result);
      const link = createInternalLink(
        this.app,
        row,
        result.path,
        title,
        'hybrid-search-panel-link',
      );
      link.classList.add('tree-item-inner');
      link.addEventListener('mouseover', (evt) => this.handleHoverPreview(evt));
      const flairOuter = row.createDiv({ cls: 'tree-item-flair-outer' });
      const scoreEl = flairOuter.createSpan({
        cls: 'tree-item-flair hybrid-search-panel-score',
        text: result.score.toFixed(2),
      });
      scoreEl.style.color = scoreColor(result.score);
      if (this.plugin.settings.showMeta) {
        const folder = result.path.includes('/') ? result.path.replace(/\/[^/]+$/, '') : '';
        if (folder) item.createDiv({ cls: 'hybrid-search-panel-meta', text: folder });
      }
      if (isExpanded && result.snippet) {
        const matches = item.createDiv({ cls: 'search-result-file-matches' });
        const match = matches.createDiv({
          cls: 'search-result-file-match tappable hybrid-search-panel-snippet',
        });
        match.dataset.index = String(index);
        match.setAttribute('role', 'button');
        match.setAttribute('tabindex', '0');
        match.setAttribute('aria-label', `Open ${title} at matching snippet`);
        match.textContent = result.snippet;
      }
    }
  }

  private handleClick(evt: Event): void {
    const mouseEvt = evt as MouseEvent;
    const snippet = (mouseEvt.target as HTMLElement).closest<HTMLElement>(
      '.hybrid-search-panel-snippet',
    );
    if (snippet?.dataset.index !== undefined) {
      mouseEvt.preventDefault();
      mouseEvt.stopPropagation();
      const result = this.results[Number(snippet.dataset.index)];
      if (result) {
        void this.openResultFromPanel(result.path, mouseEvt.ctrlKey || mouseEvt.metaKey, result);
      }
      return;
    }
    const collapseIcon = (mouseEvt.target as HTMLElement).closest<HTMLElement>('.collapse-icon');
    if (collapseIcon?.dataset.index !== undefined) {
      mouseEvt.preventDefault();
      mouseEvt.stopPropagation();
      this.toggleResult(Number(collapseIcon.dataset.index));
      return;
    }
    const row = (mouseEvt.target as HTMLElement).closest<HTMLElement>('.hybrid-search-panel-row');
    if (!row) return;
    const index = Number(row.dataset.index);
    const result = this.results[index];
    if (!result) return;
    mouseEvt.preventDefault();
    void this.openResultFromPanel(result.path, mouseEvt.ctrlKey || mouseEvt.metaKey);
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
    const snippet = (evt.target as HTMLElement).closest<HTMLElement>(
      '.hybrid-search-panel-snippet',
    );
    if (snippet?.dataset.index !== undefined && (evt.key === 'Enter' || evt.key === ' ')) {
      const result = this.results[Number(snippet.dataset.index)];
      if (!result) return;
      evt.preventDefault();
      void this.openResultFromPanel(result.path, evt.ctrlKey || evt.metaKey, result);
      return;
    }
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
      void this.openResultFromPanel(result.path, evt.ctrlKey || evt.metaKey);
      return;
    }
    if (evt.key === 'Escape') {
      evt.preventDefault();
      this.inputEl.value = '';
      this.results = [];
      this.expandedPaths.clear();
      // Escape discards the results without going through search(), so clear the similar
      // state here too — otherwise the badge keeps claiming "~" for results that are gone.
      this.similarPath = null;
      this.updateModeBadge(this.panelMode, false);
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

  private createToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (evt: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: 'clickable-icon hybrid-search-panel-toolbar-btn',
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

  private toggleOptions(): void {
    if (!this.optionsEl) return;
    if (this.optionsEl.classList.contains('is-hidden')) {
      this.optionsEl.removeClass('is-hidden');
      this.optionsEl.show();
      this.limitInputEl?.focus();
    } else {
      this.optionsEl.addClass('is-hidden');
      this.optionsEl.hide();
      this.inputEl.focus();
    }
  }

  private updateSearchOptions(): void {
    let changed = false;
    const limit = Number(this.limitInputEl?.value ?? this.panelLimit);
    if (Number.isInteger(limit) && limit > 0 && limit <= 200) {
      changed = changed || this.panelLimit !== limit;
      this.panelLimit = limit;
    } else if (this.limitInputEl) {
      this.limitInputEl.value = String(this.panelLimit);
    }

    const threshold = Number(this.thresholdInputEl?.value ?? this.panelThreshold);
    if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
      changed = changed || this.panelThreshold !== threshold;
      this.panelThreshold = threshold;
    } else if (this.thresholdInputEl) {
      this.thresholdInputEl.value = String(this.panelThreshold);
    }

    if (changed) {
      this.plugin.settings.searchPanelLimit = this.panelLimit;
      this.plugin.settings.searchPanelThreshold = this.panelThreshold;
      void this.plugin.saveSettings();
    }
    if (this.inputEl.value.trim()) void this.search(this.inputEl.value);
  }

  private toggleResult(index: number): void {
    const result = this.results[index];
    if (!result) return;
    const path = result.path.normalize('NFC');
    if (this.expandedPaths.has(path)) this.expandedPaths.delete(path);
    else this.expandedPaths.add(path);
    this.allExpanded =
      this.results.length > 0 &&
      this.results.every((item) => this.expandedPaths.has(item.path.normalize('NFC')));
    this.selectedIndex = index;
    this.renderResults();
  }

  private toggleAllResults(): void {
    if (this.results.length === 0) return;
    this.allExpanded = !this.allExpanded;
    this.expandedPaths = this.allExpanded
      ? new Set(this.results.map((result) => result.path.normalize('NFC')))
      : new Set();
    this.renderResults();
  }

  private updateExpandButton(): void {
    if (!this.expandAllButtonEl) return;
    const label = this.allExpanded ? 'Collapse all results' : 'Expand all results';
    this.expandAllButtonEl.setAttribute('aria-label', label);
    this.expandAllButtonEl.setAttribute('title', label);
    this.expandAllButtonEl.toggleClass('is-active', this.allExpanded);
  }

  private async copyResults(): Promise<void> {
    if (this.results.length === 0) return;
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
    const text = this.results
      .map((result) => fileToDragWikiLink(this.app, result.path, sourcePath))
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      new Notice('Search results copied.');
    } catch {
      new Notice('Failed to copy search results.');
    }
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
    this.modeEl.textContent = this.similarPath ? '~' : modeLabel(mode, rerank);
    this.modeEl.setAttribute('title', this.similarPath ? 'Similar notes' : `Search mode: ${mode}`);
  }

  private async openResultFromPanel(
    path: string,
    newLeaf: boolean,
    result?: SearchResult,
  ): Promise<void> {
    const nfcPath = path.normalize('NFC');
    const abstract = this.app.vault.getAbstractFileByPath(nfcPath);
    if (!(abstract instanceof TFile)) return;
    const target = newLeaf
      ? this.app.workspace.getLeaf('tab')
      : (this.app.workspace.getLeavesOfType('markdown').find((leaf) => leaf !== this.leaf) ??
        this.app.workspace.getLeaf('tab'));
    const openState = result ? await this.getSnippetOpenState(abstract, result) : undefined;
    void target.openFile(abstract, openState);
  }

  private async getSnippetOpenState(
    file: TFile,
    result: SearchResult,
  ): Promise<Parameters<WorkspaceLeaf['openFile']>[1] | undefined> {
    const anchor = getPrimaryAnchor(result);
    if (!anchor) return undefined;
    try {
      const content = await this.app.vault.cachedRead(file);
      const startOffset = getAnchorOffset(content, anchor);
      if (startOffset < 0) return undefined;
      const endOffset =
        typeof anchor.charEnd === 'number' && anchor.charEnd >= startOffset
          ? anchor.charEnd
          : startOffset;
      const from = offsetToEditorPosition(content, startOffset);
      const to = offsetToEditorPosition(content, endOffset);
      return {
        active: true,
        eState: {
          line: from.line,
          cursor: { from, to },
        },
      };
    } catch {
      return undefined;
    }
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
