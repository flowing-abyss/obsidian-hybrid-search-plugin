import { Notice, Plugin, type EventRef } from 'obsidian';
import type { HttpSearchClientStatusEvent } from './ipc';
import { HttpSearchClient, SearchClient } from './ipc';
import type { HybridSearchSettings } from './settings';
import { DEFAULT_SETTINGS, HybridSearchSettingTab, normalizeSettings } from './settings';
import {
  GRAPH_WORKBENCH_VIEW_TYPE,
  GraphWorkbenchView,
  revealGraphWorkbench,
} from './ui/GraphWorkbenchView';
import { InlineSearchSuggest } from './ui/InlineSearchSuggest';
import { SearchModal } from './ui/SearchModal';
import { revealSearchPanel, SEARCH_PANEL_VIEW_TYPE, SearchPanelView } from './ui/SearchPanelView';
import { SimilarNotesBottomManager } from './ui/SimilarNotesBottom';

type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

export default class HybridSearchPlugin extends Plugin {
  settings!: HybridSearchSettings;
  client?: SearchClient | HttpSearchClient;
  private similarNotesBottom?: SimilarNotesBottomManager;
  private graphWorkbenchRefreshTimer?: number;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.restartClient();
    this.registerEditorSuggest(new InlineSearchSuggest(this.app, this));
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

    const openSearchModal = (forcedMode?: SearchMode) => {
      if (!this.client) {
        new Notice('Hybrid search: client not ready.');
        return;
      }
      const activePath = this.app.workspace.getActiveFile()?.path;
      new SearchModal(
        this.app,
        this.client,
        this.settings,
        () => this.saveSettings(),
        activePath,
        forcedMode,
      ).open();
    };

    this.addCommand({
      id: 'open-search',
      name: 'Open search',
      callback: () => openSearchModal(),
    });

    this.addCommand({
      id: 'search-hybrid',
      name: 'Hybrid mode',
      callback: () => openSearchModal('hybrid'),
    });

    this.addCommand({
      id: 'search-fulltext',
      name: 'Fulltext mode',
      callback: () => openSearchModal('fulltext'),
    });

    this.addCommand({
      id: 'search-semantic',
      name: 'Semantic mode',
      callback: () => openSearchModal('semantic'),
    });

    this.addCommand({
      id: 'search-title',
      name: 'Title mode',
      callback: () => openSearchModal('title'),
    });

    this.addCommand({
      id: 'open-search-panel',
      name: 'Open search panel',
      callback: () => {
        void revealSearchPanel(this);
      },
    });

    this.addCommand({
      id: 'open-graph-workbench',
      name: 'Open graph workbench',
      callback: () => {
        void revealGraphWorkbench(this);
      },
    });

    this.addCommand({
      id: 'search-panel-hybrid',
      name: 'Search panel: Hybrid mode',
      callback: () => {
        void revealSearchPanel(this, 'hybrid');
      },
    });

    this.addCommand({
      id: 'search-panel-fulltext',
      name: 'Search panel: Fulltext mode',
      callback: () => {
        void revealSearchPanel(this, 'fulltext');
      },
    });

    this.addCommand({
      id: 'search-panel-semantic',
      name: 'Search panel: Semantic mode',
      callback: () => {
        void revealSearchPanel(this, 'semantic');
      },
    });

    this.addCommand({
      id: 'search-panel-title',
      name: 'Search panel: Title mode',
      callback: () => {
        void revealSearchPanel(this, 'title');
      },
    });

    this.addRibbonIcon('search', 'Hybrid search', () => {
      if (!this.client) {
        new Notice('Hybrid search: client not ready.');
        return;
      }
      const activePath = this.app.workspace.getActiveFile()?.path;
      new SearchModal(
        this.app,
        this.client,
        this.settings,
        () => this.saveSettings(),
        activePath,
      ).open();
    });

    this.addSettingTab(new HybridSearchSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.graphWorkbenchRefreshTimer !== undefined) {
      window.clearTimeout(this.graphWorkbenchRefreshTimer);
      this.graphWorkbenchRefreshTimer = undefined;
    }
    this.similarNotesBottom?.unload();
    this.client?.dispose();
  }

  restartClient(): void {
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
              if (event.type === 'fallback-failed') startupFailureCoveredByStatus = true;
              this.handleHttpStatusChange(event);
            },
          })
        : new SearchClient(
            this.settings.binaryPath || 'obsidian-hybrid-search',
            (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? '',
          );

    this.client.waitReady(30_000).catch((err: unknown) => {
      if (startupFailureCoveredByStatus) return;
      const detail = err instanceof Error ? err.message : String(err);
      new Notice(`Hybrid search: server did not start.\n\n${detail}`, 0);
    });
  }

  private handleHttpStatusChange(event: HttpSearchClientStatusEvent): void {
    if (event.type === 'fallback-activated') {
      new Notice(`Hybrid search: primary server unavailable; using fallback ${event.to.label}.`);
      return;
    }

    if (event.type === 'primary-restored') {
      new Notice(`Hybrid search: reconnected to primary server ${event.to.label}.`);
      return;
    }

    new Notice(
      `Hybrid search: primary server unavailable and fallback ${event.to.label} failed.\n\n${event.reason}`,
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(
      Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<HybridSearchSettings>),
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onSimilarNotesSettingsChanged(): void {
    this.similarNotesBottom?.settingsChanged();
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
