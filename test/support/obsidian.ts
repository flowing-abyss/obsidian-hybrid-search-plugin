import type { App as HostApp, TFile as HostFile, WorkspaceLeaf as HostLeaf } from 'obsidian';
import { App, TFile, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
import { vi } from 'vitest';

export function createApp(files: Record<string, string> = {}): HostApp {
  const app = App.createConfigured__({ files });
  vi.spyOn(app.workspace, 'on');
  vi.spyOn(app.workspace, 'offref');
  vi.spyOn(app.workspace, 'trigger');
  vi.spyOn(app.workspace, 'getLeaf');
  vi.spyOn(app.workspace, 'getRightLeaf');
  vi.spyOn(app.workspace, 'getLeavesOfType');
  vi.spyOn(app.workspace, 'revealLeaf');
  return app.asOriginalType__();
}

const fileVault = App.createConfigured__().vault;

/** Detached file identity. Use App.createConfigured__({ files }) for vault reads. */
export function createFile(path = ''): HostFile {
  return TFile.create__(fileVault, path).asOriginalType2__();
}

export function createLeaf(app?: unknown): HostLeaf {
  const leaf = WorkspaceLeaf.create2__(App.createConfigured__());
  if (app) Object.assign(leaf, { app__: app });
  vi.spyOn(leaf, 'setViewState').mockResolvedValue(undefined);
  return leaf.asOriginalType3__();
}
