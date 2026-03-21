import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SearchClient } from './ipc';

export interface HybridSearchSettings {
  binaryPath: string;
  defaultMode: 'hybrid' | 'semantic' | 'fulltext' | 'title';
  showMeta: boolean;
  showPreviewMeta: boolean;
  centerPanels: boolean;
}

export const DEFAULT_SETTINGS: HybridSearchSettings = {
  binaryPath: '',
  defaultMode: 'hybrid',
  showMeta: false,
  showPreviewMeta: true,
  centerPanels: true,
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
      .setName('Show path and tags')
      .setDesc('Display folder path and tags below the note title in search results.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showMeta).onChange(async (value) => {
          this.plugin.settings.showMeta = value;
          await this.plugin.saveSettings();
        }),
      );

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
