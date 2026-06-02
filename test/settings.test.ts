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
    expect(DEFAULT_SETTINGS.transport).toBe('stdio');
    expect(DEFAULT_SETTINGS.httpHost).toBe('127.0.0.1');
    expect(DEFAULT_SETTINGS.httpPort).toBe(3939);
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

  it('has fallback HTTP defaults', () => {
    expect(DEFAULT_SETTINGS.httpFallbackEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.httpFallbackHost).toBe('127.0.0.1');
    expect(DEFAULT_SETTINGS.httpFallbackPort).toBe(3939);
  });

  it('has similar notes and search panel defaults', () => {
    expect(DEFAULT_SETTINGS.showSimilarNotesAtBottom).toBe(false);
    expect(DEFAULT_SETTINGS.similarNotesBottomLimit).toBe(5);
    expect(DEFAULT_SETTINGS.similarNotesThreshold).toBe(0);
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

  it('display() hides similar note limit until enabled', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Show similar notes at bottom');
    expect(names).not.toContain('Similar notes limit');
    expect(names).not.toContain('Minimum similarity');
    expect(names).not.toContain('Search panel limit');
  });

  it('display() renders similar note limit when similar notes are enabled', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Similar notes limit');
    expect(names).toContain('Minimum similarity');
  });

  it('renders STDIO connection settings by default', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Connection mode');
    expect(names).toContain('Binary path');
    expect(names).not.toContain('HTTP host');
    expect(names).not.toContain('HTTP port');
  });

  it('renders HTTP host and port settings in HTTP mode', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, transport: 'http' };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Connection mode');
    expect(names).not.toContain('Binary path');
    expect(names).toContain('HTTP host');
    expect(names).toContain('HTTP port');
  });

  it('renders HTTP startup hint in HTTP mode', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, transport: 'http' };
    tab.display();
    expect(tab.containerEl.textContent).toContain(
      'OBSIDIAN_VAULT_PATH="/path/to/your/vault" obsidian-hybrid-search serve',
    );
  });

  it('renders fallback HTTP settings in HTTP mode', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, transport: 'http' };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Enable fallback server');
    expect(names).not.toContain('Fallback HTTP host');
    expect(names).not.toContain('Fallback HTTP port');
  });

  it('renders fallback host and port when fallback is enabled', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = {
      ...DEFAULT_SETTINGS,
      transport: 'http',
      httpFallbackEnabled: true,
    };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map(
      (el) => el.textContent,
    );
    expect(names).toContain('Fallback HTTP host');
    expect(names).toContain('Fallback HTTP port');
  });

  it('fallback toggle saves, restarts client, and refreshes settings UI', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = {
      ...mockPlugin,
      settings: {
        ...DEFAULT_SETTINGS,
        transport: 'http',
        httpFallbackEnabled: false,
      } as HybridSearchSettings,
      restartClient: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const fallbackSetting = Setting.instances.find((s) => s.getName() === 'Enable fallback server');
    expect(fallbackSetting).toBeDefined();
    fallbackSetting!.toggleComponents[0]!.triggerChange(true);
    await Promise.resolve();
    expect(plugin.settings.httpFallbackEnabled).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.restartClient).toHaveBeenCalled();
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

  it('connection mode onChange updates settings, saves, and restarts client', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS },
      restartClient: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const transportSetting = Setting.instances.find((s) => s.getName() === 'Connection mode');
    expect(transportSetting).toBeDefined();
    transportSetting!.dropdownComponents[0]!.triggerChange('http');
    await Promise.resolve();
    expect(plugin.settings.transport).toBe('http');
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.restartClient).toHaveBeenCalled();
  });

  it('defaultMode onChange updates settings', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const modeSetting = Setting.instances.find((s) => s.getName() === 'Default mode');
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

  it('similar notes toggle updates settings and refreshes bottom views', async () => {
    const { App } = await import('obsidian');
    const app = new App();
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS },
      onSimilarNotesSettingsChanged: vi.fn(),
    };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const setting = Setting.instances.find((s) => s.getName() === 'Show similar notes at bottom');
    expect(setting).toBeDefined();
    setting!.toggleComponents[0]!.triggerChange(true);
    await Promise.resolve();
    expect(plugin.settings.showSimilarNotesAtBottom).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.onSimilarNotesSettingsChanged).toHaveBeenCalled();
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
