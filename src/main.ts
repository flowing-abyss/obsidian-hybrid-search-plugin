import { Notice, Plugin, type EventRef } from 'obsidian';
import { registerCommands } from './commands';
import type { SearchMode, SearchService } from './search/contracts';
import type { HybridSearchSettings } from './settings/model';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings/model';
import { getApiKey, getLegacyApiKeySecretId } from './settings/secrets';
import type { HttpSearchClientStatusEvent } from './transport/http';
import { HttpSearchClient } from './transport/http';
import { SearchClient } from './transport/stdio';
import { GRAPH_WORKBENCH_VIEW_TYPE, GraphWorkbenchView } from './ui/graph/GraphWorkbenchView';
import { InlineSearchSuggest } from './ui/search/InlineSearchSuggest';
import { SearchModal } from './ui/search/SearchModal';
import { SEARCH_PANEL_VIEW_TYPE, SearchPanelView } from './ui/search/SearchPanelView';
import { HybridSearchSettingTab } from './ui/settings/HybridSearchSettingTab';
import { runAllCleanupSteps } from './ui/shared/cleanup';
import { sweepStrayPanels } from './ui/shared/strayPanels';
import { PagePreviewSimilarNotesManager } from './ui/similar/PagePreviewSimilarNotes';
import { SimilarNotesBottomManager } from './ui/similar/SimilarNotesBottom';

export default class HybridSearchPlugin extends Plugin {
  declare settings: HybridSearchSettings;
  client?: SearchService;
  private similarNotesBottom?: SimilarNotesBottomManager;
  private pagePreviewSimilarNotes?: PagePreviewSimilarNotesManager;
  private graphWorkbenchRefreshTimer?: number;
  private clientGeneration = 0;
  private activeSearchModals = new Set<SearchModal>();
  private inlineSearch?: InlineSearchSuggest;

  async onload(): Promise<void> {
    this.removeOrphanedPanels({ includeUnstamped: true });
    await this.loadSettings();

    this.restartClient();
    this.inlineSearch = new InlineSearchSuggest(this.app, this);
    this.registerEditorSuggest(this.inlineSearch);
    this.registerView(SEARCH_PANEL_VIEW_TYPE, (leaf) => new SearchPanelView(leaf, this));
    this.registerView(GRAPH_WORKBENCH_VIEW_TYPE, (leaf) => new GraphWorkbenchView(leaf, this));
    if (typeof this.app.workspace.on === 'function') {
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', () => {
          void this.refreshGraphWorkbenchViews();
        }),
      );
      this.registerEvent(
        this.app.workspace.on('file-open', () => {
          void this.refreshGraphWorkbenchViews();
        }),
      );
    }
    if (typeof this.app.vault.on === 'function') {
      const onVaultEvent = this.app.vault.on.bind(this.app.vault) as (
        name: string,
        callback: () => void,
      ) => EventRef;
      for (const eventName of ['create', 'delete', 'rename', 'modify'] as const) {
        this.registerEvent(
          onVaultEvent(eventName, () => {
            this.queueGraphWorkbenchRefresh();
          }),
        );
      }
    }
    if (typeof this.app.metadataCache?.on === 'function') {
      this.registerEvent(
        this.app.metadataCache.on('resolved', () => {
          this.queueGraphWorkbenchRefresh();
        }),
      );
    }

    this.similarNotesBottom = new SimilarNotesBottomManager(this.app, this);
    this.similarNotesBottom.load();
    this.pagePreviewSimilarNotes = new PagePreviewSimilarNotesManager(this.app, this);
    this.pagePreviewSimilarNotes.load();

    registerCommands(this, (mode) => this.openSearchModal(mode));

    this.addRibbonIcon('search', 'Hybrid search', () => {
      this.openSearchModal();
    });

    const settingsTab = new HybridSearchSettingTab(this.app, this);
    this.addSettingTab(settingsTab);
    this.register(() => settingsTab.dispose());
  }

  onunload(): void {
    this.clientGeneration++;
    try {
      runAllCleanupSteps(
        () => this.closeActiveSearchModals(),
        // Unstamped panels are excluded here: by now they can only belong to a live foreign copy.
        () => this.removeOrphanedPanels({ includeUnstamped: false }),
        () => {
          if (this.graphWorkbenchRefreshTimer !== undefined) {
            window.clearTimeout(this.graphWorkbenchRefreshTimer);
            this.graphWorkbenchRefreshTimer = undefined;
          }
        },
        () => this.pagePreviewSimilarNotes?.unload(),
        () => this.similarNotesBottom?.unload(),
        () => this.client?.dispose(),
      );
    } catch (error) {
      console.error('Hybrid search: plugin cleanup failed during unload.', error);
    }
  }

  private openSearchModal(forcedMode?: SearchMode): void {
    const client = this.client;
    if (!client) {
      new Notice('Hybrid search: client not ready.');
      return;
    }
    const modal = new SearchModal(this.app, client, this.settings, () => this.saveSettings(), {
      activePath: this.app.workspace.getActiveFile()?.path,
      forcedMode,
      onDidClose: (closedModal) => this.activeSearchModals.delete(closedModal),
      ownerId: this.manifest.id,
    });
    this.activeSearchModals.add(modal);
    modal.open();
  }

  private closeActiveSearchModals(): void {
    const modals = [...this.activeSearchModals];
    this.activeSearchModals.clear();
    for (const modal of modals) {
      try {
        modal.close();
      } catch (error) {
        console.error('Hybrid search: failed to close search modal during plugin unload.', error);
        // Keep unloading the remaining modals. The sweep below removes only body-level panels.
      }
    }
  }

  private removeOrphanedPanels({ includeUnstamped }: { includeUnstamped: boolean }): void {
    const documents = new Set<Document>([activeDocument]);
    this.app.workspace.iterateAllLeaves?.((leaf) => {
      const containerEl = (leaf.view as { containerEl?: HTMLElement }).containerEl;
      if (containerEl?.ownerDocument) documents.add(containerEl.ownerDocument);
    });
    sweepStrayPanels(documents, { ownerId: this.manifest.id, includeUnstamped });
  }

  restartClient(): void {
    const generation = ++this.clientGeneration;
    this.closeActiveSearchModals();
    this.client?.dispose();
    let startupFailureCoveredByStatus = false;
    this.client =
      this.settings.transport === 'http'
        ? new HttpSearchClient(this.settings.httpHost, this.settings.httpPort, {
            fallback: this.settings.httpFallbackEnabled
              ? {
                  host: this.settings.httpFallbackHost,
                  port: this.settings.httpFallbackPort,
                }
              : undefined,
            onStatusChange: (event) => {
              if (generation !== this.clientGeneration) return;
              if (event.type === 'fallback-failed') startupFailureCoveredByStatus = true;
              this.handleHttpStatusChange(event);
            },
          })
        : new SearchClient(
            this.settings.binaryPath || 'obsidian-hybrid-search',
            (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? '',
            getApiKey(this.app, this.settings.apiKeySecretId),
          );
    this.pagePreviewSimilarNotes?.clientChanged();

    this.client
      .waitReady(30_000)
      .then(() => {
        if (generation === this.clientGeneration) this.refreshEndpointSensitiveViews();
      })
      .catch((err: unknown) => {
        if (generation !== this.clientGeneration || startupFailureCoveredByStatus) return;
        const detail = err instanceof Error ? err.message : String(err);
        new Notice(`Hybrid search: server did not start.\n\n${detail}`, 0);
      });
  }

  private handleHttpStatusChange(event: HttpSearchClientStatusEvent): void {
    if (event.type === 'fallback-activated') {
      this.refreshEndpointSensitiveViews();
      new Notice(`Hybrid search: primary server unavailable; using fallback ${event.to.label}.`);
      return;
    }

    if (event.type === 'primary-restored') {
      this.refreshEndpointSensitiveViews();
      new Notice(`Hybrid search: reconnected to primary server ${event.to.label}.`);
      return;
    }

    new Notice(
      `Hybrid search: primary server unavailable and fallback ${event.to.label} failed.\n\n${event.reason}`,
    );
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as unknown;
    const savedSettings =
      typeof loaded === 'object' && loaded !== null
        ? (loaded as Partial<HybridSearchSettings>)
        : {};
    const hasSavedApiKeySecretId = Object.prototype.hasOwnProperty.call(
      savedSettings,
      'apiKeySecretId',
    );
    this.settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, savedSettings));
    if (!hasSavedApiKeySecretId && !this.settings.apiKeySecretId) {
      const legacySecretId = getLegacyApiKeySecretId(this.app);
      if (legacySecretId) {
        this.settings.apiKeySecretId = legacySecretId;
        await this.saveSettings();
      }
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onSimilarNotesSettingsChanged(): void {
    this.similarNotesBottom?.settingsChanged();
    this.pagePreviewSimilarNotes?.settingsChanged();
  }

  onSearchDisplaySettingsChanged(): void {
    for (const modal of this.activeSearchModals) void modal.refreshResultSnippets();
    for (const leaf of this.app.workspace.getLeavesOfType?.(SEARCH_PANEL_VIEW_TYPE) ?? []) {
      if (leaf.view instanceof SearchPanelView) leaf.view.refreshMetadata();
    }
  }

  onMatchSourcesSettingsChanged(): void {
    for (const modal of this.activeSearchModals) modal.refreshMatchSources();
    for (const leaf of this.app.workspace.getLeavesOfType?.(SEARCH_PANEL_VIEW_TYPE) ?? []) {
      if (leaf.view instanceof SearchPanelView) leaf.view.refreshMatchSources();
    }
    this.inlineSearch?.refreshMatchSources();
  }

  private refreshEndpointSensitiveViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType?.(SEARCH_PANEL_VIEW_TYPE) ?? []) {
      if (leaf.view instanceof SearchPanelView) leaf.view.refreshForClientChange();
    }
    this.similarNotesBottom?.refresh(true);
    void this.refreshGraphWorkbenchViews(true);
  }

  private async refreshGraphWorkbenchViews(force = false): Promise<void> {
    if (typeof this.app.workspace.getLeavesOfType !== 'function') return;
    for (const leaf of this.app.workspace.getLeavesOfType(GRAPH_WORKBENCH_VIEW_TYPE)) {
      if (leaf.view instanceof GraphWorkbenchView) {
        await leaf.view.refreshFromActiveFile(force);
      }
    }
  }

  private queueGraphWorkbenchRefresh(): void {
    if (this.graphWorkbenchRefreshTimer !== undefined) {
      window.clearTimeout(this.graphWorkbenchRefreshTimer);
    }
    this.graphWorkbenchRefreshTimer = window.setTimeout(() => {
      this.graphWorkbenchRefreshTimer = undefined;
      void this.refreshGraphWorkbenchViews(true);
    }, 350);
  }
}
