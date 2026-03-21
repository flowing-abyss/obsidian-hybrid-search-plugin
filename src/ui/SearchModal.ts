import {
  App,
  debounce,
  MarkdownRenderChild,
  MarkdownRenderer,
  SuggestModal,
  TFile,
} from 'obsidian';
import type { SearchClient, SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';
import { parseQuery } from './queryParser';

const RECENT_FILES_LIMIT = 20; // local cap for recent-files list only

export class SearchModal extends SuggestModal<SearchResult> {
  private debounce?: ReturnType<typeof setTimeout>;
  private previewEl?: HTMLDivElement;
  private previewChild?: MarkdownRenderChild;
  private currentPreviewPath?: string;
  private previewCallId = 0;
  private isRecentMode = false;

  private readonly debouncedPreview = debounce(
    (path: string) => {
      void this.updatePreview(path);
    },
    100,
    true, // resetTimer: true — resets on each call, fires after the last one
  );

  constructor(
    app: App,
    private client: Pick<SearchClient, 'search'>,
    private settings: HybridSearchSettings,
    private readonly activePath?: string,
  ) {
    super(app);
    this.setPlaceholder('Hybrid search: type to search your vault...');
  }

  open(): void {
    super.open();
    this.hookSuperchargedLinks();
  }

  onClose(): void {
    this.unhookSuperchargedLinks();
    this.debouncedPreview.cancel(); // prevent deferred call from firing after close
    this.previewCallId++; // invalidate any in-flight updatePreview
    this.previewChild?.unload();
    this.previewEl?.remove();
    this.previewEl = undefined;
    this.currentPreviewPath = undefined;
  }

  async getSuggestions(query: string): Promise<SearchResult[]> {
    if (!query.trim()) {
      if (this.activePath) {
        // Active note open: show semantically similar notes
        this.isRecentMode = false;
        return new Promise((resolve) => {
          clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            this.fetchSimilar(resolve);
          }, 200);
        });
      }
      // No active note: show recently opened files
      this.isRecentMode = true;
      return this.buildRecentResults();
    }
    this.isRecentMode = false;

    const { query: parsedQuery, overrides } = parseQuery(query);

    return new Promise((resolve) => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.client
          .search(parsedQuery, {
            mode: overrides.mode ?? this.settings.defaultMode,
            ...(overrides.limit !== undefined && { limit: overrides.limit }),
            snippetLength: 0, // snippets no longer displayed; skip server computation
            ...(overrides.tag !== undefined && { tag: overrides.tag }),
            ...(overrides.scope !== undefined && { scope: overrides.scope }),
            ...(overrides.rerank !== undefined && { rerank: overrides.rerank }),
            ...(overrides.threshold !== undefined && { threshold: overrides.threshold }),
          })
          .then((results) => resolve([...results].sort(byScoreDesc)))
          .catch(() => resolve([]));
      }, 200);
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
    for (const p of paths) {
      if (results.length >= RECENT_FILES_LIMIT) break;
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

    el.addEventListener('mouseenter', () => void this.updatePreview(nfcPath));
  }

  onChooseSuggestion(result: SearchResult, _evt: MouseEvent | KeyboardEvent): void {
    const abstract = this.app.vault.getAbstractFileByPath(result.path.normalize('NFC'));
    if (abstract instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(abstract);
    }
  }

  // @ts-ignore — internal SuggestModal API not in type declarations; fires on arrow-key navigation
  onSelectedChange(result: SearchResult | null): void {
    if (result) this.debouncedPreview(result.path.normalize('NFC'));
  }

  private async updatePreview(path: string): Promise<void> {
    // Normalize to NFC: DB paths are NFD, Obsidian APIs require NFC (same as cli.ts)
    const nfcPath = path.normalize('NFC');
    if (nfcPath === this.currentPreviewPath) return;

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
    this.currentPreviewPath = nfcPath;
    // Re-position after render: modal may have grown taller as results loaded
    this.positionPreview();
  }

  private positionPreview(): void {
    if (!this.previewEl) return;
    const rect = this.modalEl.getBoundingClientRect();
    this.previewEl.style.top = `${rect.top}px`;
    this.previewEl.style.left = `${rect.right + 12}px`;
  }

  private hookPreviewLinks(): void {
    if (!this.previewEl) return;
    const handler = (evt: MouseEvent) => {
      const link = (evt.target as HTMLElement).closest('a');
      if (!link) return;
      const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
      if (!href || /^https?:\/\//.test(href)) return;
      evt.preventDefault();
      evt.stopPropagation();
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
    this.previewEl.addEventListener('click', handler);
    this.previewEl.addEventListener('auxclick', handler);
  }

  // ── Supercharged Links integration ──────────────────────────────────────────
  // SL's registerViewType only works for workspace leaves, not floating modals.
  // Instead we call _watchContainerDynamic directly on the modal's result list.
  // SL will then run its full rule pipeline (icons, colours, CSS vars) on each
  // suggestion item as it is added to the DOM.

  private static readonly SL_WATCH_ID = 'hybrid-search-modal';

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
    const idx = (sl.observers as Array<[MutationObserver, string, string]>).findIndex(
      ([, id]) => id === SearchModal.SL_WATCH_ID,
    );
    if (idx >= 0) {
      (sl.observers[idx] as [MutationObserver, string, string])[0].disconnect();
      (sl.observers as unknown[]).splice(idx, 1);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  }
}

function byScoreDesc(a: SearchResult, b: SearchResult): number {
  return b.score - a.score;
}

function scoreColor(score: number): string {
  if (score >= 0.8) return '#4caf50';
  if (score >= 0.5) return '#ff9800';
  return '#9e9e9e';
}
