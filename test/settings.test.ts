import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Setting } from '../__mocks__/obsidian';
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

  it('showGraphPanel defaults to false', () => {
    expect(DEFAULT_SETTINGS.showGraphPanel).toBe(false);
  });
});

describe('HybridSearchSettingTab', () => {
  beforeEach(() => {
    Setting.clearInstances();
    vi.clearAllMocks();
  });

  it('constructs without throwing', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    expect(() => new HybridSearchSettingTab(app as never, mockPlugin as never)).not.toThrow();
  });

  it('display() renders without throwing', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    expect(() => tab.display()).not.toThrow();
  });

  it('display() does not render limit slider', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
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
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const { containerEl } = tab;
    const names = Array.from(containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Show path and tags');
  });

  it('binaryPath onChange updates settings and saves', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const binarySetting = Setting.instances.find((s) => s.textComponents.length > 0);
    expect(binarySetting).toBeDefined();
    binarySetting!.textComponents[0]!.triggerChange('/usr/local/bin/ohs');
    expect(plugin.settings.binaryPath).toBe('/usr/local/bin/ohs');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('defaultMode onChange updates settings', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const modeSetting = Setting.instances.find((s) => s.dropdownComponents.length > 0);
    expect(modeSetting).toBeDefined();
    modeSetting!.dropdownComponents[0]!.triggerChange('semantic');
    expect(plugin.settings.defaultMode).toBe('semantic');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('showPreview toggle updates settings', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS, showPreview: false } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const previewToggle = Setting.instances.find((s) => s.getName() === 'Show preview');
    expect(previewToggle).toBeDefined();
    previewToggle!.toggleComponents[0]!.triggerChange(true);
    expect(plugin.settings.showPreview).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('showGraphPanel toggle updates settings', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS, showGraphPanel: false } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const graphToggle = Setting.instances.find((s) => s.getName() === 'Show graph panel');
    expect(graphToggle).toBeDefined();
    graphToggle!.toggleComponents[0]!.triggerChange(true);
    expect(plugin.settings.showGraphPanel).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});

describe('HybridSearchSettingTab — showPreview conditional UI', () => {
  async function makeTab(settings: HybridSearchSettings) {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings };
    const tab = new HybridSearchSettingTab(app, plugin);
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

  it('renders Show graph panel toggle', async () => {
    const tab = await makeTab({ ...DEFAULT_SETTINGS });
    expect(settingNames(tab)).toContain('Show graph panel');
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
