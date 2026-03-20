import { describe, expect, it, vi } from 'vitest';
import type { HybridSearchSettings } from '../src/settings';
import { DEFAULT_SETTINGS, HybridSearchSettingTab } from '../src/settings';

const mockPlugin = {
  app: {
    workspace: { openLinkText: vi.fn() },
    vault: { adapter: { getBasePath: () => '/vault' } },
  },
  settings: {} as HybridSearchSettings,
  saveSettings: vi.fn(),
  client: undefined,
};

describe('DEFAULT_SETTINGS', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_SETTINGS.binaryPath).toBe('');
    expect(DEFAULT_SETTINGS.defaultMode).toBe('hybrid');
    expect(DEFAULT_SETTINGS.limit).toBe(10);
    expect(DEFAULT_SETTINGS.snippetLength).toBe(200);
  });
});

describe('HybridSearchSettingTab', () => {
  it('constructs without throwing', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    expect(() => new HybridSearchSettingTab(app as never, mockPlugin as never)).not.toThrow();
  });

  it('display() renders without throwing', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app as never, mockPlugin as never);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    expect(() => tab.display()).not.toThrow();
  });
});
