import {
  App,
  debounce,
  MarkdownRenderChild,
  MarkdownRenderer,
  setIcon,
  SuggestModal,
  TFile,
} from 'obsidian';
import type { MatchAnchor, SearchClient, SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';
import { createBodyPanel } from './bodyPanels';
import { GraphPanel } from './GraphPanel';
import { hookInternalLinks } from './linkHandler';
import { registerModalKeymap } from './modalKeymap';
import {
  applySuperchargedLinkAttributes,
  createInternalLink,
  fetchSimilarNotesDetailed,
  getAnchorOffset,
  getResultTitle,
  hookSuperchargedLinks,
  modeLabel,
  resolveSimilarTarget,
  scoreColor,
  unhookSuperchargedLinks,
  type SuperchargedWatch,
} from './noteUtils';
import { applyCustomPostfixes, applyDefaultFilters, parseQuery } from './queryParser';

type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

const RECENT_FILES_LIMIT = 20; // local cap for recent-files list only

export interface SearchModalOptions {
  /** Path of the note that was active when the modal opened, used by the "~" scope. */
  activePath?: string;
  /** Pins the modal to one mode instead of following `settings.defaultMode`. */
  forcedMode?: SearchMode;
  /** Called once the modal has closed, so the owner can stop tracking it. */
  onDidClose?: (modal: SearchModal) => void;
  /** Plugin instance id stamped onto body-level panels, see `bodyPanels.ts`. */
  ownerId?: string;
}

export class SearchModal extends SuggestModal<SearchResult> {
  private debounce?: number;
  private previewEl?: HTMLDivElement;
  private previewMetaEl?: HTMLDivElement;
  private previewChild?: MarkdownRenderChild;
  private currentPreviewPath?: string;
  private currentPreviewContent?: string;
  private currentAnchorKey?: string;
  private previewCallId = 0;
  private isRecentMode = false;
  private currentMode: 'hybrid' | 'semantic' | 'fulltext' | 'title' = 'hybrid';
  private currentQueryWords: string[] = [];

  private modeEl?: HTMLSpanElement;
  private graphPanel?: GraphPanel;

  private readonly debouncedPreview = debounce(
    (path: string, snippet?: string, anchors?: MatchAnchor[], primaryIdx?: number) => {
      void this.updatePreview(path, snippet, anchors, primaryIdx);
    },
    100,
    true, // resetTimer: true — resets on each call, fires after the last one
  );

  private readonly activePath?: string;
  private readonly forcedMode?: SearchMode;
  private readonly onDidClose?: (modal: SearchModal) => void;
  private readonly ownerId?: string;

  constructor(
    app: App,
    private client: Pick<SearchClient, 'search'>,
    private settings: HybridSearchSettings,
    private readonly saveSettings: () => Promise<void>,
    options: SearchModalOptions = {},
  ) {
    super(app);
    this.activePath = options.activePath;
    this.forcedMode = options.forcedMode;
    this.onDidClose = options.onDidClose;
    this.ownerId = options.ownerId;
    this.setPlaceholder('Hybrid search: type to search your vault...');
  }

  open(): void {
    super.open();
    this.injectModeBadge();
    this.hookSuperchargedLinks();
    registerModalKeymap(this, this.app, this.settings, this.saveSettings);
    this.graphPanel?.unload();
    this.graphPanel = new GraphPanel(this.app, {
      onCloseModal: () => this.close(),
      ownerId: this.ownerId,
    });
    if (!this.settings.showGraphPanel) this.graphPanel.hide();
    if (this.settings.rememberLastQuery && this.settings.lastQuery) {
      this.inputEl.value = this.settings.lastQuery;
      this.inputEl.dispatchEvent(new Event('input'));
    }
    // Pre-warm the embedding model so it is loaded by the time the user types.
    // Ollama and local models can take several seconds on first inference after idle.
    const mode = this.forcedMode ?? this.settings.defaultMode;
    if (mode === 'hybrid' || mode === 'semantic') {
      void this.client.search(' ', { mode, limit: 1, snippetLength: 0 }).catch(() => {});
    }
  }

  private injectModeBadge(): void {
    const container = this.containerEl.querySelector('.prompt-input-container');
    if (!container) return;
    // super.open() already called getSuggestions('') before this runs, so
    // match the same initial label that getSuggestions would have set.
    const initialLabel = this.activePath ? '~' : 'R';
    this.modeEl = (container as HTMLElement).createSpan({
      cls: 'hybrid-search-mode-badge',
      text: initialLabel,
    });
  }

  private updateModeBadge(label: string): void {
    if (this.modeEl) this.modeEl.textContent = label;
  }

  getGraphPanel(): GraphPanel | undefined {
    return this.graphPanel;
  }

  hidePreviewPanel(): void {
    this.debouncedPreview.cancel();
    this.previewCallId++;
    this.previewChild?.unload();
    this.previewChild = undefined;
    this.previewEl?.remove();
    this.previewEl = undefined;
    this.previewMetaEl?.remove();
    this.previewMetaEl = undefined;
    this.currentPreviewPath = undefined;
    this.currentPreviewContent = undefined;
    this.currentAnchorKey = undefined;
  }

  private clearHighlights(): void {
    if (!this.previewEl) return;
    for (const el of this.previewEl.querySelectorAll('.hybrid-search-semantic-match')) {
      el.classList.remove('hybrid-search-semantic-match');
    }
    // Unwrap word-match spans: replace each with a plain text node
    for (const span of Array.from(this.previewEl.querySelectorAll('.hybrid-search-word-match'))) {
      span.replaceWith(activeDocument.createTextNode(span.textContent ?? ''));
    }
  }

  private findHeadingElement(headingPath: string | null): HTMLElement | undefined {
    if (!this.previewEl || !headingPath) return undefined;
    const leaf = headingPath.split(' > ').pop()?.trim().toLowerCase();
    if (!leaf) return undefined;
    const headings = Array.from(this.previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
      (h) => !h.closest('.callout'),
    );
    return headings.find((h) => (h.textContent ?? '').trim().toLowerCase() === leaf) as
      | HTMLElement
      | undefined;
  }

  private getHeadingSiblings(headingEl: HTMLElement): Element[] {
    const level = parseInt(headingEl.tagName[1]!, 10); // H3 → 3
    const parent = headingEl.parentElement;
    if (!parent) return [];
    const siblings: Element[] = [];
    let found = false;
    for (const child of parent.children) {
      if (child === headingEl) {
        found = true;
        continue;
      }
      if (!found) continue;
      const m = /^H([1-6])$/.exec(child.tagName);
      if (m && parseInt(m[1]!, 10) <= level) break;
      siblings.push(child);
    }
    return siblings;
  }

  private findAnchorBlock(anchor: MatchAnchor): HTMLElement | undefined {
    if (!this.previewEl) return undefined;
    const headingEl = this.findHeadingElement(anchor.headingPath);
    const region: Element[] = headingEl
      ? [headingEl, ...this.getHeadingSiblings(headingEl)]
      : Array.from(
          this.previewEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'),
        ).filter((b) => !b.closest('.callout'));

    if (!anchor.matchText) return headingEl;

    const needle = anchor.matchText.toLowerCase();
    const blockSel = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';
    const matches: HTMLElement[] = [];

    for (const el of region) {
      if (el.closest('.callout')) continue;
      if (el.matches(blockSel) && (el.textContent ?? '').toLowerCase().includes(needle)) {
        matches.push(el as HTMLElement);
      }
      // Check nested blocks inside container elements (e.g. div.callout excluded above)
      for (const nested of el.querySelectorAll(blockSel)) {
        if ((nested.textContent ?? '').toLowerCase().includes(needle)) {
          matches.push(nested as HTMLElement);
        }
      }
    }
    if (matches.length > 0) return this.pickClosestByOffset(matches, anchor);

    // Fallback A: search inside callout titles and content (for notes whose content is entirely callout blocks)
    for (const titleEl of this.previewEl.querySelectorAll('.callout-title-inner')) {
      if ((titleEl.textContent ?? '').toLowerCase().includes(needle)) return titleEl as HTMLElement;
    }
    for (const contentEl of this.previewEl.querySelectorAll('.callout-content p')) {
      if ((contentEl.textContent ?? '').toLowerCase().includes(needle))
        return contentEl as HTMLElement;
    }
    // Fallback B: heading element itself
    return headingEl;
  }

  /** Multiple rendered blocks can contain the same matchText (repeated phrasing across a note).
   *  Use the anchor's real source offset — validated via the same getAnchorOffset the search
   *  panel/graph workbench use for cursor positioning — to pick the occurrence actually meant,
   *  instead of always taking the first DOM match. */
  private pickClosestByOffset(matches: HTMLElement[], anchor: MatchAnchor): HTMLElement {
    if (matches.length === 1 || !this.previewEl || !this.currentPreviewContent) return matches[0]!;

    const offset = getAnchorOffset(this.currentPreviewContent, anchor);
    if (offset < 0) return matches[0]!;
    const targetFraction = offset / this.currentPreviewContent.length;

    const allBlocks = Array.from(
      this.previewEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'),
    ).filter((b) => !b.closest('.callout'));
    const totalLength = this.previewEl.textContent?.length || 1;

    let best = matches[0]!;
    let bestDiff = Infinity;
    let consumed = 0;
    for (const block of allBlocks) {
      if (matches.includes(block as HTMLElement)) {
        const diff = Math.abs(consumed / totalLength - targetFraction);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = block as HTMLElement;
        }
      }
      consumed += (block.textContent ?? '').length;
    }
    return best;
  }

  triggerPreview(
    nfcPath: string,
    snippet?: string,
    anchors?: MatchAnchor[],
    primaryIdx?: number,
  ): void {
    if (this.settings.showPreview) {
      this.debouncedPreview(nfcPath, snippet, anchors, primaryIdx);
    }
    if (this.settings.showGraphPanel) {
      this.graphPanel?.show(nfcPath);
      this.positionGraphPanel();
    }
  }

  onClose(): void {
    try {
      if (this.settings.rememberLastQuery && this.inputEl) {
        this.settings.lastQuery = this.inputEl.value.trim();
        void this.saveSettings();
      }
      this.unhookSuperchargedLinks();
    } finally {
      try {
        this.hidePreviewPanel();
        this.graphPanel?.unload();
        this.graphPanel = undefined;
        // Restore modal's default centering (in case positionPreview shifted it)
        this.modalEl.style.left = ``;
        this.modalEl.style.transform = ``;
      } finally {
        this.onDidClose?.(this);
      }
    }
  }

  async getSuggestions(query: string): Promise<SearchResult[]> {
    // Reset up front so the "@similar" message set below cannot survive into an unrelated
    // query — including the empty-query paths (similar-to-active, recent files), which
    // return before any later reset would run.
    this.emptyStateText = 'No results found.';
    if (!query.trim()) {
      if (this.activePath) {
        // Active note open: show semantically similar notes
        this.isRecentMode = false;
        this.updateModeBadge('~');
        return new Promise((resolve) => {
          window.clearTimeout(this.debounce);
          this.debounce = window.setTimeout(() => {
            this.fetchSimilar(resolve);
          }, 150);
        });
      }
      // No active note: show recently opened files
      this.isRecentMode = true;
      this.updateModeBadge('R');
      return this.buildRecentResults();
    }
    this.isRecentMode = false;

    const { query: parsedQuery, overrides } = parseQuery(
      applyDefaultFilters(
        applyCustomPostfixes(query, this.settings.customPostfixes),
        this.settings.defaultSearchFilters,
      ),
    );
    // `@similar` resolves against the snapshot taken when the modal opened — the same
    // source of truth the empty-query `~` mode uses. Computed here, outside the debounce
    // closure below, so the badge and the request agree on one resolution.
    const notePath = overrides.similar
      ? resolveSimilarTarget(this.app, overrides.similar, this.activePath, this.activePath ?? '')
      : null;

    if (overrides.similar && !notePath) {
      this.emptyStateText = 'Open a note to use @similar.';
      this.updateModeBadge('~');
      return [];
    }

    this.currentMode = overrides.mode ?? this.forcedMode ?? this.settings.defaultMode;
    // With a notePath the free text was never sent to the backend, so highlighting it in the
    // preview would mark words that had no influence on the results.
    this.currentQueryWords = notePath
      ? []
      : parsedQuery
          .split(/\s+/)
          .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
          .filter((w) => w.length >= 2);
    this.updateModeBadge(
      notePath
        ? '~'
        : modeLabel(
            overrides.mode ?? this.forcedMode ?? this.settings.defaultMode,
            overrides.rerank ?? false,
          ),
    );

    return new Promise((resolve) => {
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => {
        this.client
          // The backend ignores the query string during a path lookup, so send '' rather
          // than the leftover free text — it would only look like it had been searched for.
          .search(notePath ? '' : parsedQuery, {
            mode: overrides.mode ?? this.forcedMode ?? this.settings.defaultMode,
            ...(notePath && { notePath }),
            ...(overrides.limit !== undefined && { limit: overrides.limit }),
            snippetLength: this.settings.showPreview && this.settings.scrollToSnippet ? 400 : 0,
            anchors: this.settings.showPreview && this.settings.scrollToSnippet,
            ...(overrides.tag !== undefined && { tag: overrides.tag }),
            ...(overrides.scope !== undefined && { scope: overrides.scope }),
            ...(overrides.frontmatter !== undefined && { frontmatter: overrides.frontmatter }),
            ...(overrides.rerank !== undefined && { rerank: overrides.rerank }),
            ...(overrides.threshold !== undefined && { threshold: overrides.threshold }),
          })
          .then((results) => resolve([...results].sort(byScoreDesc)))
          .catch(() => resolve([]));
      }, 150);
    });
  }

  private fetchSimilar(resolve: (r: SearchResult[]) => void): void {
    void this.doFetchSimilar()
      .then(resolve)
      .catch(() => resolve([]));
  }

  private async doFetchSimilar(): Promise<SearchResult[]> {
    const path = this.activePath!;
    const result = await fetchSimilarNotesDetailed(this.client, path, {
      limit: this.settings.similarNotesBottomLimit,
      threshold: this.settings.similarNotesThreshold,
    });
    this.isRecentMode = result.scoreMode === 'structural';
    return result.results;
  }

  private buildRecentResults(): SearchResult[] {
    const recentPaths = this.app.workspace.getLastOpenFiles().slice(0, RECENT_FILES_LIMIT);
    const results: SearchResult[] = [];
    for (const p of recentPaths) {
      const file = this.app.vault.getAbstractFileByPath(p);
      if (!(file instanceof TFile) || file.extension !== 'md') continue;
      const cache = this.app.metadataCache.getCache(p);
      const fm = cache?.frontmatter;
      const title = getResultTitle(this.app, { path: p, title: '' });
      const tags = Array.isArray(fm?.tags) ? (fm.tags as string[]) : [];
      const aliases = Array.isArray(fm?.aliases) ? (fm.aliases as string[]) : [];
      results.push({ path: p, title, score: 0, tags, aliases });
    }
    return results;
  }

  renderSuggestion(result: SearchResult, el: HTMLElement): void {
    // DB paths are NFD-normalized; Obsidian's internal APIs (metadataCache, vault,
    // data-href resolution) require NFC — same fix as cli.ts line 50.
    const nfcPath = result.path.normalize('NFC');
    const score = result.score;
    const color = scoreColor(score);

    const container = el.createDiv({ cls: 'hybrid-search-result' });

    const titleRow = container.createDiv({ cls: 'hybrid-search-title' });
    createInternalLink(
      this.app,
      titleRow,
      nfcPath,
      result.title || result.path,
      'hybrid-search-name',
    );

    if (!this.isRecentMode) {
      titleRow.createSpan({
        text: score.toFixed(2),
        cls: 'hybrid-search-score',
        attr: { style: `color:${color}` },
      });
    }

    if (this.settings.showMeta) {
      const folder = result.path.includes('/') ? result.path.replace(/\/[^/]+$/, '') : '';
      const metaRow = container.createDiv({ cls: 'hybrid-search-meta' });
      if (folder) {
        const pathSpan = metaRow.createSpan({ cls: 'hybrid-search-meta-path' });
        setIcon(pathSpan, 'folder');
        pathSpan.createSpan({ text: folder });
      }
      result.tags
        .slice(0, 5)
        .forEach((tag) => metaRow.createSpan({ text: `#${tag}`, cls: 'hybrid-search-tag' }));
    }

    el.addEventListener('mouseenter', () => {
      const nfcPath = result.path.normalize('NFC');
      if (this.settings.showPreview) {
        this.debouncedPreview(
          nfcPath,
          result.snippet,
          result.previewAnchors,
          result.primaryAnchorIndex,
        );
      }
      if (this.settings.showGraphPanel) {
        this.graphPanel?.show(nfcPath);
        this.positionGraphPanel();
      }
    });
  }

  onChooseSuggestion(result: SearchResult, _evt: MouseEvent | KeyboardEvent): void {
    const abstract = this.app.vault.getAbstractFileByPath(result.path.normalize('NFC'));
    if (abstract instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(abstract);
    }
  }

  // @ts-ignore — internal SuggestModal API not in type declarations; fires on arrow-key navigation
  onSelectedChange(result: SearchResult | null): void {
    if (!result) return;
    const nfcPath = result.path.normalize('NFC');
    if (this.settings.showPreview) {
      this.debouncedPreview(
        nfcPath,
        result.snippet,
        result.previewAnchors,
        result.primaryAnchorIndex,
      );
    }
    if (this.settings.showGraphPanel) {
      this.graphPanel?.show(nfcPath);
      this.positionGraphPanel();
    }
  }

  private async updatePreview(
    path: string,
    snippet?: string,
    anchors?: MatchAnchor[],
    primaryIdx?: number,
  ): Promise<void> {
    if (!this.settings.showPreview) return;
    // Normalize to NFC: DB paths are NFD, Obsidian APIs require NFC (same as cli.ts)
    const nfcPath = path.normalize('NFC');
    const key = anchorKey(anchors, primaryIdx);

    if (nfcPath === this.currentPreviewPath) {
      // Same note — only re-highlight if anchor changed
      if (key !== this.currentAnchorKey) {
        this.currentAnchorKey = key;
        this.clearHighlights();
        if (anchors?.length && this.settings.scrollToSnippet) {
          this.applyAnchorHighlight(anchors, primaryIdx ?? 0);
        } else if (snippet && this.settings.scrollToSnippet) {
          this.applySnippetHighlight(snippet);
        }
      }
      return;
    }

    const callId = ++this.previewCallId;

    // Synchronous DOM setup — must happen before any await
    if (!this.previewEl) {
      this.previewEl = createBodyPanel('hybrid-search-preview', this.ownerId);
      this.hookPreviewLinks();
    }
    this.previewEl.show();
    this.previewChild?.unload();
    this.previewChild = undefined;
    this.previewEl.empty();

    const abstract = this.app.vault.getAbstractFileByPath(nfcPath);
    if (!abstract || !(abstract instanceof TFile)) return;

    let content: string;
    try {
      content = await this.app.vault.cachedRead(abstract);
    } catch {
      this.previewEl.hide();
      return;
    }

    if (callId !== this.previewCallId) return;

    this.previewChild = new MarkdownRenderChild(this.previewEl);
    this.previewChild.load();
    await MarkdownRenderer.render(this.app, content, this.previewEl, nfcPath, this.previewChild);
    if (callId !== this.previewCallId) return;

    this.currentPreviewPath = nfcPath;
    this.currentPreviewContent = content;
    this.currentAnchorKey = key;

    if (anchors?.length && this.settings.scrollToSnippet) {
      this.applyAnchorHighlight(anchors, primaryIdx ?? 0);
    } else if (snippet && this.settings.scrollToSnippet) {
      this.applySnippetHighlight(snippet);
    }

    // Re-position after render: modal may have grown taller as results loaded
    this.positionPreview();
    this.positionGraphPanel();
    this.updatePreviewMeta(nfcPath);
  }

  private applySnippetHighlight(snippet: string): void {
    if (!this.previewEl) return;
    if (this.currentMode === 'title') return;

    const candidates = this.currentMode === 'fulltext' ? [] : snippetScrollCandidates(snippet);
    const scrollTarget = this.findSnippetBlock(candidates);

    this.markSnippetBlock(scrollTarget, candidates);

    if (this.currentMode !== 'semantic') this.highlightQueryWords();

    if (scrollTarget) this.scheduleSnippetScroll(scrollTarget);
  }

  /** Find the first DOM block matching the snippet (or a query word in fulltext mode). */
  private findSnippetBlock(candidates: string[]): HTMLElement | undefined {
    if (!this.previewEl) return undefined;
    const blockSelector = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';
    // Skip callout divs: ToC callouts duplicate heading text before actual headings in DOM.
    const blocks = Array.from(this.previewEl.querySelectorAll(blockSelector)).filter(
      (b) => !b.closest('.callout'),
    );
    if (this.currentMode === 'fulltext') {
      return blocks.find((b) =>
        this.currentQueryWords.some((w) => (b.textContent ?? '').toLowerCase().includes(w)),
      ) as HTMLElement | undefined;
    }
    for (const needle of candidates) {
      const found = blocks.find((b) => (b.textContent ?? '').toLowerCase().includes(needle));
      if (found) return found as HTMLElement;
    }
    return undefined;
  }

  /** Mark the matched block with the accent class.
   *  For <li>: mark all sibling list items that match a candidate instead of the parent <ul>. */
  private markSnippetBlock(scrollTarget: HTMLElement | undefined, candidates: string[]): void {
    if (!scrollTarget) return;
    if (scrollTarget.tagName !== 'LI' || candidates.length === 0) {
      scrollTarget.classList.add('hybrid-search-semantic-match');
      return;
    }
    const parentList = scrollTarget.parentElement;
    if (!parentList) {
      scrollTarget.classList.add('hybrid-search-semantic-match');
      return;
    }
    for (const li of parentList.querySelectorAll(':scope > li')) {
      const text = (li.textContent ?? '').toLowerCase();
      if (candidates.some((c) => text.includes(c))) {
        (li as HTMLElement).classList.add('hybrid-search-semantic-match');
      }
    }
  }

  /** Defer scroll to let async plugins (Dataview, ToC) finish injecting content. */
  private scheduleSnippetScroll(scrollTarget: HTMLElement): void {
    const snapPath = this.currentPreviewPath;
    const snapTarget = scrollTarget;
    const doScroll = () => {
      if (!this.previewEl || this.currentPreviewPath !== snapPath) return;
      if (!snapTarget.isConnected) return;
      const containerRect = this.previewEl.getBoundingClientRect();
      const targetRect = snapTarget.getBoundingClientRect();
      const absolutePos = targetRect.top - containerRect.top + this.previewEl.scrollTop;
      const target = Math.max(0, absolutePos - 16);
      if (Math.abs(this.previewEl.scrollTop - target) > 8) this.previewEl.scrollTop = target;
    };
    window.setTimeout(doScroll, 150);
    window.setTimeout(doScroll, 400);
  }

  private highlightQueryWords(): void {
    if (!this.previewEl) return;
    const words = this.currentQueryWords;
    if (words.length === 0) return;
    const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');

    const textNodes: Text[] = [];
    const walker = activeDocument.createTreeWalker(this.previewEl, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const frag = createFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m.index > last)
          frag.appendChild(activeDocument.createTextNode(text.slice(last, m.index)));
        const span = createSpan({ cls: 'hybrid-search-word-match', text: m[0] });
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(activeDocument.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  private highlightQueryWordsInRegion(elements: Element[]): void {
    const words = this.currentQueryWords;
    if (words.length === 0) return;
    const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');

    const textNodes: Text[] = [];
    for (const el of elements) {
      const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const frag = createFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m.index > last)
          frag.appendChild(activeDocument.createTextNode(text.slice(last, m.index)));
        const span = createSpan({ cls: 'hybrid-search-word-match', text: m[0] });
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(activeDocument.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  private applyAnchorHighlight(anchors: MatchAnchor[], primaryIdx: number): void {
    const mode = this.currentMode;
    if (mode === 'title') return;
    if (!this.previewEl) return;

    const collectedBlocks: Array<{ el: HTMLElement; isPrimary: boolean }> = [];
    const highlightRegions: Element[] = [];

    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i]!;
      const block = this.findAnchorBlock(anchor);
      if (!block) continue;

      const isPrimary = i === primaryIdx;
      // Only the primary anchor's block gets the "this is the match" accent — a secondary
      // (e.g. bm25) anchor pointing at unrelated text would otherwise show an identical
      // accent next to it with nothing to distinguish which one is actually scrolled to.
      if (isPrimary) block.classList.add('hybrid-search-semantic-match');
      collectedBlocks.push({ el: block, isPrimary });

      const headingEl = this.findHeadingElement(anchor.headingPath);
      if (headingEl) {
        highlightRegions.push(headingEl, ...this.getHeadingSiblings(headingEl));
      } else {
        highlightRegions.push(block);
      }
    }

    if (mode !== 'semantic' && this.currentQueryWords.length > 0) {
      this.highlightQueryWordsInRegion(
        highlightRegions.length > 0 ? highlightRegions : [this.previewEl],
      );
    }

    const primary = collectedBlocks.find((b) => b.isPrimary) ?? collectedBlocks[0];
    if (primary) this.scheduleSnippetScroll(primary.el);
  }

  private updatePreviewMeta(nfcPath: string): void {
    if (!this.settings.showPreviewMeta || !this.previewEl) return;

    if (!this.previewMetaEl) {
      this.previewMetaEl = createBodyPanel('hybrid-search-preview-meta-panel', this.ownerId);
      this.hookMetaLinks();
    }
    this.previewMetaEl.empty();

    const folder = nfcPath.includes('/') ? nfcPath.replace(/\/[^/]+$/, '') : '';
    const cache = this.app.metadataCache.getCache(nfcPath);
    const fm = cache?.frontmatter;
    const aliases: string[] = Array.isArray(fm?.['aliases']) ? (fm['aliases'] as string[]) : [];
    const tags: string[] = Array.isArray(fm?.['tags']) ? (fm['tags'] as string[]) : [];
    const resolvedLinks: Record<string, Record<string, number>> = this.app.metadataCache
      .resolvedLinks;
    const outgoing = Object.keys(resolvedLinks[nfcPath] ?? {});
    const incoming: string[] = [];
    for (const [src, targets] of Object.entries(resolvedLinks)) {
      if (nfcPath in targets) incoming.push(src);
    }

    if (
      !folder &&
      aliases.length === 0 &&
      tags.length === 0 &&
      outgoing.length === 0 &&
      incoming.length === 0
    ) {
      this.previewMetaEl.hide();
      return;
    }

    if (folder) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      const iconSpan = row.createSpan({ cls: 'hybrid-search-preview-meta-icon' });
      setIcon(iconSpan, 'folder');
      row.createSpan({ text: folder, cls: 'hybrid-search-preview-meta-folder' });
    }

    if (aliases.length > 0) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      const iconSpan = row.createSpan({ cls: 'hybrid-search-preview-meta-icon' });
      setIcon(iconSpan, 'at-sign');
      for (const alias of aliases) {
        row.createSpan({ text: alias, cls: 'hybrid-search-preview-meta-alias' });
      }
    }

    if (tags.length > 0) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      const iconSpan = row.createSpan({ cls: 'hybrid-search-preview-meta-icon' });
      setIcon(iconSpan, 'tag');
      for (const tag of tags) {
        row.createSpan({ text: `#${tag}`, cls: 'hybrid-search-tag' });
      }
    }

    if (outgoing.length > 0) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      row.createSpan({ cls: 'hybrid-search-preview-meta-label', text: '→' });
      outgoing.forEach((p, i) => {
        this.createMetaLink(row, p);
        if (i < outgoing.length - 1)
          row.createSpan({ text: '•', cls: 'hybrid-search-preview-meta-sep' });
      });
    }

    if (incoming.length > 0) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      row.createSpan({ cls: 'hybrid-search-preview-meta-label', text: '←' });
      incoming.forEach((p, i) => {
        this.createMetaLink(row, p);
        if (i < incoming.length - 1)
          row.createSpan({ text: '•', cls: 'hybrid-search-preview-meta-sep' });
      });
    }

    this.previewMetaEl.show();
    this.positionPreviewMeta();
  }

  private positionPreviewMeta(): void {
    if (!this.previewMetaEl || !this.previewEl) return;
    const rect = this.previewEl.getBoundingClientRect();
    this.previewMetaEl.style.top = `${rect.bottom + 8}px`;
    this.previewMetaEl.style.left = `${rect.left}px`;
    this.previewMetaEl.style.width = `${rect.width}px`;
  }

  private hookMetaLinks(): void {
    if (!this.previewMetaEl) return;
    this.hookInternalLinks(this.previewMetaEl);
    hookSuperchargedLinks(
      this.app,
      this.slMetaWatch,
      this.previewMetaEl,
      'a.hybrid-search-preview-meta-link',
      'hybrid-search-preview-meta-row',
    );
  }

  private createMetaLink(parent: HTMLElement, path: string): void {
    const nfcPath = path.normalize('NFC');
    const c = this.app.metadataCache.getCache(nfcPath);
    const fm = c?.frontmatter;
    const title =
      (typeof fm?.['title'] === 'string' ? fm['title'] : undefined) ??
      nfcPath.replace(/^.*\//, '').replace(/\.md$/, '');
    const a = parent.createEl('a', {
      text: title,
      cls: 'internal-link hybrid-search-preview-meta-link',
      attr: { 'data-href': nfcPath.replace(/\.md$/, '') },
    });
    a.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
    applySuperchargedLinkAttributes(this.app, a, nfcPath);
  }

  private positionPreview(): void {
    if (!this.previewEl) return;
    const modalRect = this.modalEl.getBoundingClientRect();
    const gap = 12;

    if (this.settings.centerPanels) {
      const previewWidth = this.previewEl.offsetWidth || 500;
      let totalWidth = modalRect.width + gap + previewWidth;

      if (this.graphPanel?.isVisible()) {
        const graphWidth = this.graphPanel.getElement().offsetWidth || 380;
        totalWidth += gap + graphWidth;
      }

      const vw = window.innerWidth;

      if (totalWidth + 16 <= vw) {
        // Center the modal+preview(+graph) pair horizontally
        const pairLeft = Math.max(8, (vw - totalWidth) / 2);
        this.modalEl.style.left = `${pairLeft}px`;
        this.modalEl.style.transform = `none`;
        this.previewEl.style.top = `${modalRect.top}px`;
        this.previewEl.style.left = `${pairLeft + modalRect.width + gap}px`;
        return;
      }
      // Viewport too narrow: fall through to default placement
    }

    // Default: place preview directly to the right of wherever the modal is
    this.modalEl.style.left = ``;
    this.modalEl.style.transform = ``;
    this.previewEl.style.top = `${modalRect.top}px`;
    this.previewEl.style.left = `${modalRect.right + gap}px`;
  }

  positionGraphPanel(): void {
    if (!this.graphPanel?.isVisible()) return;
    const graphEl = this.graphPanel.getElement();
    const modalRect = this.modalEl.getBoundingClientRect();
    const gap = 12;

    // When preview is hidden, handle centering ourselves
    if (this.settings.centerPanels && !this.previewEl?.isShown()) {
      const graphWidth = graphEl.offsetWidth || 380;
      const totalWidth = modalRect.width + gap + graphWidth;
      const vw = window.innerWidth;

      if (totalWidth + 16 <= vw) {
        const pairLeft = Math.max(8, (vw - totalWidth) / 2);
        this.modalEl.style.left = `${pairLeft}px`;
        this.modalEl.style.transform = `none`;
        graphEl.style.top = `${modalRect.top}px`;
        graphEl.style.left = `${pairLeft + modalRect.width + gap}px`;
        return;
      }
      this.modalEl.style.left = ``;
      this.modalEl.style.transform = ``;
    }

    const referenceEl = this.previewEl && this.previewEl.isShown() ? this.previewEl : this.modalEl;
    const refRect = referenceEl.getBoundingClientRect();

    graphEl.style.top = `${modalRect.top}px`;
    graphEl.style.left = `${refRect.right + gap}px`;
  }

  private hookPreviewLinks(): void {
    if (!this.previewEl) return;
    this.hookInternalLinks(this.previewEl);
  }

  private hookInternalLinks(el: HTMLElement): void {
    hookInternalLinks(el, this.app, () => this.currentPreviewPath ?? '', {
      onHoverPreview: (evt, targetEl, href) => this.triggerHoverPreview(evt, targetEl, href),
      onOpenFile: (file, background, closeModal) => {
        if (background) {
          // @ts-ignore - 'tab' is a valid PaneType in modern Obsidian.
          void this.app.workspace.getLeaf('tab').openFile(file, { active: false });
        } else {
          void this.app.workspace.getLeaf(false).openFile(file);
          if (closeModal) this.close();
        }
      },
    });
  }

  private triggerHoverPreview(evt: MouseEvent, targetEl: HTMLElement, href: string): void {
    // @ts-ignore — 'hover-link' event is not typed in the public Obsidian API
    this.app.workspace.trigger('hover-link', {
      event: evt,
      source: 'preview',
      hoverParent: { hoverPopover: null },
      targetEl,
      linktext: href,
      sourcePath: this.currentPreviewPath ?? '',
    });
  }

  // ── Supercharged Links integration ──────────────────────────────────────────
  // SL's registerViewType only works for workspace leaves, not floating modals.
  // Instead we call _watchContainerDynamic directly on the modal's result list.
  // SL will then run its full rule pipeline (icons, colours, CSS vars) on each
  // suggestion item as it is added to the DOM.

  private get slWatch(): SuperchargedWatch {
    return { ownerId: this.ownerId, id: 'hybrid-search-modal' };
  }

  private get slMetaWatch(): SuperchargedWatch {
    return { ownerId: this.ownerId, id: 'hybrid-search-preview-meta' };
  }

  private hookSuperchargedLinks(): void {
    const resultsEl = this.containerEl.querySelector<HTMLElement>('.prompt-results');
    if (!resultsEl) return;
    hookSuperchargedLinks(
      this.app,
      this.slWatch,
      resultsEl,
      'a.hybrid-search-name',
      'suggestion-item',
    );
  }

  private unhookSuperchargedLinks(): void {
    unhookSuperchargedLinks(this.app, this.slWatch, this.slMetaWatch);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function anchorKey(anchors?: MatchAnchor[], idx?: number): string {
  if (!anchors?.length) return '';
  const a = anchors[idx ?? 0]!;
  return `${a.headingPath ?? ''}\x00${a.matchText}`;
}

/**
 * Build an ordered list of lowercase needle strings to try when locating a snippet
 * in the rendered DOM.
 *
 * Handles two snippet formats:
 *  - Semantic/hybrid (formatChunkSnippet): "Parent > Child\nbody text"
 *    The heading breadcrumb uses " > " as separator; DOM headings show only the
 *    leaf component, so we split and try each part individually.
 *  - BM25: "context...more context" — split on "..." and try each segment.
 */
// Markdown syntax characters that don't appear in rendered DOM text.
// NOTE: [ and ] are intentionally excluded so footnote refs like [^1] → [1]
// (after ^ removal) still match their DOM rendering as "[1]".
const MD_STRIP = /[*_`#^~|\\]/g;

/** Convert markdown source text to plain display text matching DOM textContent. */
function toDisplayText(s: string): string {
  /* eslint-disable sonarjs/slow-regex -- markdown link and alias stripping; patterns are bounded by input line length */
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[link|alias]] → alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[link]] → link text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(MD_STRIP, '');
  /* eslint-enable sonarjs/slow-regex -- markdown link and alias stripping completed */
}

/**
 * For task-list lines: push extra candidates derived from the link/prose text,
 * skipping the checkmark, tag tokens, and the pipe-separated comment.
 */
function addTaskCandidates(rawLine: string, domText: string, base: string, out: string[]): void {
  // Candidate A: strip "[x]" checkmark and leading word/word tag tokens (stripped #tags)
  // to reach the link text or prose. e.g. "[x] task/ref [Link](url) desc" → "Link desc..."
  const noCheckmark = domText.replace(/^\[[xX ]\]\s*/, '');
  let noTags = noCheckmark;
  while (/^\w+(?:\/\w+)+\s/.test(noTags)) noTags = noTags.replace(/^\w+(?:\/\w+)+\s+/, '');
  noTags = noTags.trim();
  const extra = noTags.toLowerCase().slice(0, 60);
  if (noTags.length >= 10 && extra !== base) out.push(extra);

  // Candidate B: text after " | " in the raw line — the task comment / description prose,
  // which reliably appears verbatim in DOM (no markdown transformation needed).
  const pipeIdx = rawLine.indexOf(' | ');
  if (pipeIdx !== -1) {
    const desc = toDisplayText(rawLine.slice(pipeIdx + 3))
      .replace(/✅\s*\d{4}-\d{2}-\d{2}.*$/, '')
      .trim();
    if (desc.length >= 10) out.push(desc.toLowerCase().slice(0, 60));
  }
}

function snippetScrollCandidates(snippet: string): string[] {
  const headingCandidates: string[] = [];
  const bodyCandidates: string[] = [];

  // Strategy 1: line-by-line — body text first, heading breadcrumbs last (reversed, leaf first)
  for (const line of snippet.split('\n')) {
    const stripped = toDisplayText(line).trim();
    if (stripped.includes(' > ')) {
      // Semantic heading breadcrumb — reverse so leaf heading is tried first
      const parts = stripped.split(' > ').reverse();
      for (const part of parts) {
        const clean = part.trim();
        if (clean.length >= 10) headingCandidates.push(clean.toLowerCase().slice(0, 60));
      }
    } else {
      const raw = stripped.replace(/^\.\.\./, '').trim();
      if (raw.length < 10) continue;

      // Markdown heading lines (# …) go to headingCandidates (tried last) so that longer
      // body-text candidates are matched first and we don't land on a wrong <p> that
      // happens to contain the same heading words earlier in the DOM.
      if (/^#+\s/.test(line.trimStart())) {
        headingCandidates.push(raw.toLowerCase().slice(0, 60));
        continue;
      }

      // Strip leading list markers: bullet (- * +) and ordered (1. 2) etc.
      // They appear in markdown source but NOT in DOM <li> textContent.
      // Strip list marker, then task checkbox "[ ]" / "[x]" — neither appears in DOM textContent.
      const domText = raw
        .replace(/^(?:[-*+]|\d+[.)]) \s*/, '')
        .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\[[xX ]\]\s*/, '');
      const base = domText.toLowerCase().slice(0, 60);
      if (base.length >= 10) bodyCandidates.push(base);

      addTaskCandidates(line, domText, base, bodyCandidates);
    }
  }

  // Strategy 2: BM25 "..." segments collapsed to single line, longest first
  const bm25: string[] = [];
  snippet
    .split('...')
    .map((s) => toDisplayText(s).replace(/>/g, '').replace(/\n/g, ' ').trim())
    .filter((s) => s.length >= 10)
    .sort((a, b) => b.length - a.length)
    .forEach((s) => bm25.push(s.slice(0, 60).toLowerCase()));

  // Body text first → leaf heading → parent headings → BM25 segments
  return [...new Set([...bodyCandidates, ...headingCandidates, ...bm25])];
}

function byScoreDesc(a: SearchResult, b: SearchResult): number {
  return b.score - a.score;
}
