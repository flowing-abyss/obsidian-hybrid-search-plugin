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
  inlineSearchEnabled: boolean;
  inlineSearchTrigger: string;
  inlineSearchLimit: number;
  inlineSearchThreshold: number;
  inlineSearchShowPreview: boolean;
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
  inlineSearchEnabled: true,
  inlineSearchTrigger: ';;',
  inlineSearchLimit: 10,
  inlineSearchThreshold: 0,
  inlineSearchShowPreview: true,
};

export function normalizeSettings(settings: HybridSearchSettings): HybridSearchSettings {
  return {
    ...settings,
    inlineSearchEnabled:
      typeof settings.inlineSearchEnabled === 'boolean'
        ? settings.inlineSearchEnabled
        : DEFAULT_SETTINGS.inlineSearchEnabled,
    inlineSearchTrigger:
      typeof settings.inlineSearchTrigger === 'string' &&
      settings.inlineSearchTrigger.trim() &&
      !settings.inlineSearchTrigger.trim().startsWith('[')
        ? settings.inlineSearchTrigger.trim()
        : DEFAULT_SETTINGS.inlineSearchTrigger,
    inlineSearchLimit: clampInteger(
      settings.inlineSearchLimit,
      1,
      50,
      DEFAULT_SETTINGS.inlineSearchLimit,
    ),
    inlineSearchThreshold: clampNumber(
      settings.inlineSearchThreshold,
      0,
      1,
      DEFAULT_SETTINGS.inlineSearchThreshold,
    ),
    inlineSearchShowPreview:
      typeof settings.inlineSearchShowPreview === 'boolean'
        ? settings.inlineSearchShowPreview
        : DEFAULT_SETTINGS.inlineSearchShowPreview,
  };
}

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
            httpSettingsEl.hidden = value !== 'http';
            stdioSettingsEl.hidden = value !== 'stdio';
            fallbackSettingsEl.hidden = !(
              value === 'http' && this.plugin.settings.httpFallbackEnabled
            );
          }),
      );

    const httpSettingsEl = containerEl.createDiv();
    const fallbackSettingsEl = containerEl.createDiv();
    const stdioSettingsEl = containerEl.createDiv();

    new Setting(httpSettingsEl).setName('Start server').setDesc(HTTP_START_COMMAND);

    new Setting(httpSettingsEl)
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

    new Setting(httpSettingsEl)
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

    new Setting(httpSettingsEl)
      .setName('Enable fallback server')
      .setDesc(
        'Use a secondary mcp HTTP server when the primary server is unavailable. The fallback should serve the same vault/index.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.httpFallbackEnabled).onChange(async (value) => {
          this.plugin.settings.httpFallbackEnabled = value;
          await this.plugin.saveSettings();
          await this.plugin.restartClient?.();
          fallbackSettingsEl.hidden = !value;
        }),
      );

    new Setting(fallbackSettingsEl)
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

    new Setting(fallbackSettingsEl)
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

    new Setting(stdioSettingsEl)
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

    httpSettingsEl.hidden = this.plugin.settings.transport !== 'http';
    stdioSettingsEl.hidden = this.plugin.settings.transport !== 'stdio';
    fallbackSettingsEl.hidden = !(
      this.plugin.settings.transport === 'http' && this.plugin.settings.httpFallbackEnabled
    );

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
          previewSettingsEl.hidden = !value;
        }),
      );

    const previewSettingsEl = containerEl.createDiv();

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

    new Setting(previewSettingsEl)
      .setName('Show note metadata in preview')
      .setDesc('Display folder, aliases, tags, links, and backlinks below the preview panel.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showPreviewMeta).onChange(async (value) => {
          this.plugin.settings.showPreviewMeta = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(previewSettingsEl)
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

    new Setting(previewSettingsEl)
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

    previewSettingsEl.hidden = !this.plugin.settings.showPreview;

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
      .setName('Inline search')
      .setDesc('Open a compact search menu in the editor after typing this trigger.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.inlineSearchEnabled).onChange(async (value) => {
          this.plugin.settings.inlineSearchEnabled = value;
          await this.plugin.saveSettings();
          inlineSearchSettingsEl.hidden = !value;
        }),
      );

    const inlineSearchSettingsEl = containerEl.createDiv();

    new Setting(inlineSearchSettingsEl)
      .setName('Trigger text')
      .setDesc('Text that opens inline search while editing.')
      .addText((text) =>
        text
          .setPlaceholder(';;')
          .setValue(this.plugin.settings.inlineSearchTrigger)
          .onChange(async (value) => {
            const trigger = value.trim();
            if (trigger.startsWith('[')) return;
            this.plugin.settings.inlineSearchTrigger =
              trigger || DEFAULT_SETTINGS.inlineSearchTrigger;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(inlineSearchSettingsEl)
      .setName('Inline result limit')
      .setDesc('Maximum number of notes shown in the inline search menu.')
      .addText((text) =>
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.inlineSearchLimit))
          .onChange(async (value) => {
            const limit = Number(value);
            if (Number.isInteger(limit) && limit >= 1 && limit <= 50) {
              this.plugin.settings.inlineSearchLimit = limit;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(inlineSearchSettingsEl)
      .setName('Inline minimum relevance')
      .setDesc('Hide inline results below this score. Use 0 to keep every result.')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.inlineSearchThreshold))
          .onChange(async (value) => {
            const threshold = Number(value);
            if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
              this.plugin.settings.inlineSearchThreshold = threshold;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(inlineSearchSettingsEl)
      .setName('Show inline preview')
      .setDesc('Show a compact note preview next to the inline search menu.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.inlineSearchShowPreview).onChange(async (value) => {
          this.plugin.settings.inlineSearchShowPreview = value;
          await this.plugin.saveSettings();
        }),
      );

    inlineSearchSettingsEl.hidden = !this.plugin.settings.inlineSearchEnabled;

    new Setting(containerEl)
      .setName('Show similar notes at bottom')
      .setDesc('Display similar notes above embedded backlinks in rendered notes.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showSimilarNotesAtBottom).onChange(async (value) => {
          this.plugin.settings.showSimilarNotesAtBottom = value;
          await this.plugin.saveSettings();
          this.plugin.onSimilarNotesSettingsChanged?.();
          similarNotesSettingsEl.hidden = !value;
        }),
      );

    const similarNotesSettingsEl = containerEl.createDiv();

    new Setting(similarNotesSettingsEl)
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

    new Setting(similarNotesSettingsEl)
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

    similarNotesSettingsEl.hidden = !this.plugin.settings.showSimilarNotesAtBottom;

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

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
