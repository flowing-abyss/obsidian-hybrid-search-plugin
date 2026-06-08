import { MarkdownRenderer, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SimilarNotesBottomManager } from '../src/ui/SimilarNotesBottom';

const result: SearchResult = {
  path: 'related.md',
  title: 'Related',
  score: 0.8,
  snippet: 'Relevant context from the related note.',
  tags: [],
  aliases: [],
};

describe('SimilarNotesBottomManager', () => {
  it('settingsChanged forces reload for the same note', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const wrapper = activeDocument.createDiv();
    const backlinks = activeDocument.createDiv();
    backlinks.className = 'embedded-backlinks';
    wrapper.appendChild(backlinks);
    markdownView.containerEl.appendChild(wrapper);
    leaf.view = markdownView;

    const search = vi.fn().mockResolvedValue([result]);
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger: vi.fn(),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(new TFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      app,
      settings: {
        ...DEFAULT_SETTINGS,
        showSimilarNotesAtBottom: true,
        similarNotesBottomLimit: 5,
      },
      client: { search },
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(1);

    plugin.settings.similarNotesBottomLimit = 8;
    manager.settingsChanged();
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(search).toHaveBeenCalledTimes(2);
    manager.unload();
    vi.useRealTimers();
  });

  it('attaches to the markdown body when embedded backlinks are not present', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => ({ frontmatter: { type: 'daily' } }) },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(sizer.querySelector('.hybrid-search-similar-bottom')).toBeTruthy();
    manager.unload();
    vi.useRealTimers();
  });

  it('renders result snippets collapsed by default and expands a single result', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => ({ frontmatter: { type: 'daily' } }) },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    expect(sizer.querySelector('.search-result-file-matches')).toBeNull();
    sizer.querySelector<HTMLElement>('.search-result-file-title .collapse-icon')?.click();
    const matches = sizer.querySelector<HTMLElement>('.search-result-file-matches');
    expect(matches).toBeTruthy();
    expect(matches?.classList.contains('is-collapsed')).toBe(false);
    expect(sizer.querySelector('.search-result-file-match')?.textContent).toBe(result.snippet);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to call unbound
    expect(vi.mocked(MarkdownRenderer.render)).not.toHaveBeenCalled();
    manager.unload();
    vi.useRealTimers();
  });

  it('renders the section title without a collapse icon', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    const title = sizer.querySelector<HTMLElement>('.hybrid-search-similar-title-wrap');
    expect(title?.classList.contains('tree-item-self')).toBe(true);
    expect(title?.querySelector('.tree-item-icon.collapse-icon')).toBeNull();
    expect(title?.querySelector('.tree-item-inner')?.textContent).toBe('Similar notes');
    expect(title?.querySelector('.tree-item-flair')?.textContent).toBe('1');
    manager.unload();
    vi.useRealTimers();
  });

  it('uses tree item title classes without search-result row separators or duplicated Supercharged data', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => ({ frontmatter: { type: 'daily' } }) },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    const row = sizer.querySelector<HTMLElement>('.hybrid-search-similar-result');
    const title = sizer.querySelector<HTMLElement>('.search-result-file-title');
    const link = sizer.querySelector<HTMLElement>('.hybrid-search-similar-note-link');
    expect(row?.classList.contains('search-result')).toBe(false);
    expect(title?.classList.contains('tree-item-self')).toBe(true);
    expect(title?.classList.contains('mod-collapsible')).toBe(false);
    expect(title?.hasAttribute('data-link-type')).toBe(false);
    expect(link?.tagName).toBe('DIV');
    expect(link?.classList.contains('tree-item-inner')).toBe(true);
    expect(link?.getAttribute('data-link-type')).toBe('daily');
    manager.unload();
    vi.useRealTimers();
  });

  it('refreshes visible similar notes periodically for delayed embedding updates', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const search = vi
      .fn()
      .mockResolvedValueOnce([result])
      .mockResolvedValueOnce([{ ...result, path: 'updated.md', title: 'Updated' }]);
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: {
        getAbstractFileByPath: (path: string) => Object.assign(new TFile(), { path }),
      },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    expect(sizer.textContent).toContain('Related');

    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(search).toHaveBeenCalledTimes(2);
    expect(sizer.textContent).toContain('Updated');
    manager.unload();
    vi.useRealTimers();
  });

  it('collapses and expands the whole section when the title is clicked', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    const resultsEl = sizer.querySelector<HTMLElement>('.search-result-container');
    sizer.querySelector<HTMLElement>('.hybrid-search-similar-title-wrap')?.click();
    expect(resultsEl?.isShown()).toBe(false);
    sizer.querySelector<HTMLElement>('.hybrid-search-similar-title-wrap')?.click();
    expect(resultsEl?.isShown()).toBe(true);
    manager.unload();
    vi.useRealTimers();
  });

  it('opens the filter row when the search toolbar button is clicked', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    const searchRow = sizer.querySelector<HTMLElement>('.hybrid-search-similar-search');
    expect(searchRow?.classList.contains('is-hidden')).toBe(true);
    sizer.querySelectorAll<HTMLElement>('.hybrid-search-similar-toolbar-btn')[1]?.click();
    expect(searchRow?.classList.contains('is-hidden')).toBe(false);
    expect(searchRow?.isShown()).toBe(true);
    const resultsEl = sizer.querySelector<HTMLElement>('.search-result-container');
    expect(searchRow).toBeTruthy();
    expect(resultsEl).toBeTruthy();
    expect(
      searchRow!.compareDocumentPosition(resultsEl!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    manager.unload();
    vi.useRealTimers();
  });

  it('triggers Obsidian hover preview for similar note links', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const trigger = vi.fn();
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger,
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(new TFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    sizer
      .querySelector<HTMLElement>('.hybrid-search-similar-note-link')
      ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));

    expect(trigger).toHaveBeenCalledWith(
      'hover-link',
      expect.objectContaining({
        linktext: 'related',
        sourcePath: 'source.md',
      }),
    );
    manager.unload();
    vi.useRealTimers();
  });

  it('opens similar note links in a background tab on Mod-click', async () => {
    vi.useFakeTimers();
    const leaf = new WorkspaceLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(new TFile(), { path: 'source.md', extension: 'md' });
    const sizer = activeDocument.createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const openFile = vi.fn();
    const trigger = vi.fn();
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger,
        getLeaf: vi.fn().mockReturnValue({ openFile }),
      },
      vault: { getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(new TFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([result]) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    sizer
      .querySelector<HTMLElement>('.hybrid-search-similar-note-link')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));

    expect(trigger).not.toHaveBeenCalledWith('hover-link', expect.anything());
    expect(app.workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'related.md' }), {
      active: false,
    });
    manager.unload();
    vi.useRealTimers();
  });
});
