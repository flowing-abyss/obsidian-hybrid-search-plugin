import { TFile, WorkspaceLeaf } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SearchPanelView } from '../src/ui/SearchPanelView';

const result: SearchResult = {
  path: 'target.md',
  title: 'Target',
  score: 0.9,
  tags: [],
  aliases: [],
};

describe('SearchPanelView', () => {
  it('does not render stale search results after close', async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const app = {
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
        getLeaf: () => ({ openFile: vi.fn() }),
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const leaf = Object.assign(new WorkspaceLeaf(), { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn().mockReturnValue(searchPromise) },
    };
    const view = new SearchPanelView(leaf, plugin as never);
    await view.onOpen();

    const search = (view as unknown as { search: (query: string) => Promise<void> }).search;
    const pending = search.call(view, 'target');
    await view.onClose();
    resolveSearch([result]);
    await pending;

    expect(view.containerEl.textContent).not.toContain('Target');
  });

  it('opens panel results in a markdown leaf instead of the panel leaf', () => {
    const panelLeaf = new WorkspaceLeaf() as WorkspaceLeaf & { openFile: ReturnType<typeof vi.fn> };
    const markdownLeaf = {
      openFile: vi.fn().mockResolvedValue(undefined),
    };
    panelLeaf.openFile = vi.fn().mockResolvedValue(undefined);
    const file = Object.assign(new TFile(), { path: 'target.md' });
    const app = {
      workspace: {
        getLeavesOfType: () => [panelLeaf, markdownLeaf],
        getLeaf: () => ({ openFile: vi.fn() }),
      },
      vault: { getAbstractFileByPath: () => file },
    };
    Object.assign(panelLeaf, { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn() },
    };
    const view = new SearchPanelView(panelLeaf, plugin as never);

    (
      view as unknown as { openResultFromPanel: (path: string, newLeaf: boolean) => void }
    ).openResultFromPanel('target.md', false);

    expect(panelLeaf.openFile).not.toHaveBeenCalled();
    expect(markdownLeaf.openFile).toHaveBeenCalledWith(file);
  });

  it('colors relevance scores like the modal', async () => {
    const app = {
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
        getLeaf: () => ({ openFile: vi.fn() }),
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const leaf = Object.assign(new WorkspaceLeaf(), { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn().mockResolvedValue([result]) },
    };
    const view = new SearchPanelView(leaf, plugin as never);
    await view.onOpen();

    await (view as unknown as { search: (query: string) => Promise<void> }).search('target');

    const scoreEl = view.containerEl.querySelector<HTMLElement>('.hybrid-search-panel-score');
    expect(scoreEl?.style.color).toBe('rgb(76, 175, 80)');
  });

  it('shows a modal-style mode badge and passes selected panel mode to search', async () => {
    const search = vi.fn().mockResolvedValue([result]);
    const app = {
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
        getLeaf: () => ({ openFile: vi.fn() }),
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const leaf = Object.assign(new WorkspaceLeaf(), { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, defaultMode: 'hybrid' as const },
      client: { search },
    };
    const view = new SearchPanelView(leaf, plugin as never);
    await view.onOpen();

    expect(view.containerEl.querySelector('.hybrid-search-panel-mode-badge')?.textContent).toBe(
      'H',
    );
    view.setMode('title');
    await (view as unknown as { search: (query: string) => Promise<void> }).search('target');

    expect(view.containerEl.querySelector('.hybrid-search-panel-mode-badge')?.textContent).toBe(
      'T',
    );
    expect(search).toHaveBeenLastCalledWith('target', expect.objectContaining({ mode: 'title' }));
  });

  it('query mode operators override the selected panel mode in the badge and search options', async () => {
    const search = vi.fn().mockResolvedValue([result]);
    const app = {
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
        getLeaf: () => ({ openFile: vi.fn() }),
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const leaf = Object.assign(new WorkspaceLeaf(), { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, defaultMode: 'hybrid' as const },
      client: { search },
    };
    const view = new SearchPanelView(leaf, plugin as never);
    await view.onOpen();
    view.setMode('title');

    await (view as unknown as { search: (query: string) => Promise<void> }).search(
      'semantic: target',
    );

    expect(view.containerEl.querySelector('.hybrid-search-panel-mode-badge')?.textContent).toBe(
      'S',
    );
    expect(search).toHaveBeenLastCalledWith(
      'target',
      expect.objectContaining({ mode: 'semantic' }),
    );
  });

  it('triggers Obsidian hover preview for panel links', async () => {
    const trigger = vi.fn();
    const app = {
      workspace: {
        getActiveFile: () => ({ path: 'source.md' }),
        getLeavesOfType: () => [],
        getLeaf: () => ({ openFile: vi.fn() }),
        trigger,
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null },
    };
    const leaf = Object.assign(new WorkspaceLeaf(), { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn().mockResolvedValue([result]) },
    };
    const view = new SearchPanelView(leaf, plugin as never);
    await view.onOpen();
    await (view as unknown as { search: (query: string) => Promise<void> }).search('target');

    view.containerEl
      .querySelector<HTMLElement>('a.hybrid-search-panel-link')
      ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));

    expect(trigger).toHaveBeenCalledWith(
      'hover-link',
      expect.objectContaining({
        linktext: 'target',
        sourcePath: 'source.md',
      }),
    );
  });

  it('supports modal-style navigation, open, and insert hotkeys in the panel', async () => {
    const secondResult: SearchResult = {
      ...result,
      path: 'second.md',
      title: 'Second',
      score: 0.8,
    };
    const opened: TFile[] = [];
    const replaceRange = vi.fn();
    const app = {
      workspace: {
        activeEditor: { editor: { replaceRange, getCursor: () => ({ line: 1, ch: 2 }) } },
        getActiveFile: () => ({ path: 'source.md' }),
        getLeavesOfType: () => [],
        getLeaf: () => ({ openFile: vi.fn((file: TFile) => opened.push(file)) }),
      },
      vault: {
        getAbstractFileByPath: (path: string) => Object.assign(new TFile(), { path }),
      },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: (_linkpath: string, path: string) =>
          Object.assign(new TFile(), { path }),
        fileToLinktext: (file: TFile) => file.path.replace(/\.md$/, ''),
      },
    };
    const leaf = Object.assign(new WorkspaceLeaf(), { app });
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn().mockResolvedValue([result, secondResult]) },
    };
    const view = new SearchPanelView(leaf, plugin as never);
    await view.onOpen();
    await (view as unknown as { search: (query: string) => Promise<void> }).search('target');

    const input = view.containerEl.querySelector<HTMLInputElement>('.hybrid-search-panel-input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }),
    );
    expect(replaceRange).toHaveBeenCalledWith('[[second]]', { line: 1, ch: 2 });

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true }));
    expect(opened.map((file) => file.path)).toContain('target.md');

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, shiftKey: true, bubbles: true }),
    );
    expect(replaceRange).toHaveBeenLastCalledWith('[[target]]\n[[second]]', { line: 1, ch: 2 });
  });
});
