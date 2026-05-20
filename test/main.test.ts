import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ipc', () => {
  const stdioInstance = {
    waitReady: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
  };
  const httpInstance = {
    waitReady: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
  };
  function MockSearchClient() {
    return stdioInstance;
  }
  function MockHttpSearchClient() {
    return httpInstance;
  }
  return {
    SearchClient: vi.fn(MockSearchClient),
    HttpSearchClient: vi.fn(MockHttpSearchClient),
  };
});

import { App } from 'obsidian';
import HybridSearchPlugin from '../src/main';

const mockGetBasePath = vi.fn().mockReturnValue('/vault');
const mockGetActiveFile = vi.fn().mockReturnValue({ path: 'active.md' });

const mockApp = {
  vault: {
    adapter: { getBasePath: mockGetBasePath },
  },
  workspace: {
    getActiveFile: mockGetActiveFile,
  },
};

const mockManifest = { id: 'hybrid-search', name: 'Hybrid Search', version: '0.1.0' };

describe('HybridSearchPlugin', () => {
  let plugin: HybridSearchPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new HybridSearchPlugin(mockApp as unknown as App, mockManifest as never);
    plugin.loadData = vi.fn().mockResolvedValue({});
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.addCommand = vi.fn();
    plugin.addRibbonIcon = vi.fn();
    plugin.addSettingTab = vi.fn();
  });

  it('loads settings on onload', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.loadData).toHaveBeenCalled();
    expect(plugin.settings).toBeDefined();
    expect(plugin.settings.defaultMode).toBe('hybrid');
  });

  it('initialises SearchClient with binary and vault path', async () => {
    const { SearchClient } = await import('../src/ipc');
    await plugin.onload();
    expect(SearchClient).toHaveBeenCalledWith('obsidian-hybrid-search', '/vault');
  });

  it('initialises HttpSearchClient when HTTP transport is selected', async () => {
    const { HttpSearchClient, SearchClient } = await import('../src/ipc');
    plugin.loadData = vi.fn().mockResolvedValue({
      transport: 'http',
      httpHost: '127.0.0.1',
      httpPort: 3939,
    });

    await plugin.onload();

    expect(SearchClient).not.toHaveBeenCalled();
    expect(HttpSearchClient).toHaveBeenCalledWith('127.0.0.1', 3939);
  });

  it('registers five commands', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.addCommand).toHaveBeenCalledTimes(5);
    const ids = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { id: string }).id,
    );
    expect(ids).toContain('open-search');
    expect(ids).toContain('search-hybrid');
    expect(ids).toContain('search-fulltext');
    expect(ids).toContain('search-semantic');
    expect(ids).toContain('search-title');
  });

  it('registers ribbon icon', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
      'search',
      'Hybrid search',
      expect.any(Function),
    );
  });

  it('adds settings tab', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
  });

  it('onunload disposes client', async () => {
    await plugin.onload();
    expect(plugin.client).toBeDefined();
    plugin.onunload();

    expect(plugin.client!.dispose).toHaveBeenCalled();
  });

  it('saveSettings persists settings', async () => {
    await plugin.onload();
    plugin.settings.binaryPath = '/usr/bin/ohs';
    await plugin.saveSettings();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.saveData).toHaveBeenCalledWith(
      expect.objectContaining({ binaryPath: '/usr/bin/ohs' }),
    );
  });
});
