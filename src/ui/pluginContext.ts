import type { App, PluginManifest } from 'obsidian';
import type { SearchService } from '../search/contracts';
import type { HybridSearchSettings } from '../settings/model';

/** Capabilities shared by views; no dependency on the plugin lifecycle or transport. */
export interface PluginContext {
  app: App;
  manifest: Pick<PluginManifest, 'id'>;
  settings: HybridSearchSettings;
  client?: SearchService;
  saveSettings(): Promise<void>;
}
