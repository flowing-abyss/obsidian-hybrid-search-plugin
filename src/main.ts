import { Notice, Plugin } from 'obsidian';
import { SearchClient } from './ipc';
import type { HybridSearchSettings } from './settings';
import { DEFAULT_SETTINGS, HybridSearchSettingTab } from './settings';
import { SearchModal } from './ui/SearchModal';

type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

export default class HybridSearchPlugin extends Plugin {
  settings!: HybridSearchSettings;
  client?: SearchClient;

  async onload(): Promise<void> {
    await this.loadSettings();

    const bin = this.settings.binaryPath || 'obsidian-hybrid-search';
    const vault = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? '';
    this.client = new SearchClient(bin, vault);

    this.client.waitReady().catch(() => {
      new Notice(
        'Hybrid search: server did not start. Check that Obsidian-hybrid-search is installed.',
        8000,
      );
    });

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
    this.client?.dispose();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<HybridSearchSettings>,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
