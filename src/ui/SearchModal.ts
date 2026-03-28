import {
  App,
  debounce,
  MarkdownRenderChild,
  MarkdownRenderer,
  SuggestModal,
  TFile,
} from 'obsidian';
import type { MatchAnchor, SearchClient, SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';
import { registerModalKeymap } from './modalKeymap';
import { parseQuery } from './queryParser';

type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

const RECENT_FILES_LIMIT = 20; // local cap for recent-files list only

export class SearchModal extends SuggestModal<SearchResult> {
  private debounce?: ReturnType<typeof setTimeout>;
  private previewEl?: HTMLDivElement;
  private previewMetaEl?: HTMLDivElement;
  private previewChild?: MarkdownRenderChild;
  private currentPreviewPath?: string;
  private currentAnchorKey?: string;
  private previewCallId = 0;
  private isRecentMode = false;
  private currentMode: 'hybrid' | 'semantic' | 'fulltext' | 'title' = 'hybrid';
  private currentQueryWords: string[] = [];

  private modeEl?: HTMLSpanElement;

  private readonly debouncedPreview = debounce(
    (path: string, snippet?: string, anchors?: MatchAnchor[], primaryIdx?: number) => {
      void this.updatePreview(path, snippet, anchors, primaryIdx);
    },
    100,
    true, // resetTimer: true — resets on each call, fires after the last one
  );

  constructor(
    app: App,
    private client: Pick<SearchClient, 'search'>,
    private settings: HybridSearchSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly activePath?: string,
    private readonly forcedMode?: SearchMode,
  ) {
    super(app);
    this.setPlaceholder('Hybrid search: type to search your vault...');
  }

  open(): void {
    super.open();
    this.injectModeBadge();
    this.hookSuperchargedLinks();
    registerModalKeymap(this, this.app, this.settings, this.saveSettings);
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
    this.modeEl = (container as HTMLElement).createEl('span', {
      cls: 'hybrid-search-mode-badge',
      text: initialLabel,
    });
  }

  private modeLabel(mode: string, rerank: boolean): string {
    const letters: Record<string, string> = {
      hybrid: 'H',
      semantic: 'S',
      fulltext: 'F',
      title: 'T',
    };
    const letter = letters[mode] ?? mode[0]?.toUpperCase() ?? '?';
    return rerank && mode === 'hybrid' ? `${letter}*` : letter;
  }

  private updateModeBadge(label: string): void {
    if (this.modeEl) this.modeEl.textContent = label;
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
    this.currentAnchorKey = undefined;
  }

  private clearHighlights(): void {
    if (!this.previewEl) return;
    for (const el of this.previewEl.querySelectorAll('.hybrid-search-semantic-match')) {
      el.classList.remove('hybrid-search-semantic-match');
    }
    // Unwrap word-match spans: replace each with a plain text node
    for (const span of Array.from(this.previewEl.querySelectorAll('.hybrid-search-word-match'))) {
      span.replaceWith(document.createTextNode(span.textContent ?? ''));
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

    for (const el of region) {
      if (el.closest('.callout')) continue;
      if (el.matches(blockSel)) {
        if ((el.textContent ?? '').toLowerCase().includes(needle)) return el as HTMLElement;
      }
      // Check nested blocks inside container elements (e.g. div.callout excluded above)
      for (const nested of el.querySelectorAll(blockSel)) {
        if ((nested.textContent ?? '').toLowerCase().includes(needle)) {
          return nested as HTMLElement;
        }
      }
    }
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

  triggerPreview(
    nfcPath: string,
    snippet?: string,
    anchors?: MatchAnchor[],
    primaryIdx?: number,
  ): void {
    this.debouncedPreview(nfcPath, snippet, anchors, primaryIdx);
  }

  onClose(): void {
    this.unhookSuperchargedLinks();
    this.hidePreviewPanel();
    // Restore modal's default centering (in case positionPreview shifted it)
    this.modalEl.style.left = ``;
    this.modalEl.style.transform = ``;
  }

  async getSuggestions(query: string): Promise<SearchResult[]> {
    if (!query.trim()) {
      if (this.activePath) {
        // Active note open: show semantically similar notes
        this.isRecentMode = false;
        this.updateModeBadge('~');
        return new Promise((resolve) => {
          clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
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

    const { query: parsedQuery, overrides } = parseQuery(query);
    this.currentMode = overrides.mode ?? this.forcedMode ?? this.settings.defaultMode;
    this.currentQueryWords = parsedQuery
      .split(/\s+/)
      .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length >= 2);
    this.updateModeBadge(
      this.modeLabel(
        overrides.mode ?? this.forcedMode ?? this.settings.defaultMode,
        overrides.rerank ?? false,
      ),
    );

    return new Promise((resolve) => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.client
          .search(parsedQuery, {
            mode: overrides.mode ?? this.forcedMode ?? this.settings.defaultMode,
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
    // Try semantic similarity (requires embedding; API key or local model)
    const semantic = await this.client.search('', { notePath: path });
    const filtered = semantic.filter((r) => r.path !== path);
    if (filtered.length > 0) {
      this.isRecentMode = false; // semantic scores are meaningful
      return filtered;
    }
    // Fallback: BFS graph traversal (works without embeddings)
    // BFS scores (0.5 for depth=1) are structural, not semantic — hide them
    this.isRecentMode = true;
    const bfs = await this.client.search(path, { related: true });
    return bfs.filter((r) => r.path !== path);
  }

  private buildRecentResults(): SearchResult[] {
    const paths: string[] = this.app.workspace.getLastOpenFiles();
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const p of paths) {
      if (results.length >= RECENT_FILES_LIMIT) break;
      if (seen.has(p)) continue;
      seen.add(p);
      const file = this.app.vault.getAbstractFileByPath(p);
      if (!(file instanceof TFile) || file.extension !== 'md') continue;
      const cache = this.app.metadataCache.getCache(p);
      const fm = cache?.frontmatter;
      const title =
        (typeof fm?.title === 'string' ? fm.title : undefined) ??
        p.replace(/^.*\//, '').replace(/\.md$/, '');
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

    const container = el.createEl('div', { cls: 'hybrid-search-result' });

    const titleRow = container.createEl('div', { cls: 'hybrid-search-title' });
    const link = titleRow.createEl('a', {
      text: result.title || result.path,
      cls: 'internal-link hybrid-search-name',
      attr: { 'data-href': nfcPath.replace(/\.md$/, '') },
    });
    // Fallback styling when Supercharged Links is not installed:
    // mirror what SL's updateDivExtraAttributes produces so user CSS works.
    link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
    const fm = this.app.metadataCache.getCache(nfcPath)?.frontmatter;
    if (fm) {
      for (const [key, val] of Object.entries(fm)) {
        if (key === 'position') continue;
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          const strVal = String(val);
          link.setAttribute(`data-link-${key}`, strVal);
          link.style.setProperty(`--data-link-${key}`, strVal);
        }
      }
    }

    if (!this.isRecentMode) {
      titleRow.createEl('span', {
        text: score.toFixed(2),
        cls: 'hybrid-search-score',
        attr: { style: `color:${color}` },
      });
    }

    if (this.settings.showMeta) {
      const folder = result.path.includes('/') ? result.path.replace(/\/[^/]+$/, '') : '';
      const metaRow = container.createEl('div', { cls: 'hybrid-search-meta' });
      if (folder) {
        metaRow.createEl('span', { text: folder, cls: 'hybrid-search-meta-path' });
      }
      result.tags
        .slice(0, 5)
        .forEach((tag) => metaRow.createEl('span', { text: `#${tag}`, cls: 'hybrid-search-tag' }));
    }

    el.addEventListener('mouseenter', () => {
      if (!this.settings.showPreview) return;
      this.debouncedPreview(
        nfcPath,
        result.snippet,
        result.previewAnchors,
        result.primaryAnchorIndex,
      );
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
    if (!this.settings.showPreview) return;
    if (result) {
      this.debouncedPreview(
        result.path.normalize('NFC'),
        result.snippet,
        result.previewAnchors,
        result.primaryAnchorIndex,
      );
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
      this.previewEl = document.body.createDiv('hybrid-search-preview');
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
    this.currentAnchorKey = key;

    if (anchors?.length && this.settings.scrollToSnippet) {
      this.applyAnchorHighlight(anchors, primaryIdx ?? 0);
    } else if (snippet && this.settings.scrollToSnippet) {
      this.applySnippetHighlight(snippet);
    }

    // Re-position after render: modal may have grown taller as results loaded
    this.positionPreview();
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
    setTimeout(doScroll, 150);
    setTimeout(doScroll, 400);
  }

  private highlightQueryWords(): void {
    if (!this.previewEl) return;
    const words = this.currentQueryWords;
    if (words.length === 0) return;
    const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(this.previewEl, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'hybrid-search-word-match';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  private highlightQueryWordsInRegion(elements: Element[]): void {
    const words = this.currentQueryWords;
    if (words.length === 0) return;
    const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');

    const textNodes: Text[] = [];
    for (const el of elements) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'hybrid-search-word-match';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
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

      block.classList.add('hybrid-search-semantic-match');
      collectedBlocks.push({ el: block, isPrimary: i === primaryIdx });

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
      this.previewMetaEl = document.body.createDiv('hybrid-search-preview-meta-panel');
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
      row.createSpan({
        cls: 'hybrid-search-preview-meta-icon hybrid-search-preview-meta-icon-folder',
      });
      row.createSpan({ text: folder, cls: 'hybrid-search-preview-meta-folder' });
    }

    if (aliases.length > 0) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      row.createSpan({
        cls: 'hybrid-search-preview-meta-icon hybrid-search-preview-meta-icon-alias',
      });
      for (const alias of aliases) {
        row.createSpan({ text: alias, cls: 'hybrid-search-preview-meta-alias' });
      }
    }

    if (tags.length > 0) {
      const row = this.previewMetaEl.createDiv({ cls: 'hybrid-search-preview-meta-row' });
      row.createSpan({
        cls: 'hybrid-search-preview-meta-icon hybrid-search-preview-meta-icon-tag',
      });
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
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const sl = (this.app as any).plugins?.plugins?.['supercharged-links-obsidian'];
    if (sl && typeof sl._watchContainerDynamic === 'function') {
      sl._watchContainerDynamic(
        SearchModal.SL_META_WATCH_ID,
        this.previewMetaEl,
        sl,
        'a.hybrid-search-preview-meta-link',
        'hybrid-search-preview-meta-row',
      );
    }
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
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
    // SuperchargedLinks compatibility: apply frontmatter data-link-* attributes
    a.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
    if (fm) {
      for (const [key, val] of Object.entries(fm)) {
        if (key === 'position') continue;
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          const strVal = String(val);
          a.setAttribute(`data-link-${key}`, strVal);
          a.style.setProperty(`--data-link-${key}`, strVal);
        }
      }
    }
  }

  private positionPreview(): void {
    if (!this.previewEl) return;
    const modalRect = this.modalEl.getBoundingClientRect();
    const gap = 12;

    if (this.settings.centerPanels) {
      const previewWidth = this.previewEl.offsetWidth || 500;
      const totalWidth = modalRect.width + gap + previewWidth;
      const vw = window.innerWidth;

      if (totalWidth + 16 <= vw) {
        // Center the modal+preview pair horizontally
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

  private hookPreviewLinks(): void {
    if (!this.previewEl) return;
    this.hookInternalLinks(this.previewEl);
  }

  private hookInternalLinks(el: HTMLElement): void {
    // Ctrl/Cmd + hover: show Obsidian page preview popup
    el.addEventListener('mouseover', (evt: MouseEvent) => {
      if (!evt.ctrlKey && !evt.metaKey) return;
      const link = (evt.target as HTMLElement).closest('a');
      if (!link) return;
      const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
      if (!href || /^https?:\/\//.test(href)) return;
      this.triggerHoverPreview(evt, link, href);
    });

    const handler = (evt: MouseEvent) => {
      const link = (evt.target as HTMLElement).closest('a');
      if (!link) return;
      const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
      if (!href || /^https?:\/\//.test(href)) return;
      evt.preventDefault();
      evt.stopPropagation();
      // Ctrl/Cmd + click: show page preview, keep modal open
      if (evt.ctrlKey || evt.metaKey) {
        this.triggerHoverPreview(evt, link, href);
        return;
      }
      const file = this.app.metadataCache.getFirstLinkpathDest(href, this.currentPreviewPath ?? '');
      if (!(file instanceof TFile)) return;
      if (evt.button === 1) {
        // Middle click: open in new tab, keep modal open
        // @ts-ignore — 'tab' is a valid PaneType in modern Obsidian
        void this.app.workspace.getLeaf('tab').openFile(file);
      } else {
        // Left click: open and close modal
        void this.app.workspace.getLeaf(false).openFile(file);
        this.close();
      }
    };
    el.addEventListener('click', handler);
    el.addEventListener('auxclick', handler);
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

  private static readonly SL_WATCH_ID = 'hybrid-search-modal';
  private static readonly SL_META_WATCH_ID = 'hybrid-search-preview-meta';

  private hookSuperchargedLinks(): void {
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const sl = (this.app as any).plugins?.plugins?.['supercharged-links-obsidian'];
    if (!sl || typeof sl._watchContainerDynamic !== 'function') return;
    const resultsEl = this.containerEl.querySelector('.prompt-results');
    if (!resultsEl) return;
    sl._watchContainerDynamic(
      SearchModal.SL_WATCH_ID,
      resultsEl,
      sl,
      'a.hybrid-search-name',
      'suggestion-item',
    );
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  }

  private unhookSuperchargedLinks(): void {
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    const sl = (this.app as any).plugins?.plugins?.['supercharged-links-obsidian'];
    if (!sl || !Array.isArray(sl.observers)) return;
    for (const watchId of [SearchModal.SL_WATCH_ID, SearchModal.SL_META_WATCH_ID]) {
      const idx = (sl.observers as Array<[MutationObserver, string, string]>).findIndex(
        ([, id]) => id === watchId,
      );
      if (idx >= 0) {
        (sl.observers[idx] as [MutationObserver, string, string])[0].disconnect();
        (sl.observers as unknown[]).splice(idx, 1);
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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
  /* eslint-disable sonarjs/slow-regex */
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[link|alias]] → alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[link]] → link text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(MD_STRIP, '');
  /* eslint-enable sonarjs/slow-regex */
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

function scoreColor(score: number): string {
  if (score >= 0.8) return '#4caf50';
  if (score >= 0.5) return '#ff9800';
  return '#9e9e9e';
}
