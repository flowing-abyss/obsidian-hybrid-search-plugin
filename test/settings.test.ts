import { Notice } from 'obsidian';
import { SecretComponent, ToggleComponent } from 'obsidian-test-mocks/obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HybridSearchSettings } from '../src/settings/model';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings/model';
import { HybridSearchSettingTab } from '../src/ui/settings/HybridSearchSettingTab';
import { createApp } from './support/obsidian';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  Notice: vi.fn(),
}));

const mockPlugin = {
  app: {
    workspace: { openLinkText: vi.fn() },
    vault: { adapter: { getBasePath: () => '/vault' } },
  },
  settings: {} as HybridSearchSettings,
  saveSettings: vi.fn(),
  client: undefined,
};

function findSetting(tab: HybridSearchSettingTab, name: string): HTMLElement {
  const label = Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).find(
    (el) => el.textContent === name,
  );
  if (!label) throw new Error(`Missing setting: ${name}`);
  return label.closest<HTMLElement>('.setting-item')!;
}

function changeText(setting: HTMLElement, value: string): void {
  const input = setting.querySelector('input')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function changeDropdown(setting: HTMLElement, value: string): void {
  const select = setting.querySelector('select')!;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('DEFAULT_SETTINGS', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_SETTINGS.binaryPath).toBe('');
    expect(DEFAULT_SETTINGS.transport).toBe('stdio');
    expect(DEFAULT_SETTINGS.httpHost).toBe('127.0.0.1');
    expect(DEFAULT_SETTINGS.httpPort).toBe(3939);
    expect(DEFAULT_SETTINGS.defaultMode).toBe('hybrid');
    expect(DEFAULT_SETTINGS.defaultSearchFilters).toBe('');
    expect(DEFAULT_SETTINGS.customPostfixes).toEqual([]);
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
    expect(DEFAULT_SETTINGS.showSimilarNotesInPagePreview).toBe(false);
    expect(DEFAULT_SETTINGS.similarNotesPagePreviewLimit).toBe(5);
    expect(DEFAULT_SETTINGS.similarNotesThreshold).toBe(0);
    expect(DEFAULT_SETTINGS.searchPanelLimit).toBe(20);
    expect(DEFAULT_SETTINGS.searchPanelThreshold).toBe(0);
  });

  it('has inline search defaults', () => {
    expect(DEFAULT_SETTINGS.inlineSearchEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.inlineSearchTrigger).toBe(';;');
    expect(DEFAULT_SETTINGS.inlineSearchLimit).toBe(10);
    expect(DEFAULT_SETTINGS.inlineSearchThreshold).toBe(0);
    expect(DEFAULT_SETTINGS.inlineSearchShowPreview).toBe(true);
  });
});

describe('normalizeSettings', () => {
  it('keeps match sources opt-in for old and invalid settings', () => {
    for (const value of [undefined, null, 'true', 1]) {
      expect(
        normalizeSettings({ ...DEFAULT_SETTINGS, showMatchSources: value } as never)
          .showMatchSources,
      ).toBe(false);
    }
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, showMatchSources: true }).showMatchSources,
    ).toBe(true);
  });
  it('keeps excerpts opt-in for old and invalid settings', () => {
    expect(DEFAULT_SETTINGS.showResultSnippets).toBe(false);
    for (const value of [undefined, null, 'true', 1]) {
      expect(
        normalizeSettings({ ...DEFAULT_SETTINGS, showResultSnippets: value } as never)
          .showResultSnippets,
      ).toBe(false);
    }
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, showResultSnippets: true }).showResultSnippets,
    ).toBe(true);
  });
  it('defaults a missing or invalid secret identifier to empty', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      apiKeySecretId: 42,
    } as never);

    expect(normalized.apiKeySecretId).toBe('');
  });

  it('normalizes invalid page preview similar-note settings', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      showSimilarNotesInPagePreview: 'yes' as never,
      similarNotesPagePreviewLimit: 99,
    });
    expect(normalized.showSimilarNotesInPagePreview).toBe(false);
    expect(normalized.similarNotesPagePreviewLimit).toBe(20);
  });

  it('normalizes invalid inline search settings', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      inlineSearchEnabled: 'yes' as never,
      inlineSearchTrigger: '   ',
      inlineSearchLimit: '80' as never,
      inlineSearchThreshold: 2,
      inlineSearchShowPreview: 'true' as never,
    });
    expect(normalized.inlineSearchEnabled).toBe(DEFAULT_SETTINGS.inlineSearchEnabled);
    expect(normalized.inlineSearchTrigger).toBe(DEFAULT_SETTINGS.inlineSearchTrigger);
    expect(normalized.inlineSearchLimit).toBe(50);
    expect(normalized.inlineSearchThreshold).toBe(1);
    expect(normalized.inlineSearchShowPreview).toBe(DEFAULT_SETTINGS.inlineSearchShowPreview);
  });

  it('defaults defaultSearchFilters to empty string when missing or non-string', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      defaultSearchFilters: 42 as never,
    });
    expect(normalized.defaultSearchFilters).toBe('');
  });

  it('preserves a valid defaultSearchFilters string', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      defaultSearchFilters: '-tag:archive -folder:Templates',
    });
    expect(normalized.defaultSearchFilters).toBe('-tag:archive -folder:Templates');
  });

  it('defaults customPostfixes to an empty array when missing or not an array', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customPostfixes: 'not-an-array' as never,
    });
    expect(normalized.customPostfixes).toEqual([]);
  });

  it('preserves valid customPostfixes entries', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customPostfixes: [{ name: 'work', filters: '-tag:personal folder:work' }],
    });
    expect(normalized.customPostfixes).toEqual([
      { name: 'work', filters: '-tag:personal folder:work' },
    ]);
  });

  it('drops entries with a reserved name', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customPostfixes: [
        { name: 'rerank', filters: 'tag:x' },
        { name: 'work', filters: 'tag:y' },
      ],
    });
    expect(normalized.customPostfixes).toEqual([{ name: 'work', filters: 'tag:y' }]);
  });

  it('drops entries with an empty or malformed name', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customPostfixes: [{ name: '   ', filters: 'tag:x' }, { name: 42, filters: 'tag:y' } as never],
    });
    expect(normalized.customPostfixes).toEqual([]);
  });

  it('deduplicates entries by normalized name, keeping the first', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customPostfixes: [
        { name: 'work', filters: 'tag:first' },
        { name: '@Work', filters: 'tag:second' },
      ],
    });
    expect(normalized.customPostfixes).toEqual([{ name: 'work', filters: 'tag:first' }]);
  });
});

describe('HybridSearchSettingTab', () => {
  it('refreshes search metadata when its shared visibility setting changes', async () => {
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: vi.fn(),
      restartClient: vi.fn(),
      onSearchDisplaySettingsChanged: vi.fn(),
    };
    const tab = new HybridSearchSettingTab(createApp(), plugin as never);
    tab.display();
    findSetting(tab, 'Show path and tags')
      .querySelector<HTMLElement>('.checkbox-container')!
      .click();
    await Promise.resolve();
    expect(plugin.settings.showMeta).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.onSearchDisplaySettingsChanged).toHaveBeenCalledOnce();
    expect(plugin.restartClient).not.toHaveBeenCalled();
  });
  it('saves snippets independently of preview without restarting the client', async () => {
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS, showPreview: false },
      saveSettings: vi.fn(),
      restartClient: vi.fn(),
      onSearchDisplaySettingsChanged: vi.fn(),
    };
    const tab = new HybridSearchSettingTab(createApp(), plugin as never);
    tab.display();
    const setting = findSetting(tab, 'Show snippets in search results');
    expect(setting.closest('[hidden]')).toBeNull();
    setting.querySelector<HTMLElement>('.checkbox-container')!.click();
    await Promise.resolve();
    expect(plugin.settings.showResultSnippets).toBe(true);
    expect(plugin.settings.showPreview).toBe(false);
    expect(plugin.settings.scrollToSnippet).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.restartClient).not.toHaveBeenCalled();
    expect(plugin.onSearchDisplaySettingsChanged).toHaveBeenCalledOnce();
  });
  it('saves match sources independently and refreshes them without a search refresh', async () => {
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS, showPreview: false },
      saveSettings: vi.fn(),
      restartClient: vi.fn(),
      onMatchSourcesSettingsChanged: vi.fn(),
      onSearchDisplaySettingsChanged: vi.fn(),
    };
    const tab = new HybridSearchSettingTab(createApp(), plugin as never);
    tab.display();
    const setting = findSetting(tab, 'Show match sources');
    expect(setting.closest('[hidden]')).toBeNull();
    setting.querySelector<HTMLElement>('.checkbox-container')!.click();
    await Promise.resolve();
    expect(plugin.settings.showMatchSources).toBe(true);
    expect(plugin.settings.showResultSnippets).toBe(false);
    expect(plugin.settings.showMeta).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.onMatchSourcesSettingsChanged).toHaveBeenCalledOnce();
    expect(plugin.onSearchDisplaySettingsChanged).not.toHaveBeenCalled();
    expect(plugin.restartClient).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function (
      this: ToggleComponent,
    ) {
      this.toggleEl.addClass('checkbox-container');
      this.toggleEl.addEventListener('click', () => this.onClick());
    });
    vi.clearAllMocks();
  });

  it('constructs without throwing', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    expect(() => new HybridSearchSettingTab(app as never, mockPlugin as never)).not.toThrow();
  });

  it('display() renders without throwing', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    expect(() => tab.display()).not.toThrow();
  });

  it('display() does not render limit slider', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const { containerEl } = tab;
    const names = Array.from(containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).not.toContain('Result limit');
    expect(names).not.toContain('Snippet length');
  });

  it('display() renders show meta toggle', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const { containerEl } = tab;
    const names = Array.from(containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Show path and tags');
  });

  it('display() hides similar note limit until enabled', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Show similar notes at bottom');
    expect(names).toContain('Show similar notes in page preview');
    expect(names).not.toContain('Similar notes limit');
    expect(names).not.toContain('Page preview limit');
    expect(names).not.toContain('Minimum similarity');
    expect(names).not.toContain('Search panel limit');
  });

  it('display() renders similar note limit when similar notes are enabled', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Similar notes limit');
    expect(names).toContain('Minimum similarity');
  });

  it('shows only page preview controls and the shared threshold when only page preview is enabled', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = {
      ...DEFAULT_SETTINGS,
      showSimilarNotesInPagePreview: true,
    };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Page preview limit');
    expect(names).toContain('Minimum similarity');
    expect(names).not.toContain('Similar notes limit');
  });

  it('renders STDIO connection settings by default', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Connection mode');
    expect(names).toContain('Binary path');
    expect(names).not.toContain('HTTP host');
    expect(names).not.toContain('HTTP port');
  });

  it('binds the secret picker to its identifier and applies a new selection once', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    let finishSaving!: () => void;
    const saving = new Promise<void>((resolve) => {
      finishSaving = resolve;
    });
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS, apiKeySecretId: 'existing-secret' },
      saveSettings: vi.fn().mockReturnValue(saving),
      restartClient: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new HybridSearchSettingTab(app, plugin as never);

    const setValue = vi.spyOn(SecretComponent.prototype, 'setValue');
    const onChange = vi.spyOn(SecretComponent.prototype, 'onChange');
    tab.display();
    expect(setValue).toHaveBeenCalledWith('existing-secret');

    const applying = onChange.mock.calls[0]![0]('ohs');

    expect(plugin.settings.apiKeySecretId).toBe('ohs');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.restartClient).not.toHaveBeenCalled();

    finishSaving();
    await applying;

    expect(plugin.restartClient).toHaveBeenCalledTimes(1);
  });

  it('restarts once after connection typing settles and flushes on hide', async () => {
    vi.useFakeTimers();
    try {
      const app = createApp();
      const plugin = {
        ...mockPlugin,
        settings: { ...DEFAULT_SETTINGS },
        saveSettings: vi.fn().mockResolvedValue(undefined),
        restartClient: vi.fn(),
      };
      const tab = new HybridSearchSettingTab(app, plugin);
      tab.display();
      changeText(findSetting(tab, 'Binary path'), '/first');
      await Promise.resolve();
      changeText(findSetting(tab, 'Binary path'), '/final');
      await Promise.resolve();
      expect(plugin.restartClient).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(plugin.restartClient).toHaveBeenCalledOnce();
      expect(plugin.settings.binaryPath).toBe('/final');
      changeText(findSetting(tab, 'Binary path'), '/on-close');
      await Promise.resolve();
      tab.hide();
      expect(plugin.restartClient).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(400);
      expect(plugin.restartClient).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report connection success for a terminated client', async () => {
    const client = {
      waitReady: vi.fn().mockRejectedValue(new Error('terminated')),
      search: vi.fn().mockResolvedValue([]),
      statusReport: vi.fn(),
      dispose: vi.fn(),
    };
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS }, client };
    const tab = new HybridSearchSettingTab(createApp(), plugin);
    vi.mocked(Notice).mockClear();
    tab.display();
    findSetting(tab, 'Test connection').querySelector('button')!.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('terminated'));
    expect(Notice).not.toHaveBeenCalledWith('Connected. Server running.');
  });

  it('suppresses a connection-test notice after the client is replaced', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const client = {
      waitReady: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockReturnValue(pending),
      statusReport: vi.fn(),
      dispose: vi.fn(),
    };
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS }, client };
    const tab = new HybridSearchSettingTab(createApp(), plugin);
    vi.mocked(Notice).mockClear();
    tab.display();
    findSetting(tab, 'Test connection').querySelector('button')!.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    plugin.client = { ...client };
    finish();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(Notice).not.toHaveBeenCalled();
  });

  it('clears an optional secret selection without throwing', async () => {
    const app = createApp();
    const plugin = {
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS, apiKeySecretId: 'old-secret' },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      restartClient: vi.fn(),
    };
    const onChange = vi.spyOn(SecretComponent.prototype, 'onChange');
    new HybridSearchSettingTab(app, plugin).display();
    await onChange.mock.calls[0]![0](null);
    expect(plugin.settings.apiKeySecretId).toBe('');
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.restartClient).toHaveBeenCalledOnce();
  });

  it('renders HTTP host and port settings in HTTP mode', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, transport: 'http' };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Connection mode');
    expect(names).not.toContain('Binary path');
    expect(names).toContain('HTTP host');
    expect(names).toContain('HTTP port');
  });

  it('renders HTTP startup hint in HTTP mode', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, transport: 'http' };
    tab.display();
    expect(tab.containerEl.textContent).toContain(
      'OBSIDIAN_VAULT_PATH="/path/to/your/vault" obsidian-hybrid-search serve',
    );
  });

  it('renders fallback HTTP settings in HTTP mode', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = { ...DEFAULT_SETTINGS, transport: 'http' };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Enable fallback server');
    expect(names).not.toContain('Fallback HTTP host');
    expect(names).not.toContain('Fallback HTTP port');
  });

  it('renders fallback host and port when fallback is enabled', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const tab = new HybridSearchSettingTab(app, mockPlugin);
    mockPlugin.settings = {
      ...DEFAULT_SETTINGS,
      transport: 'http',
      httpFallbackEnabled: true,
    };
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent);
    expect(names).toContain('Fallback HTTP host');
    expect(names).toContain('Fallback HTTP port');
  });

  it('fallback toggle saves, restarts client, and refreshes settings UI', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    const fallbackSetting = findSetting(tab, 'Enable fallback server');
    expect(fallbackSetting).toBeDefined();
    fallbackSetting.querySelector<HTMLElement>('.checkbox-container')!.click();
    await Promise.resolve();
    expect(plugin.settings.httpFallbackEnabled).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.restartClient).toHaveBeenCalled();
  });

  it('binaryPath onChange updates settings and saves', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const binarySetting = findSetting(tab, 'Binary path');
    expect(binarySetting).toBeDefined();
    changeText(binarySetting, '/usr/local/bin/ohs');
    expect(plugin.settings.binaryPath).toBe('/usr/local/bin/ohs');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('connection mode onChange updates settings, saves, and restarts client', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = {
      manifest: { id: 'hybrid-search' },
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS },
      restartClient: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const transportSetting = findSetting(tab, 'Connection mode');
    expect(transportSetting).toBeDefined();
    changeDropdown(transportSetting, 'http');
    await Promise.resolve();
    expect(plugin.settings.transport).toBe('http');
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.restartClient).toHaveBeenCalled();
  });

  it('defaultMode onChange updates settings', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const modeSetting = findSetting(tab, 'Default mode');
    expect(modeSetting).toBeDefined();
    changeDropdown(modeSetting, 'semantic');
    expect(plugin.settings.defaultMode).toBe('semantic');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('showPreview toggle updates settings', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS, showPreview: false } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const previewToggle = findSetting(tab, 'Show preview');
    expect(previewToggle).toBeDefined();
    previewToggle.querySelector<HTMLElement>('.checkbox-container')!.click();
    expect(plugin.settings.showPreview).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('similar notes toggle updates settings and refreshes bottom views', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = {
      manifest: { id: 'hybrid-search' },
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS },
      onSimilarNotesSettingsChanged: vi.fn(),
    };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const setting = findSetting(tab, 'Show similar notes at bottom');
    expect(setting).toBeDefined();
    setting.querySelector<HTMLElement>('.checkbox-container')!.click();
    await Promise.resolve();
    expect(plugin.settings.showSimilarNotesAtBottom).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.onSimilarNotesSettingsChanged).toHaveBeenCalled();
  });

  it('page preview similar notes controls save and refresh preview views', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = {
      manifest: { id: 'hybrid-search' },
      ...mockPlugin,
      settings: { ...DEFAULT_SETTINGS },
      onSimilarNotesSettingsChanged: vi.fn(),
    };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const toggleSetting = findSetting(tab, 'Show similar notes in page preview');
    const limitSetting = findSetting(tab, 'Page preview limit');

    expect(toggleSetting).toBeDefined();
    expect(limitSetting).toBeDefined();
    toggleSetting.querySelector<HTMLElement>('.checkbox-container')!.click();
    changeText(limitSetting, '7');
    await Promise.resolve();

    expect(plugin.settings.showSimilarNotesInPagePreview).toBe(true);
    expect(plugin.settings.similarNotesPagePreviewLimit).toBe(7);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    expect(plugin.onSimilarNotesSettingsChanged).toHaveBeenCalledTimes(2);
  });

  it('showGraphPanel toggle updates settings', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS, showGraphPanel: false } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const graphToggle = findSetting(tab, 'Show graph panel');
    expect(graphToggle).toBeDefined();
    graphToggle.querySelector<HTMLElement>('.checkbox-container')!.click();
    expect(plugin.settings.showGraphPanel).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('inline search settings render and save trigger changes', async () => {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = { ...mockPlugin, settings: { ...DEFAULT_SETTINGS } };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    const triggerSetting = findSetting(tab, 'Trigger text');
    expect(triggerSetting).toBeDefined();
    changeText(triggerSetting, '::');
    expect(plugin.settings.inlineSearchTrigger).toBe('::');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});

describe('HybridSearchSettingTab — showPreview conditional UI', () => {
  async function makeTab(settings: HybridSearchSettings) {
    const { App } = await import('obsidian');
    const app = createApp();
    const plugin = { ...mockPlugin, settings };
    const tab = new HybridSearchSettingTab(app, plugin);
    tab.display();
    return tab;
  }

  function settingNames(tab: HybridSearchSettingTab): string[] {
    return Array.from(tab.containerEl.querySelectorAll('.setting-item-name'))
      .filter((el) => !el.closest('[hidden]'))
      .map((el) => el.textContent ?? '');
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
