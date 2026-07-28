import {
  Editor,
  EditorSuggest,
  TFile,
  type App,
  type EditorPosition,
  type EditorSuggestContext,
} from 'obsidian';
import type { SearchResult } from '../ipc';
import type HybridSearchPlugin from '../main';
import {
  createInternalLink,
  fileToDragWikiLink,
  hookSuperchargedLinks,
  scoreColor,
  unhookSuperchargedLinks,
  type SearchMode,
} from './noteUtils';
import { applyCustomPostfixes, applyDefaultFilters, parseQuery } from './queryParser';
import { SearchPreviewRenderer } from './SearchPreviewRenderer';

const INLINE_SEARCH_SNIPPET_LENGTH = 400;
const INLINE_SEARCH_DEBOUNCE_MS = 150;
let inlineSuggestInstanceId = 0;

type InlineSearchSuggestion = SearchResult | InlineSearchStatus;

interface InlineSearchStatus {
  kind: 'status';
  message: string;
}

interface InternalSuggestChooser<T> {
  values?: T[];
  selectedItem?: number;
  setSelectedItem?: (index: number, evt: KeyboardEvent) => void;
  useSelectedItem?: (evt: KeyboardEvent) => void;
  suggestions?: HTMLElement[];
  containerEl?: HTMLElement;
}

interface EditorSuggestWithInternal<T> {
  chooser?: InternalSuggestChooser<T>;
  suggestions?: InternalSuggestChooser<T> & {
    chooser?: InternalSuggestChooser<T>;
  };
}

export function findInlineSearchTrigger(
  lineTextBeforeCursor: string,
  trigger: string,
): { ch: number; query: string } | null {
  if (!trigger) return null;
  const idx = lineTextBeforeCursor.lastIndexOf(trigger);
  if (idx < 0) return null;
  if (idx > 0 && lineTextBeforeCursor[idx - 1] === '\\') return null;
  return {
    ch: idx,
    query: lineTextBeforeCursor.slice(idx + trigger.length),
  };
}

export class InlineSearchSuggest extends EditorSuggest<InlineSearchSuggestion> {
  private currentMode: SearchMode;
  private previewWrapEl?: HTMLElement;
  private previewEl?: HTMLElement;
  private previewRenderer?: SearchPreviewRenderer;
  private searchTimer?: number;
  private requestId = 0;
  private renderedContainer?: HTMLElement;
  private selectedObserver?: MutationObserver;
  private lastResults: SearchResult[] = [];
  private readonly superchargedLinksWatchId = `hybrid-search-inline-suggest-${++inlineSuggestInstanceId}`;

  constructor(
    app: App,
    private readonly plugin: Pick<HybridSearchPlugin, 'client' | 'settings'>,
  ) {
    super(app);
    this.currentMode = plugin.settings.defaultMode;
    this.limit = plugin.settings.inlineSearchLimit;
    this.setInstructions([
      { command: 'Enter', purpose: 'Insert selected note link' },
      { command: 'Ctrl/Cmd O', purpose: 'Open selected note' },
      { command: 'Alt Enter', purpose: 'Insert selected note link' },
    ]);
    this.scope.register(['Mod'], 'j', (evt: KeyboardEvent) => {
      this.moveSelection(1, evt);
      return false;
    });
    this.scope.register(['Mod'], 'k', (evt: KeyboardEvent) => {
      this.moveSelection(-1, evt);
      return false;
    });
    this.scope.register(['Mod'], 'o', (_evt: KeyboardEvent) => {
      this.openSelectedFromChooser(true);
      return false;
    });
    this.scope.register(['Mod', 'Shift'], 'o', (_evt: KeyboardEvent) => {
      this.openAllResults();
      return false;
    });
    this.scope.register(['Alt'], 'Enter', (_evt: KeyboardEvent) => {
      this.insertSelectedFromChooser();
      return false;
    });
    this.scope.register(['Alt', 'Shift'], 'Enter', (_evt: KeyboardEvent) => {
      this.insertAllResults();
      return false;
    });
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null) {
    if (!file || !this.plugin.settings.inlineSearchEnabled) {
      this.hidePreview();
      return null;
    }
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    const match = findInlineSearchTrigger(line, this.plugin.settings.inlineSearchTrigger);
    if (!match) {
      this.hidePreview();
      return null;
    }
    return {
      start: { line: cursor.line, ch: match.ch },
      end: cursor,
      query: match.query,
    };
  }

  getSuggestions(context: EditorSuggestContext): Promise<InlineSearchSuggestion[]> {
    const query = context.query.trim();
    if (!query || !this.plugin.client) {
      this.requestId++;
      this.hidePreview();
      return Promise.resolve([
        { kind: 'status', message: this.plugin.client ? 'Search...' : 'Search client not ready.' },
      ]);
    }

    if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
    const requestId = ++this.requestId;

    return new Promise((resolve) => {
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = undefined;
        void this.runSearch(query, requestId).then(resolve);
      }, INLINE_SEARCH_DEBOUNCE_MS);
    });
  }

  private async runSearch(query: string, requestId: number): Promise<InlineSearchSuggestion[]> {
    const { query: parsedQuery, overrides } = parseQuery(
      applyDefaultFilters(
        applyCustomPostfixes(query, this.plugin.settings.customPostfixes),
        this.plugin.settings.defaultSearchFilters,
      ),
    );
    const mode = overrides.mode ?? this.currentMode;
    const limit = overrides.limit ?? this.plugin.settings.inlineSearchLimit;
    const threshold = overrides.threshold ?? this.plugin.settings.inlineSearchThreshold;

    try {
      const client = this.plugin.client;
      if (!client) return [{ kind: 'status', message: 'Search client not ready.' }];
      const results = await client.search(parsedQuery, {
        mode,
        limit,
        anchors: true,
        snippetLength: INLINE_SEARCH_SNIPPET_LENGTH,
        ...(overrides.tag !== undefined && { tag: overrides.tag }),
        ...(overrides.scope !== undefined && { scope: overrides.scope }),
        ...(overrides.frontmatter !== undefined && { frontmatter: overrides.frontmatter }),
        ...(overrides.rerank !== undefined && { rerank: overrides.rerank }),
        ...(threshold > 0 && { threshold }),
      });
      if (requestId !== this.requestId) return this.keepOpenSuggestions();
      this.currentMode = mode;
      this.lastResults = [...results].sort((a, b) => b.score - a.score);
      if (this.lastResults.length === 0) {
        this.hidePreview();
        return [{ kind: 'status', message: 'No results. Try another query or add filters.' }];
      }
      return this.lastResults;
    } catch {
      return [{ kind: 'status', message: 'Search failed. Check the local search service.' }];
    }
  }

  private keepOpenSuggestions(): InlineSearchSuggestion[] {
    return this.lastResults.length > 0
      ? this.lastResults
      : [{ kind: 'status', message: 'Search...' }];
  }

  renderSuggestion(result: InlineSearchSuggestion, el: HTMLElement): void {
    el.addClass('hybrid-search-inline-row');
    this.hookRenderedContainer(el);
    if (isStatusSuggestion(result)) {
      el.addClass('hybrid-search-inline-status-row');
      const content = el.createDiv({ cls: 'hybrid-search-inline-status-content' });
      content.createDiv({ cls: 'hybrid-search-inline-status-title', text: result.message });
      if (result.message !== 'Search...') {
        content.createDiv({
          cls: 'hybrid-search-inline-status-detail',
          text: 'Try another query or add filters.',
        });
      }
      return;
    }
    el.dataset.path = result.path.normalize('NFC');
    el.addEventListener('mouseenter', () => this.renderPreview(result));
    el.addEventListener('focusin', () => this.renderPreview(result));

    const title = result.title || result.path.replace(/^.*\//, '').replace(/\.md$/, '');
    const titleRow = el.createDiv({ cls: 'hybrid-search-inline-row-title' });
    createInternalLink(
      this.app,
      titleRow,
      result.path,
      title,
      'hybrid-search-inline-name',
      this.context?.file?.path ?? '',
    );
    titleRow.createSpan({
      cls: 'hybrid-search-inline-score',
      text: result.score.toFixed(2),
      attr: { style: `color:${scoreColor(result.score)}` },
    });

    if (this.plugin.settings.showMeta) {
      const folder = result.path.includes('/') ? result.path.replace(/\/[^/]+$/, '') : '';
      const meta = el.createDiv({ cls: 'hybrid-search-inline-meta' });
      if (folder) meta.createSpan({ text: folder });
      result.tags
        .slice(0, 4)
        .forEach((tag) => meta.createSpan({ cls: 'hybrid-search-tag', text: `#${tag}` }));
    }
    window.setTimeout(() => this.syncPreviewFromSelection(), 0);
  }

  selectSuggestion(result: InlineSearchSuggestion, evt: MouseEvent | KeyboardEvent): void {
    if (isStatusSuggestion(result)) return;
    const context = this.context;
    if (!context) return;
    if (evt instanceof KeyboardEvent) {
      const mode = modeForShortcut(evt.key);
      if (mode && (evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey) {
        this.currentMode = mode;
        return;
      }
    }
    if (evt.ctrlKey || evt.metaKey) {
      this.openResult(result, evt.shiftKey);
      this.close();
      return;
    }
    context.editor.replaceRange(
      fileToDragWikiLink(this.app, result.path, context.file?.path ?? ''),
      context.start,
      context.end,
    );
    this.close();
  }

  close(): void {
    this.requestId++;
    if (this.searchTimer !== undefined) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    super.close();
    this.hidePreview();
    this.selectedObserver?.disconnect();
    this.selectedObserver = undefined;
    this.renderedContainer = undefined;
    unhookSuperchargedLinks(this.app, this.superchargedLinksWatchId);
  }

  private openResult(result: SearchResult, newLeaf: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(result.path.normalize('NFC'));
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(newLeaf ? 'tab' : false).openFile(file);
    }
  }

  private renderPreview(result: SearchResult): void {
    if (!this.plugin.settings.inlineSearchShowPreview) return;
    this.ensurePreview();
    this.previewWrapEl?.show();
    void this.previewRenderer?.render(
      result.path,
      result.snippet,
      result.previewAnchors,
      result.primaryAnchorIndex,
    );
    this.positionPreview();
  }

  private ensurePreview(): void {
    if (this.previewWrapEl && this.previewRenderer) return;
    this.previewWrapEl = activeDocument.body.createDiv({ cls: 'hybrid-search-inline-preview' });
    this.previewEl = this.previewWrapEl.createDiv({
      cls: 'markdown-preview-view markdown-rendered',
    });
    this.previewRenderer = new SearchPreviewRenderer({
      app: this.app,
      containerEl: this.previewEl,
      getSourcePath: () => this.context?.file?.path ?? '',
      onPosition: () => this.positionPreview(),
    });
  }

  private hidePreview(): void {
    this.previewRenderer?.unload();
    this.previewRenderer = undefined;
    this.previewWrapEl?.remove();
    this.previewWrapEl = undefined;
    this.previewEl = undefined;
  }

  private positionPreview(): void {
    if (!this.previewWrapEl) return;
    const suggestEl =
      this.renderedContainer ??
      activeDocument.querySelector<HTMLElement>('.hybrid-search-inline-suggest-container');
    if (!suggestEl) return;
    const rect = suggestEl.getBoundingClientRect();
    const gap = 8;
    const width = this.previewWrapEl.offsetWidth || 460;
    const height = this.previewWrapEl.offsetHeight || 420;
    const rightLeft = rect.right + gap;
    const hasRightRoom = rightLeft + width + 8 <= window.innerWidth;
    const left = hasRightRoom ? rightLeft : Math.max(8, rect.left - width - gap);
    const top = clamp(rect.top, 8, Math.max(8, window.innerHeight - height - 8));
    this.previewWrapEl.style.left = `${left}px`;
    this.previewWrapEl.style.top = `${top}px`;
  }

  private hookRenderedContainer(el: HTMLElement): void {
    const container = el.closest<HTMLElement>('.suggestion-container, .suggestion');
    if (!container) return;
    if (this.renderedContainer === container) return;
    this.selectedObserver?.disconnect();
    this.renderedContainer = container;
    container.addClass('hybrid-search-inline-suggest-container');
    hookSuperchargedLinks(
      this.app,
      this.superchargedLinksWatchId,
      container,
      'a.hybrid-search-inline-name',
      'hybrid-search-inline-row',
    );
    this.selectedObserver = new MutationObserver(() => this.syncPreviewFromSelection());
    this.selectedObserver.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    window.setTimeout(() => this.syncPreviewFromSelection(), 0);
  }

  private syncPreviewFromSelection(): void {
    const container = this.renderedContainer;
    if (!container || !this.plugin.settings.inlineSearchShowPreview) return;
    const selected = container.querySelector<HTMLElement>(
      '.suggestion-item.is-selected, .suggestion-item.mod-selected, .is-selected',
    );
    const path =
      selected?.dataset.path ?? selected?.querySelector<HTMLElement>('[data-path]')?.dataset.path;
    if (!path) return;
    const result = this.lastResults.find((item) => item.path.normalize('NFC') === path);
    if (result) this.renderPreview(result);
  }

  private moveSelection(delta: number, evt: KeyboardEvent): void {
    const chooser = this.getChooser();
    const values = chooser?.values ?? [];
    if (values.length === 0) return;
    const current = chooser?.selectedItem ?? 0;
    const next = clamp(current + delta, 0, values.length - 1);
    if (chooser?.setSelectedItem) {
      chooser.setSelectedItem(next, evt);
    } else {
      this.setSelectedItemFallback(chooser, next);
    }
    window.setTimeout(() => this.syncPreviewFromSelection(), 0);
  }

  private getSelectedResult(): SearchResult | undefined {
    const chooser = this.getChooser();
    const selected = chooser?.values?.[chooser.selectedItem ?? 0];
    return selected && !isStatusSuggestion(selected) ? selected : undefined;
  }

  private insertSelectedFromChooser(): void {
    const result = this.getSelectedResult();
    const context = this.context;
    if (!result || !context) return;
    context.editor.replaceRange(
      fileToDragWikiLink(this.app, result.path, context.file?.path ?? ''),
      context.start,
      context.end,
    );
    this.close();
  }

  private insertAllResults(): void {
    const context = this.context;
    if (!context || this.lastResults.length === 0) return;
    const text = this.lastResults
      .map((result) => fileToDragWikiLink(this.app, result.path, context.file?.path ?? ''))
      .join('\n');
    context.editor.replaceRange(text, context.start, context.end);
    this.close();
  }

  private openSelectedFromChooser(newLeaf: boolean): void {
    const result = this.getSelectedResult();
    if (!result) return;
    this.openResult(result, newLeaf);
    this.close();
  }

  private openAllResults(): void {
    for (const result of this.lastResults) this.openResult(result, true);
    if (this.lastResults.length > 0) this.close();
  }

  private getChooser(): InternalSuggestChooser<InlineSearchSuggestion> | undefined {
    const internal = this as unknown as EditorSuggestWithInternal<InlineSearchSuggestion>;
    return internal.suggestions ?? internal.chooser;
  }

  private setSelectedItemFallback(
    chooser: InternalSuggestChooser<InlineSearchSuggestion> | undefined,
    index: number,
  ): void {
    if (!chooser) return;
    chooser.selectedItem = index;
    chooser.suggestions?.forEach((el, itemIndex) => {
      el.toggleClass('is-selected', itemIndex === index);
      if (itemIndex === index) el.scrollIntoView({ block: 'nearest' });
    });
  }
}

function isStatusSuggestion(result: InlineSearchSuggestion): result is InlineSearchStatus {
  return 'kind' in result;
}

function modeForShortcut(key: string): SearchMode | undefined {
  if (key === '1') return 'hybrid';
  if (key === '2') return 'semantic';
  if (key === '3') return 'fulltext';
  if (key === '4') return 'title';
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
