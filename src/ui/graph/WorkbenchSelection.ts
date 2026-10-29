import { Component, MarkdownView, setIcon, type App } from 'obsidian';
import { getAnchorOffset, getPrimaryAnchor } from '../../search/anchors';
import type { SearchResult, SearchService } from '../../search/contracts';
import {
  createExcerptHighlighter,
  excerptPlainText,
  prepareResultExcerpt,
} from '../../search/excerpts';
import { searchSelection } from '../../search/selectionSearch';
import { createTreeItemLink } from '../shared/noteUtils';

interface SelectionOptions {
  getClient(): SearchService | undefined;
  isEnabled(): boolean;
  getLimit(): number;
  onScopeChange(): void;
  openResult(result: SearchResult, newLeaf: boolean): void;
}

interface CapturedSelection {
  path: string;
  text: string;
  sourceText?: string;
  from?: number;
  to?: number;
}

/** Transient selection scope. It never changes the normal Best result DOM or ranking. */
export class WorkbenchSelection extends Component {
  readonly containerEl: HTMLElement;
  private sourcePath: string | null = null;
  private client?: SearchService;
  private captured?: CapturedSelection;
  private lastSelection = '';
  private requestId = 0;
  private closed = true;
  private timer?: number;
  private timerWindow?: Window;
  private resultsEl!: HTMLElement;
  private documentEvents?: Component;

  constructor(
    private app: App,
    parent: HTMLElement,
    private options: SelectionOptions,
  ) {
    super();
    this.containerEl = parent.createDiv({ cls: 'ohs-workbench-selection' });
    this.containerEl.hidden = true;
  }

  get hasSelection(): boolean {
    return !!this.captured;
  }

  onload(): void {
    this.closed = false;
    this.bindDocument();
    this.register(
      this.containerEl.onWindowMigrated(() => {
        this.clear();
        this.lastSelection = '';
        this.bindDocument();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, info) => {
        const file = info.file;
        if (file && file.path.normalize('NFC') === this.sourcePath) this.clear();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file.path.normalize('NFC') === this.sourcePath) this.clear();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => this.syncSource(file?.path ?? null)),
    );
  }

  private bindDocument(): void {
    if (this.documentEvents) this.removeChild(this.documentEvents);
    this.documentEvents = this.addChild(new Component());
    const doc = this.containerEl.ownerDocument;
    this.documentEvents.registerDomEvent(doc, 'selectionchange', () => this.capture());
    this.documentEvents.registerDomEvent(doc, 'pointerup', (evt) => this.capture(evt.target));
    this.documentEvents.registerDomEvent(doc, 'keyup', (evt) => this.capture(evt.target));
  }

  onunload(): void {
    this.closed = true;
    this.clear();
    this.containerEl.remove();
  }

  syncSource(path: string | null): void {
    const normalized = path?.normalize('NFC') ?? null;
    const client = this.options.getClient();
    if (normalized === this.sourcePath && client === this.client) return;
    this.sourcePath = normalized;
    this.client = client;
    this.lastSelection = '';
    this.clear();
  }

  setVisible(visible: boolean): void {
    this.containerEl.hidden = !visible || !this.captured;
  }

  clear(): void {
    this.cancelCapture();
    this.requestId++;
    this.captured = undefined;
    this.containerEl.empty();
    this.containerEl.hidden = true;
    this.options.onScopeChange();
  }

  refresh(): void {
    if (this.captured && !this.closed) void this.search(this.captured);
  }

  private cancelCapture(): void {
    if (this.timer !== undefined) this.timerWindow?.clearTimeout(this.timer);
    this.timer = undefined;
    this.timerWindow = undefined;
  }

  private capture(target?: EventTarget | null): void {
    if (this.closed || !this.options.isEnabled()) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path.normalize('NFC');
    if (!view || !path || path !== this.sourcePath) return;
    const doc = this.containerEl.ownerDocument;
    if (view.contentEl.ownerDocument !== doc) return;
    if (target && !view.contentEl.contains(target as Node)) return;
    const selection = doc.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !view.contentEl.contains(selection.anchorNode) ||
      !view.contentEl.contains(selection.focusNode)
    )
      return;
    for (const node of [selection.anchorNode, selection.focusNode]) {
      const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
      if (
        element?.closest(
          '.hybrid-search-similar-bottom, .hybrid-search-panel, .hybrid-search-graph-workbench',
        )
      )
        return;
    }

    const editing = view.getMode() === 'source';
    const text = editing ? view.editor.getSelection() : selection.toString();
    if (!text.trim()) {
      this.lastSelection = '';
      return;
    }
    const from = editing ? view.editor.posToOffset(view.editor.getCursor('from')) : undefined;
    const to = editing ? view.editor.posToOffset(view.editor.getCursor('to')) : undefined;
    const key = JSON.stringify([path, from, to, text]);
    if (key === this.lastSelection) return;
    this.cancelCapture();
    const captured: CapturedSelection = {
      path,
      text,
      from,
      to,
      sourceText: editing ? view.editor.getValue() : undefined,
    };
    this.timerWindow = this.containerEl.win;
    this.timer = this.timerWindow.setTimeout(() => {
      this.timer = undefined;
      this.timerWindow = undefined;
      if (this.closed || path !== this.sourcePath || !this.options.isEnabled()) return;
      this.lastSelection = key;
      this.captured = captured;
      this.renderHeader();
      this.options.onScopeChange();
      void this.search(captured);
    }, 250);
  }

  private renderHeader(): void {
    this.containerEl.empty();
    if (!this.captured) return;
    const header = this.containerEl.createDiv({ cls: 'ohs-workbench-selection-header' });
    const preview = Array.from(excerptPlainText(this.captured.text));
    header.createDiv({
      cls: 'ohs-workbench-selection-quote',
      text: preview.slice(0, 280).join('') + (preview.length > 280 ? '…' : ''),
    });
    const reset = header.createEl('button', {
      cls: 'ohs-workbench-selection-reset',
      text: 'Use whole note',
    });
    reset.addEventListener('click', () => this.clear());
    this.resultsEl = this.containerEl.createDiv({ cls: 'ohs-workbench-selection-results' });
    this.containerEl.hidden = false;
  }

  private async search(captured: CapturedSelection): Promise<void> {
    const request = ++this.requestId;
    const client = this.options.getClient();
    const isCurrent = () =>
      !this.closed &&
      request === this.requestId &&
      captured === this.captured &&
      client === this.options.getClient() &&
      captured.path === this.sourcePath;
    this.resultsEl.empty();
    this.showStatus('Finding matches…');
    try {
      if (!client) throw new Error('Search unavailable');
      const results = await searchSelection(client, captured, this.options.getLimit(), isCurrent);
      if (!results || !isCurrent()) return;
      this.resultsEl.empty();
      const seen = new Set<string>();
      const visible = results
        .filter((result) => {
          const path = result.path.normalize('NFC');
          if (seen.has(path) || this.isSelectedPassage(result, captured)) return false;
          seen.add(path);
          return true;
        })
        .slice(0, this.options.getLimit());
      if (!visible.length) this.showStatus('No matches for this selection.');
      for (const result of visible) this.renderResult(result, captured);
    } catch {
      if (!isCurrent()) return;
      this.resultsEl.empty();
      this.showStatus('Search unavailable.');
      const retry = this.resultsEl.createEl('button', {
        cls: 'ohs-workbench-selection-retry',
        text: 'Retry',
      });
      retry.addEventListener('click', () => this.refresh());
    }
  }

  private isSelectedPassage(result: SearchResult, captured: CapturedSelection): boolean {
    if (result.path.normalize('NFC') !== captured.path) return false;
    const anchor = getPrimaryAnchor(result);
    if (!anchor) return true;
    if (
      captured.sourceText !== undefined &&
      captured.from !== undefined &&
      captured.to !== undefined
    ) {
      const start = getAnchorOffset(captured.sourceText, anchor);
      if (start >= 0 && anchor.matchText) {
        return start < captured.to && start + anchor.matchText.length > captured.from;
      }
    }
    const match = excerptPlainText(anchor.matchText);
    return !match || excerptPlainText(captured.text).includes(match);
  }

  private showStatus(message: string): void {
    this.resultsEl.createDiv({
      cls: 'ohs-workbench-selection-status',
      text: message,
      attr: { role: 'status' },
    });
  }

  private renderResult(result: SearchResult, captured: CapturedSelection): void {
    const item = this.resultsEl.createDiv({
      cls: 'tree-item ohs-workbench-result ohs-workbench-selection-result is-collapsed',
    });
    item.dataset.sourcePath = captured.path;
    const row = item.createDiv({
      cls: 'tree-item-self search-result-file-title ohs-workbench-row',
    });
    const expand = row.createEl('button', {
      cls: 'ohs-workbench-selection-expand',
      attr: { 'aria-label': 'Show matching passage', 'aria-expanded': 'false' },
    });
    setIcon(expand, 'chevron-right');
    const link = createTreeItemLink(
      this.app,
      row,
      result.path,
      result.title,
      'ohs-workbench-link',
      captured.path,
    );
    link.setAttribute('role', 'link');
    link.tabIndex = 0;
    link.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.options.openResult(result, evt.ctrlKey || evt.metaKey);
    });
    link.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter') return;
      evt.preventDefault();
      this.options.openResult(result, evt.ctrlKey || evt.metaKey);
    });
    let details: HTMLElement | undefined;
    expand.addEventListener('click', () => {
      if (details) {
        details.remove();
        details = undefined;
      } else {
        details = item.createDiv({ cls: 'ohs-workbench-selection-details' });
        const excerpt = prepareResultExcerpt(result, createExcerptHighlighter(captured.text));
        if (excerpt) {
          const passage = details.createEl('button', {
            cls: 'ohs-workbench-selection-excerpt',
            text: excerpt.section ? `${excerpt.section} · ${excerpt.text}` : excerpt.text,
            attr: { 'aria-label': 'Open matching passage' },
          });
          passage.addEventListener('click', (evt) =>
            this.options.openResult(result, evt.ctrlKey || evt.metaKey),
          );
        } else {
          details.createDiv({
            cls: 'ohs-workbench-selection-status',
            text: 'No passage preview available.',
          });
        }
      }
      item.toggleClass('is-collapsed', !details);
      expand.setAttribute('aria-expanded', String(!!details));
      expand.setAttribute(
        'aria-label',
        details ? 'Hide matching passage' : 'Show matching passage',
      );
      setIcon(expand, details ? 'chevron-down' : 'chevron-right');
    });
  }
}
