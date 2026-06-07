import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    Notice: vi.fn(),
  };
});

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

import { App, Notice } from 'obsidian';
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

async function flushPromises() {
  await Promise.resolve();
}

describe('HybridSearchPlugin', () => {
  let plugin: HybridSearchPlugin;
  const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    NoticeMock.mockClear();
    plugin = new HybridSearchPlugin(mockApp as unknown as App, mockManifest as never);
    plugin.loadData = vi.fn().mockResolvedValue({});
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.addCommand = vi.fn();
    plugin.addRibbonIcon = vi.fn();
    plugin.addSettingTab = vi.fn();
    plugin.registerView = vi.fn();
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
      httpHost: 'remote.example.com',
      httpPort: 3939,
      httpFallbackEnabled: true,
      httpFallbackHost: '127.0.0.1',
      httpFallbackPort: 4949,
    });

    await plugin.onload();

    expect(SearchClient).not.toHaveBeenCalled();
    expect(HttpSearchClient).toHaveBeenCalledWith(
      'remote.example.com',
      3939,
      expect.objectContaining({
        fallback: {
          host: '127.0.0.1',
          port: 4949,
        },
        onStatusChange: expect.any(Function),
      }),
    );
  });

  it('shows notices for meaningful HTTP endpoint status changes', async () => {
    const { HttpSearchClient } = await import('../src/ipc');
    plugin.loadData = vi.fn().mockResolvedValue({
      transport: 'http',
      httpHost: 'remote.example.com',
      httpPort: 3939,
      httpFallbackEnabled: true,
      httpFallbackHost: '127.0.0.1',
      httpFallbackPort: 4949,
    });

    await plugin.onload();

    const options = vi.mocked(HttpSearchClient).mock.calls[0]?.[2] as
      | { onStatusChange?: (event: unknown) => void }
      | undefined;
    expect(options?.onStatusChange).toEqual(expect.any(Function));

    options!.onStatusChange!({
      type: 'fallback-activated',
      from: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
      to: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
      reason: 'HTTP MCP request timed out',
    });
    options!.onStatusChange!({
      type: 'primary-restored',
      from: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
      to: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
    });

    expect(NoticeMock).toHaveBeenCalledWith(
      'Hybrid search: primary server unavailable; using fallback 127.0.0.1:4949.',
    );
    expect(NoticeMock).toHaveBeenCalledWith(
      'Hybrid search: reconnected to primary server remote.example.com:3939.',
    );
  });

  it('shows fallback failure reason without duplicate generic startup notice', async () => {
    const { HttpSearchClient } = await import('../src/ipc');
    plugin.loadData = vi.fn().mockResolvedValue({
      transport: 'http',
      httpHost: 'remote.example.com',
      httpPort: 3939,
      httpFallbackEnabled: true,
      httpFallbackHost: '127.0.0.1',
      httpFallbackPort: 4949,
    });
    vi.mocked(HttpSearchClient).mockImplementationOnce(function (_host, _port, options) {
      return {
        waitReady: vi.fn().mockImplementation(() => {
          options?.onStatusChange?.({
            type: 'fallback-failed',
            from: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
            to: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
            reason: 'HTTP MCP server is not healthy: 503',
          });
          return Promise.reject(new Error('HTTP MCP server is not healthy: 503'));
        }),
        dispose: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
      };
    });

    await plugin.onload();
    await flushPromises();

    expect(NoticeMock).toHaveBeenCalledTimes(1);
    expect(NoticeMock).toHaveBeenCalledWith(
      'Hybrid search: primary server unavailable and fallback 127.0.0.1:4949 failed.\n\nHTTP MCP server is not healthy: 503',
    );
  });

  it('registers search modal, search panel, and graph workbench commands', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.addCommand).toHaveBeenCalledTimes(11);
    const ids = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { id: string }).id,
    );
    expect(ids).toContain('open-search');
    expect(ids).toContain('search-hybrid');
    expect(ids).toContain('search-fulltext');
    expect(ids).toContain('search-semantic');
    expect(ids).toContain('search-title');
    expect(ids).toContain('open-search-panel');
    expect(ids).toContain('open-graph-workbench');
    expect(ids).toContain('search-panel-hybrid');
    expect(ids).toContain('search-panel-fulltext');
    expect(ids).toContain('search-panel-semantic');
    expect(ids).toContain('search-panel-title');
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

  it('registers docked search panel view', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.registerView).toHaveBeenCalledWith('hybrid-search-panel', expect.any(Function));
  });

  it('registers docked graph workbench view', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(plugin.registerView).toHaveBeenCalledWith(
      'hybrid-search-graph-workbench',
      expect.any(Function),
    );
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
