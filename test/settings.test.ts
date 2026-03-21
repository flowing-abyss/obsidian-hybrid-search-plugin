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
    expect(DEFAULT_SETTINGS.showMeta).toBe(false);
  });

  it('does not have limit or snippetLength', () => {
    expect('limit' in DEFAULT_SETTINGS).toBe(false);
    expect('snippetLength' in DEFAULT_SETTINGS).toBe(false);
  });

  it('showPreview defaults to true', () => {
    expect(DEFAULT_SETTINGS.showPreview).toBe(true);
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

  it('display() does not render limit slider', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app as never, mockPlugin as never);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const { containerEl } = tab;
    const names = Array.from(containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).not.toContain('Result limit');
    expect(names).not.toContain('Snippet length');
  });

  it('display() renders show meta toggle', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app as never, mockPlugin as never);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const { containerEl } = tab;
    const names = Array.from(containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Show path and tags');
  });
});

describe('HybridSearchSettingTab — showPreview conditional UI', () => {
  async function makeTab(settings: HybridSearchSettings) {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings };
    const tab = new HybridSearchSettingTab(app as never, plugin as never);
    tab.display();
    return tab;
  }

  function settingNames(tab: HybridSearchSettingTab): string[] {
    return Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent ?? '',
    );
  }

  it('renders Show preview toggle', async () => {
    const tab = await makeTab({ ...DEFAULT_SETTINGS });
    expect(settingNames(tab)).toContain('Show preview');
  });

  it('renders showPreviewMeta and centerPanels when showPreview is true', async () => {
    const tab = await makeTab({ ...DEFAULT_SETTINGS, showPreview: true });
    const names = settingNames(tab);
    expect(names).toContain('Show note metadata in preview');
    expect(names).toContain('Center search and preview');
  });

  it('hides showPreviewMeta and centerPanels when showPreview is false', async () => {
    const tab = await makeTab({ ...DEFAULT_SETTINGS, showPreview: false });
    const names = settingNames(tab);
    expect(names).not.toContain('Show note metadata in preview');
    expect(names).not.toContain('Center search and preview');
  });
});
