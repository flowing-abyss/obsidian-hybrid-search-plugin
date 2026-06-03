import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SearchClient } from './ipc';

export interface HybridSearchSettings {
  binaryPath: string;
  transport: 'stdio' | 'http';
  httpHost: string;
  httpPort: number;
  httpFallbackEnabled: boolean;
  httpFallbackHost: string;
  httpFallbackPort: number;
  defaultMode: 'hybrid' | 'semantic' | 'fulltext' | 'title';
  showMeta: boolean;
  showPreviewMeta: boolean;
  centerPanels: boolean;
  showPreview: boolean;
  showGraphPanel: boolean;
  scrollToSnippet: boolean;
  rememberLastQuery: boolean;
  lastQuery: string;
  showSimilarNotesAtBottom: boolean;
  similarNotesBottomLimit: number;
  similarNotesThreshold: number;
  searchPanelLimit: number;
  searchPanelThreshold: number;
}

export const DEFAULT_SETTINGS: HybridSearchSettings = {
  binaryPath: '',
  transport: 'stdio',
  httpHost: '127.0.0.1',
  httpPort: 3939,
  httpFallbackEnabled: false,
  httpFallbackHost: '127.0.0.1',
  httpFallbackPort: 3939,
  defaultMode: 'hybrid',
  showMeta: false,
  showPreviewMeta: true,
  centerPanels: false,
  showPreview: true,
  showGraphPanel: false,
  scrollToSnippet: false,
  rememberLastQuery: true,
  lastQuery: '',
  showSimilarNotesAtBottom: false,
  similarNotesBottomLimit: 5,
  similarNotesThreshold: 0,
  searchPanelLimit: 20,
  searchPanelThreshold: 0,
};

const HTTP_START_COMMAND =
  'OBSIDIAN' + '_VAULT_PATH="/path/to/your/vault" obsidian-hybrid-search serve';

/** Narrow interface — only what the SettingTab needs from the plugin */
interface PluginRef {
  settings: HybridSearchSettings;
  saveSettings(): Promise<void>;
  restartClient?(): void | Promise<void>;
  onSimilarNotesSettingsChanged?(): void;
  client?: Pick<SearchClient, 'search'>;
}

export class HybridSearchSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: PluginRef,
  ) {
    super(app, plugin as never);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Connection mode')
      .setDesc(
        'Use stdio to let the plugin start the local CLI process, or HTTP to connect to a shared mcp server.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('stdio', 'STDIO')
          .addOption('http', 'HTTP')
          .setValue(this.plugin.settings.transport)
          .onChange(async (value) => {
            this.plugin.settings.transport = value as HybridSearchSettings['transport'];
            await this.plugin.saveSettings();
            await this.plugin.restartClient?.();
            this.display();
          }),
      );

    if (this.plugin.settings.transport === 'http') {
      new Setting(containerEl).setName('Start server').setDesc(HTTP_START_COMMAND);

      new Setting(containerEl)
        .setName('HTTP host')
        .setDesc('Host of the shared mcp HTTP server.')
        .addText((text) =>
          text
            .setPlaceholder('127.0.0.1')
            .setValue(this.plugin.settings.httpHost)
            .onChange(async (value) => {
              this.plugin.settings.httpHost = value.trim() || DEFAULT_SETTINGS.httpHost;
              await this.plugin.saveSettings();
              await this.plugin.restartClient?.();
            }),
        );

      new Setting(containerEl)
        .setName('HTTP port')
        .setDesc('Port of the shared mcp HTTP server.')
        .addText((text) =>
          text
            .setPlaceholder('3939')
            .setValue(String(this.plugin.settings.httpPort))
            .onChange(async (value) => {
              const port = Number(value);
              if (Number.isInteger(port) && port > 0 && port <= 65_535) {
                this.plugin.settings.httpPort = port;
                await this.plugin.saveSettings();
                await this.plugin.restartClient?.();
              }
            }),
        );

      new Setting(containerEl)
        .setName('Enable fallback server')
        .setDesc(
          'Use a secondary mcp HTTP server when the primary server is unavailable. The fallback should serve the same vault/index.',
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.httpFallbackEnabled).onChange(async (value) => {
            this.plugin.settings.httpFallbackEnabled = value;
            await this.plugin.saveSettings();
            await this.plugin.restartClient?.();
            this.display();
          }),
        );

      if (this.plugin.settings.httpFallbackEnabled) {
        new Setting(containerEl)
          .setName('Fallback HTTP host')
          .setDesc('Host of the fallback mcp HTTP server.')
          .addText((text) =>
            text
              .setPlaceholder('127.0.0.1')
              .setValue(this.plugin.settings.httpFallbackHost)
              .onChange(async (value) => {
                this.plugin.settings.httpFallbackHost =
                  value.trim() || DEFAULT_SETTINGS.httpFallbackHost;
                await this.plugin.saveSettings();
                await this.plugin.restartClient?.();
              }),
          );

        new Setting(containerEl)
          .setName('Fallback HTTP port')
          .setDesc('Port of the fallback mcp HTTP server.')
          .addText((text) =>
            text
              .setPlaceholder('3939')
              .setValue(String(this.plugin.settings.httpFallbackPort))
              .onChange(async (value) => {
                const port = Number(value);
                if (Number.isInteger(port) && port > 0 && port <= 65_535) {
                  this.plugin.settings.httpFallbackPort = port;
                  await this.plugin.saveSettings();
                  await this.plugin.restartClient?.();
                }
              }),
          );
      }
    } else {
      new Setting(containerEl)
        .setName('Binary path')
        .setDesc(
          'Absolute path to the Obsidian-hybrid-search binary. Leave empty to search in path. Common locations: /opt/homebrew/bin/Obsidian-hybrid-search, /usr/local/bin/Obsidian-hybrid-search, ~/.npm/bin/Obsidian-hybrid-search.',
        )
        .addText((text) =>
          text
            .setPlaceholder('Obsidian-hybrid-search')
            .setValue(this.plugin.settings.binaryPath)
            .onChange(async (value) => {
              this.plugin.settings.binaryPath = value;
              await this.plugin.saveSettings();
              await this.plugin.restartClient?.();
            }),
        );
    }

    new Setting(containerEl)
      .setName('Default mode')
      .setDesc('Search mode used when opening the modal.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('hybrid', 'Hybrid (bm25 + trigram + semantic)')
          .addOption('fulltext', 'Fulltext (bm25 only)')
          .addOption('semantic', 'Semantic (vector only)')
          .addOption('title', 'Title (fuzzy)')
          .setValue(this.plugin.settings.defaultMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultMode = value as HybridSearchSettings['defaultMode'];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Show path and tags')
      .setDesc('Display folder path and tags below the note title in search results.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showMeta).onChange(async (value) => {
          this.plugin.settings.showMeta = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Show preview')
      .setDesc('Show a live preview panel next to search results when hovering or navigating.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showPreview).onChange(async (value) => {
          this.plugin.settings.showPreview = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Show graph panel')
      .setDesc(
        'Show an interactive local graph panel to the right of the preview when hovering or navigating search results.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showGraphPanel).onChange(async (value) => {
          this.plugin.settings.showGraphPanel = value;
          await this.plugin.saveSettings();
        }),
      );

    if (this.plugin.settings.showPreview) {
      new Setting(containerEl)
        .setName('Show note metadata in preview')
        .setDesc('Display folder, aliases, tags, links, and backlinks below the preview panel.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.showPreviewMeta).onChange(async (value) => {
            this.plugin.settings.showPreviewMeta = value;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName('Center search and preview')
        .setDesc(
          'Shift the search panel so that the search list and preview panel together appear centered on screen. Disable if your theme positions the modal itself (e.g., left-aligned).',
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.centerPanels).onChange(async (value) => {
            this.plugin.settings.centerPanels = value;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName('Scroll preview to relevant snippet')
        .setDesc(
          'Automatically scroll the preview panel to the matching passage when navigating search results.',
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.scrollToSnippet).onChange(async (value) => {
            this.plugin.settings.scrollToSnippet = value;
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName('Remember last search query')
      .setDesc('Restore the previous search query when reopening the search modal.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rememberLastQuery).onChange(async (value) => {
          this.plugin.settings.rememberLastQuery = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Show similar notes at bottom')
      .setDesc('Display similar notes above embedded backlinks in rendered notes.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showSimilarNotesAtBottom).onChange(async (value) => {
          this.plugin.settings.showSimilarNotesAtBottom = value;
          await this.plugin.saveSettings();
          this.plugin.onSimilarNotesSettingsChanged?.();
          this.display();
        }),
      );

    if (this.plugin.settings.showSimilarNotesAtBottom) {
      new Setting(containerEl)
        .setName('Similar notes limit')
        .setDesc('Maximum number of similar notes shown at the bottom of a note.')
        .addText((text) =>
          text
            .setPlaceholder('5')
            .setValue(String(this.plugin.settings.similarNotesBottomLimit))
            .onChange(async (value) => {
              const limit = Number(value);
              if (Number.isInteger(limit) && limit >= 1 && limit <= 20) {
                this.plugin.settings.similarNotesBottomLimit = limit;
                await this.plugin.saveSettings();
                this.plugin.onSimilarNotesSettingsChanged?.();
              }
            }),
        );

      new Setting(containerEl)
        .setName('Minimum similarity')
        .setDesc('Hide semantic results below this score. Use 0 to keep every result.')
        .addText((text) =>
          text
            .setPlaceholder('0')
            .setValue(String(this.plugin.settings.similarNotesThreshold))
            .onChange(async (value) => {
              const threshold = Number(value);
              if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
                this.plugin.settings.similarNotesThreshold = threshold;
                await this.plugin.saveSettings();
                this.plugin.onSimilarNotesSettingsChanged?.();
              }
            }),
        );
    }

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Send a test query to verify the server is running.')
      .addButton((btn) =>
        btn
          .setButtonText('Test')
          .setCta()
          .onClick(async () => {
            if (!this.plugin.client) {
              new Notice('Search client not initialised.');
              return;
            }
            try {
              await this.plugin.client.search('test', { limit: 1 });
              new Notice('Connected. Server running.');
            } catch (err) {
              new Notice(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }),
      );
  }
}
