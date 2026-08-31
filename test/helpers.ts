/**
 * Shared factory for the hybrid-search plugin mock.
 *
 * Tests only pass the behaviour they care about. Any new required key on the
 * plugin is added here once, instead of being re-typed in every literal.
 */
import { App } from 'obsidian';
import { vi } from 'vitest';

import type { default as HybridSearchPlugin } from '../src/main';
import { DEFAULT_SETTINGS, type HybridSearchSettings } from '../src/settings';

export const DEFAULT_PLUGIN_MANIFEST = {
  id: 'hybrid-search',
  name: 'Hybrid Search',
  version: '0.9.1',
} as const;

export function createPluginMock({
  app = new App(),
  settings = {},
  client = {
    search: vi.fn().mockResolvedValue([]),
    waitReady: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  },
}: {
  app?: App;
  settings?: Partial<HybridSearchSettings>;
  client?: unknown;
} = {}) {
  return {
    app,
    manifest: { ...DEFAULT_PLUGIN_MANIFEST },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    client,
    saveSettings: vi.fn(),
    restartClient: vi.fn(),
    onSimilarNotesSettingsChanged: vi.fn(),
  } as unknown as HybridSearchPlugin;
}
