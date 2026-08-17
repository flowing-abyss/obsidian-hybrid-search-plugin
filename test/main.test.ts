import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { App, Notice, type PluginManifest } from 'obsidian';
import HybridSearchPlugin from '../src/main';
import { BODY_PANEL_CLASSES, createBodyPanel } from '../src/ui/bodyPanels';
import { GraphWorkbenchView } from '../src/ui/GraphWorkbenchView';
import { SearchModal } from '../src/ui/SearchModal';
import { SimilarNotesBottomManager } from '../src/ui/SimilarNotesBottom';

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

const mockManifest: PluginManifest = {
  id: 'hybrid-search',
  name: 'Hybrid Search',
  version: '0.1.0',
  minAppVersion: '1.0.0',
  author: 'flowing-abyss',
  description: 'Fast hybrid search over your vault.',
};

// Unscoped: assertions want every panel in the document, not just this instance's.
const ALL_BODY_PANELS = BODY_PANEL_CLASSES.map((cls) => `.${cls}`).join(', ');

async function flushPromises() {
  await Promise.resolve();
}

describe('HybridSearchPlugin', () => {
  let plugin: HybridSearchPlugin;
  const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

  /** Triggers a registered command the way Obsidian would, failing loudly if the id is wrong. */
  function invokeCommand(id: string): void {
    const command = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as { id: string; callback?: () => void })
      .find((registered) => registered.id === id);
    if (!command?.callback) throw new Error(`No command registered with id "${id}"`);
    command.callback();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    activeDocument.querySelectorAll(ALL_BODY_PANELS).forEach((el) => el.remove());
    NoticeMock.mockClear();
    delete (mockApp.workspace as { getLeavesOfType?: unknown }).getLeavesOfType;
    plugin = new HybridSearchPlugin(mockApp as unknown as App, mockManifest);
    plugin.loadData = vi.fn().mockResolvedValue({});
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.addCommand = vi.fn();
    plugin.addRibbonIcon = vi.fn();
    plugin.addSettingTab = vi.fn();
    plugin.registerView = vi.fn();
    plugin.registerEditorExtension = vi.fn();
    plugin.registerEditorSuggest = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    activeDocument.querySelectorAll(ALL_BODY_PANELS).forEach((el) => el.remove());
  });

  it('loads settings on onload', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
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

  it('refreshes endpoint-sensitive panes when HTTP endpoint changes', async () => {
    const { HttpSearchClient } = await import('../src/ipc');
    const similarRefresh = vi.spyOn(SimilarNotesBottomManager.prototype, 'refresh');
    const refreshFromActiveFile = vi.fn().mockResolvedValue(undefined);
    const workbenchView = Object.assign(Object.create(GraphWorkbenchView.prototype), {
      refreshFromActiveFile,
    }) as GraphWorkbenchView;
    (mockApp.workspace as { getLeavesOfType?: ReturnType<typeof vi.fn> }).getLeavesOfType = vi
      .fn()
      .mockReturnValue([{ view: workbenchView }]);
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
    options!.onStatusChange!({
      type: 'fallback-activated',
      from: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
      to: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
      reason: 'HTTP MCP request timed out',
    });
    await flushPromises();

    expect(similarRefresh).toHaveBeenCalledWith(true);
    expect(refreshFromActiveFile).toHaveBeenCalledWith(true);
    expect(
      (mockApp.workspace as unknown as { getLeavesOfType: ReturnType<typeof vi.fn> })
        .getLeavesOfType,
    ).toHaveBeenCalledWith('hybrid-search-graph-workbench');

    options!.onStatusChange!({
      type: 'primary-restored',
      from: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
      to: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
    });
    await flushPromises();

    expect(similarRefresh).toHaveBeenCalledTimes(2);
    expect(refreshFromActiveFile).toHaveBeenCalledTimes(2);
    similarRefresh.mockRestore();
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
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
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
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
    expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
      'search',
      'Hybrid search',
      expect.any(Function),
    );
  });

  it('adds settings tab', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
    expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
  });

  it('registers docked search panel view', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
    expect(plugin.registerView).toHaveBeenCalledWith('hybrid-search-panel', expect.any(Function));
  });

  it('registers docked graph workbench view', async () => {
    await plugin.onload();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
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

  it('onload removes stale body-level panels left by a previous plugin instance', async () => {
    for (const className of BODY_PANEL_CLASSES) {
      createBodyPanel(className, mockManifest.id);
    }
    expect(activeDocument.querySelectorAll(ALL_BODY_PANELS)).toHaveLength(
      BODY_PANEL_CLASSES.length,
    );

    await plugin.onload();

    expect(activeDocument.querySelectorAll(ALL_BODY_PANELS)).toHaveLength(0);
  });

  it('onload removes unstamped panels left by a version that predates the owner attribute', async () => {
    for (const className of BODY_PANEL_CLASSES) {
      createBodyPanel(className, undefined);
    }

    await plugin.onload();

    expect(activeDocument.querySelectorAll(ALL_BODY_PANELS)).toHaveLength(0);
  });

  it('onload leaves panels owned by a second copy of the plugin alone', async () => {
    for (const className of BODY_PANEL_CLASSES) {
      createBodyPanel(className, 'hybrid-search-beta');
    }

    await plugin.onload();

    expect(activeDocument.querySelectorAll(ALL_BODY_PANELS)).toHaveLength(
      BODY_PANEL_CLASSES.length,
    );
  });

  it('onunload leaves panels owned by a second copy of the plugin alone', async () => {
    vi.spyOn(SearchModal.prototype, 'open').mockImplementation(() => {
      createBodyPanel('ohs-graph-panel', mockManifest.id);
    });
    await plugin.onload();
    const foreign = createBodyPanel('hybrid-search-preview', 'hybrid-search-beta');
    const legacy = createBodyPanel('hybrid-search-preview', undefined);
    invokeCommand('open-search');
    expect(activeDocument.querySelectorAll('.ohs-graph-panel')).toHaveLength(1);

    plugin.onunload();

    expect(activeDocument.querySelectorAll('.ohs-graph-panel')).toHaveLength(0);
    expect(activeDocument.body.contains(foreign)).toBe(true);
    // Unstamped panels survive the unload sweep: at this point they can only be a live foreign one.
    expect(activeDocument.body.contains(legacy)).toBe(true);
  });

  it('passes its manifest id to the search modal so panels are stamped', async () => {
    const openSpy = vi.spyOn(SearchModal.prototype, 'open').mockImplementation(() => undefined);
    await plugin.onload();

    invokeCommand('open-search');

    const modal = openSpy.mock.instances[0] as unknown as { ownerId?: string };
    expect(modal.ownerId).toBe(mockManifest.id);
  });

  it('onunload closes every active search modal and removes their body-level panels', async () => {
    vi.spyOn(SearchModal.prototype, 'open').mockImplementation(() => {
      createBodyPanel('ohs-graph-panel', mockManifest.id);
    });
    const closeSpy = vi.spyOn(SearchModal.prototype, 'close');
    await plugin.onload();
    invokeCommand('open-search');
    invokeCommand('search-semantic');
    expect(activeDocument.querySelectorAll('.ohs-graph-panel')).toHaveLength(2);

    plugin.onunload();

    expect(closeSpy).toHaveBeenCalledTimes(2);
    expect(activeDocument.querySelectorAll(ALL_BODY_PANELS)).toHaveLength(0);
  });

  it('onunload continues closing modals and sweeping panels after one close fails', async () => {
    vi.spyOn(SearchModal.prototype, 'open').mockImplementation(() => {
      createBodyPanel('ohs-graph-panel', mockManifest.id);
    });
    let closeCount = 0;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const closeSpy = vi.spyOn(SearchModal.prototype, 'close').mockImplementation(() => {
      closeCount++;
      if (closeCount === 1) throw new Error('modal close failed');
    });
    await plugin.onload();
    invokeCommand('open-search');
    invokeCommand('search-semantic');

    expect(() => plugin.onunload()).not.toThrow();

    expect(closeSpy).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Hybrid search: failed to close search modal during plugin unload.',
      expect.objectContaining({ message: 'modal close failed' }),
    );
    expect(activeDocument.querySelectorAll(ALL_BODY_PANELS)).toHaveLength(0);
    expect(plugin.client!.dispose).toHaveBeenCalled();
  });

  it('saveSettings persists settings', async () => {
    await plugin.onload();
    plugin.settings.binaryPath = '/usr/bin/ohs';
    await plugin.saveSettings();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
    expect(plugin.saveData).toHaveBeenCalledWith(
      expect.objectContaining({ binaryPath: '/usr/bin/ohs' }),
    );
  });
});
