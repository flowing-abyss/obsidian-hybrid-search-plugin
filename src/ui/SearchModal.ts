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

export class SearchModal extends SuggestModal<SearchResult> {
  private debounce?: ReturnType<typeof setTimeout>;
  private previewEl?: HTMLDivElement;
  private previewChild?: MarkdownRenderChild;
  private currentPreviewPath?: string;
  private previewCallId = 0;

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
    this.previewCallId++; // invalidate any in-flight updatePreview
    this.previewChild?.unload();
    this.previewEl?.remove();
    this.previewEl = undefined;
    this.currentPreviewPath = undefined;
  }

  async getSuggestions(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    return new Promise((resolve) => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.client
          .search(query, {
            mode: this.settings.defaultMode,
            limit: this.settings.limit,
            snippetLength: 0, // snippets no longer displayed; skip server computation
          })
          .then((results) => resolve([...results].sort(byScoreDesc)))
          .catch(() => resolve([]));
      }, 200);
    });
  }

  renderSuggestion(result: SearchResult, el: HTMLElement): void {
    const score = result.score;
    const color = scoreColor(score);

    const container = el.createEl('div', { cls: 'hybrid-search-result' });

    const titleRow = container.createEl('div', { cls: 'hybrid-search-title' });
    const link = titleRow.createEl('a', {
      text: result.title || result.path,
      cls: 'internal-link hybrid-search-name',
      attr: { 'data-href': result.path.replace(/\.md$/, '') },
    });
    // Fallback styling when Supercharged Links is not installed:
    // mirror what SL's updateDivExtraAttributes produces so user CSS works.
    link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
    const fm = this.app.metadataCache.getCache(result.path)?.frontmatter;
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

    titleRow.createEl('span', {
      text: score.toFixed(2),
      cls: 'hybrid-search-score',
      attr: { style: `color:${color}` },
    });

    if (result.tags.length > 0) {
      const tagsEl = container.createEl('div', { cls: 'hybrid-search-tags' });
      result.tags
        .slice(0, 5)
        .forEach((tag) => tagsEl.createEl('span', { text: `#${tag}`, cls: 'hybrid-search-tag' }));
    }

    el.addEventListener('mouseenter', () => void this.updatePreview(result.path));
  }

  onChooseSuggestion(result: SearchResult, _evt: MouseEvent | KeyboardEvent): void {
    const abstract = this.app.vault.getAbstractFileByPath(result.path);
    if (abstract instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(abstract);
    }
  }

  // @ts-ignore — internal SuggestModal API not in type declarations; fires on arrow-key navigation
  onSelectedChange(result: SearchResult | null): void {
    if (result) this.debouncedPreview(result.path);
  }

  private async updatePreview(path: string): Promise<void> {
    if (path === this.currentPreviewPath) return;

    const callId = ++this.previewCallId;

    // Synchronous DOM setup — must happen before any await
    if (!this.previewEl) {
      this.previewEl = document.body.createDiv('hybrid-search-preview');
      this.positionPreview();
    }
    this.previewEl.show();
    this.previewChild?.unload();
    this.previewChild = undefined;
    this.previewEl.empty();

    const abstract = this.app.vault.getAbstractFileByPath(path);
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
    await MarkdownRenderer.render(this.app, content, this.previewEl, path, this.previewChild);
    this.currentPreviewPath = path;
  }

  private positionPreview(): void {
    if (!this.previewEl) return;
    const rect = this.modalEl.getBoundingClientRect();
    this.previewEl.style.top = `${rect.top}px`;
    this.previewEl.style.left = `${rect.right + 12}px`;
    this.previewEl.style.height = `${rect.height}px`;
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
