import { Notice, Plugin } from 'obsidian';
import { SearchClient } from './ipc';
import type { HybridSearchSettings } from './settings';
import { DEFAULT_SETTINGS, HybridSearchSettingTab } from './settings';
import { SearchModal } from './ui/SearchModal';

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

    this.addCommand({
      id: 'open-search',
      name: 'Open search',
      callback: () => {
        if (!this.client) {
          new Notice('Hybrid search: client not ready.');
          return;
        }
        new SearchModal(this.app, this.client, this.settings).open();
      },
    });

    this.addRibbonIcon('search', 'Hybrid search', () => {
      if (!this.client) {
        new Notice('Hybrid search: client not ready.');
        return;
      }
      new SearchModal(this.app, this.client, this.settings).open();
    });

    this.addSettingTab(new HybridSearchSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.registerSuperchargedLinks();
    });
  }

  private registerSuperchargedLinks(): void {
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const slPlugin = (this.app as any).plugins?.plugins?.['supercharged-links-obsidian']; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (slPlugin && typeof slPlugin.registerViewType === 'function') {
      slPlugin.registerViewType('markdown', slPlugin, '.hybrid-search-result', true);
    }
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
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
