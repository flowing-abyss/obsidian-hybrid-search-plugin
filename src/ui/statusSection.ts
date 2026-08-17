import { Notice } from 'obsidian';
import type { HybridSearchSettings } from '../settings';
import type { CliStatus } from '../status';
import { fetchStatus } from '../status';

export interface StatusSectionDeps {
  settings: HybridSearchSettings;
  getApiKey: () => string;
  getClient: () => unknown;
  /** Where the report actually came from, which under HTTP may be the fallback. */
  getEndpointLabel: () => string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: CliStatus; apiKeySet: boolean }
  | { kind: 'error'; message: string };

/**
 * The two status views in the settings tab: a short summary at the top and a
 * collapsed report at the bottom. One fetch feeds both. Refreshing is explicit —
 * once when the tab opens, then only when the user asks.
 */
export class StatusSection {
  private state: LoadState = { kind: 'loading' };
  private summaryEl: HTMLElement | null = null;
  private diagnosticsEl: HTMLElement | null = null;
  /** Only the newest request may paint; older ones are ignored when they land. */
  private generation = 0;
  private destroyed = false;
  private buttons: HTMLButtonElement[] = [];

  constructor(private deps: StatusSectionDeps) {}

  /** Renders into the body of an already-created section. */
  renderSummary(bodyEl: HTMLElement): void {
    this.summaryEl = bodyEl.createDiv({ cls: 'hybrid-search-status' });
    const actions = bodyEl.createDiv({ cls: 'hybrid-search-status__actions' });
    this.addRefreshButton(actions);
    this.paint();
  }

  renderDiagnostics(bodyEl: HTMLElement): void {
    this.diagnosticsEl = bodyEl.createDiv({ cls: 'hybrid-search-status' });
    const actions = bodyEl.createDiv({ cls: 'hybrid-search-status__actions' });
    this.addRefreshButton(actions);

    const copy = actions.createEl('button', { text: 'Copy report' });
    copy.setAttribute('aria-label', 'Copy the report as text, without the API key');
    copy.addEventListener('click', () => {
      void this.copyReport();
    });
    this.buttons.push(copy);

    this.paint();
  }

  private addRefreshButton(actions: HTMLElement): void {
    const button = actions.createEl('button', { text: 'Refresh' });
    button.addEventListener('click', () => {
      void this.refresh();
    });
    this.buttons.push(button);
  }

  /** Buttons are disabled while loading so a held-down click cannot queue up
   *  a request per press against a server that is slow to answer. */
  private setButtonsDisabled(disabled: boolean): void {
    for (const button of this.buttons) button.disabled = disabled;
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.state = { kind: 'loading' };
    this.setButtonsDisabled(true);
    this.paint();

    let next: LoadState;
    try {
      next = {
        kind: 'ready',
        status: await fetchStatus(this.deps.getClient()),
        apiKeySet: this.deps.getApiKey() !== '',
      };
    } catch (err) {
      next = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }

    // A newer refresh, or a closed settings tab, wins over this result.
    if (this.destroyed || generation !== this.generation) return;
    this.state = next;
    this.setButtonsDisabled(false);
    this.paint();
  }

  /** Called when the settings tab closes so a late result cannot paint detached nodes. */
  dispose(): void {
    this.destroyed = true;
    this.summaryEl = null;
    this.diagnosticsEl = null;
    this.buttons = [];
  }

  private paint(): void {
    if (this.summaryEl) this.paintSummary(this.summaryEl);
    if (this.diagnosticsEl) this.paintRows(this.diagnosticsEl, this.reportEntries());
  }

  private paintSummary(container: HTMLElement): void {
    container.empty();

    if (this.state.kind !== 'ready') {
      this.paintRows(container, []);
      return;
    }

    const { status, apiKeySet } = this.state;
    row(container, 'Model', status.model ?? 'unknown');
    if (this.deps.settings.transport === 'stdio') {
      row(container, 'API key', apiKeySet ? 'Set' : 'Not set');
    }
    row(container, 'Notes', format(status.total));
    row(container, 'Queued', format(status.pending));

    // While a first index is still running the same number counts notes that simply
    // have not been reached yet, so the explanation below would be false.
    const indexSettled = status.pending === 0 && status.lastIndexed !== null;
    if (indexSettled && status.notesWithoutChunks !== null && status.notesWithoutChunks > 0) {
      note(
        container,
        `${String(status.notesWithoutChunks)} of them have no text to embed, because they are empty ` +
          'or hold only frontmatter. They are still found by title, tag and fulltext search.',
      );
    }

    // A drifted environment is the one failure that looks like nothing is wrong:
    // the index is intact, but queries are embedded by a different model than the
    // vectors were, so semantic results are wrong or empty.
    if (status.activeModel && status.model && status.activeModel !== status.model) {
      warn(
        container,
        `The index was built with "${status.model}", but the search server is now using ` +
          `"${status.activeModel}". Semantic search will not work until the two match. ` +
          'Check the API key below and the environment the server was started with.',
      );
    }

    if (status.failedChunks > 0) {
      warn(
        container,
        `${String(status.failedChunks)} chunk${status.failedChunks === 1 ? '' : 's'} could not be embedded. ` +
          'The embedding provider rejected them, most often because the API key is missing or wrong. ' +
          'Run "ohs reindex --errors" to retry them once the provider works. Fulltext search still works.',
      );
    }
  }

  private paintRows(container: HTMLElement, entries: Array<[string, string]>): void {
    container.empty();
    if (this.state.kind === 'loading') {
      row(container, 'Status', 'Loading…');
      return;
    }
    if (this.state.kind === 'error') {
      warn(container, this.state.message);
      return;
    }
    for (const [label, value] of entries) row(container, label, value);
  }

  private reportEntries(): Array<[string, string]> {
    if (this.state.kind !== 'ready') return [];
    const { status } = this.state;
    const { settings } = this.deps;
    return [
      ['Transport', settings.transport === 'http' ? 'HTTP' : 'STDIO'],
      ['Endpoint', this.deps.getEndpointLabel()],
      ['CLI version', status.version ?? 'unknown'],
      ['API base URL', status.apiBaseUrl ? redactCredentials(status.apiBaseUrl) : 'local model'],
      // Only one model row: the one in use is worth naming when it differs, and
      // then the warning above names both. A second row that usually repeats the
      // first is noise.
      ['Model', status.model ?? 'unknown'],
      ['Embedding dimension', format(status.embeddingDim)],
      ['Context length', format(status.contextLength)],
      ['Notes', format(status.total)],
      ['Notes with embeddings', format(status.indexed)],
      ['Notes with nothing to embed', format(status.notesWithoutChunks)],
      ['Queued', format(status.pending)],
      ['Chunks', format(status.chunks)],
      ['Chunks that failed to embed', String(status.failedChunks)],
      ['Links', format(status.links)],
      ['Database size', status.dbSizeMb === null ? 'unknown' : `${String(status.dbSizeMb)} MB`],
      ['Last indexed', status.lastIndexed ?? 'never'],
      ['Ignore patterns', status.ignorePatterns.join(', ') || 'none'],
    ];
  }

  async copyReport(): Promise<void> {
    const entries = this.reportEntries();
    if (entries.length === 0) {
      new Notice('Nothing to copy yet.');
      return;
    }
    const text = entries.map(([label, value]) => `${label}: ${value}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      new Notice('Report copied.');
    } catch {
      new Notice('Could not copy the report.');
    }
  }
}

/** Some providers accept credentials inside the base url, and this report is
 *  meant to be pasted into bug trackers. */
function redactCredentials(url: string | null): string {
  if (!url) return 'unknown';
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function row(container: HTMLElement, label: string, value: string): void {
  const el = container.createDiv({ cls: 'hybrid-search-status__row' });
  el.createSpan({ cls: 'hybrid-search-status__label', text: label });
  el.createSpan({ cls: 'hybrid-search-status__value', text: value });
}

function note(container: HTMLElement, text: string): void {
  container.createDiv({ cls: 'hybrid-search-status__note', text });
}

function warn(container: HTMLElement, text: string): void {
  container.createDiv({ cls: 'hybrid-search-status__warning', text });
}

function format(value: number | null): string {
  return value === null ? 'unknown' : String(value);
}
