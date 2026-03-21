import { App, SuggestModal } from 'obsidian';
import type { SearchClient, SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';

export class SearchModal extends SuggestModal<SearchResult> {
  private debounce?: ReturnType<typeof setTimeout>;

  constructor(
    app: App,
    private client: Pick<SearchClient, 'search'>,
    private settings: HybridSearchSettings,
  ) {
    super(app);
    this.setPlaceholder('Hybrid search: type to search your vault...');
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
            snippetLength: this.settings.snippetLength,
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
    titleRow.createEl('span', {
      text: result.title || result.path,
      cls: 'hybrid-search-name',
    });
    titleRow.createEl('span', {
      text: score.toFixed(2),
      cls: 'hybrid-search-score',
      attr: { style: `color:${color}` },
    });

    if (result.snippet) {
      container.createEl('div', { text: result.snippet.trim(), cls: 'hybrid-search-snippet' });
    }

    if (result.tags.length > 0) {
      const tagsEl = container.createEl('div', { cls: 'hybrid-search-tags' });
      result.tags
        .slice(0, 5)
        .forEach((tag) => tagsEl.createEl('span', { text: `#${tag}`, cls: 'hybrid-search-tag' }));
    }
  }

  onChooseSuggestion(result: SearchResult, _evt: MouseEvent | KeyboardEvent): void {
    void this.app.workspace.openLinkText(result.path, '', false);
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
