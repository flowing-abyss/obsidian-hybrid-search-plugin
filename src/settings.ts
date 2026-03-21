import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SearchClient } from './ipc';

export interface HybridSearchSettings {
  binaryPath: string;
  defaultMode: 'hybrid' | 'semantic' | 'fulltext' | 'title';
  limit: number;
  snippetLength: number;
}

export const DEFAULT_SETTINGS: HybridSearchSettings = {
  binaryPath: '',
  defaultMode: 'hybrid',
  limit: 20,
  snippetLength: 200,
};

/** Narrow interface — only what the SettingTab needs from the plugin */
interface PluginRef {
  settings: HybridSearchSettings;
  saveSettings(): Promise<void>;
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
      .setName('Binary path')
      .setDesc('Path to Obsidian-hybrid-search binary. Leave empty to use path.')
      .addText((text) =>
        text
          .setPlaceholder('Obsidian-hybrid-search')
          .setValue(this.plugin.settings.binaryPath)
          .onChange(async (value) => {
            this.plugin.settings.binaryPath = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Default mode')
      .setDesc('Search mode used when opening the modal.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('hybrid', 'Hybrid (bm25 + semantic)')
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
      .setName('Result limit')
      .setDesc('Maximum number of results to show (5–50).')
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 1)
          .setValue(this.plugin.settings.limit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.limit = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Snippet length')
      .setDesc('Character length for result snippets (100–500).')
      .addSlider((slider) =>
        slider
          .setLimits(100, 500, 10)
          .setValue(this.plugin.settings.snippetLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.snippetLength = value;
            await this.plugin.saveSettings();
          }),
      );

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
