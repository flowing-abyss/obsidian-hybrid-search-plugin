import { MarkdownRenderer, MarkdownView } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/search/contracts';
import { fetchSimilarNotesDetailed } from '../src/search/similarNotes';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { PANEL_OWNER_ATTR } from '../src/ui/shared/strayPanels';
import { SimilarNotesBottomManager } from '../src/ui/similar/SimilarNotesBottom';
import { createApp, createFile, createLeaf } from './support/obsidian';

const result: SearchResult = {
  path: 'related.md',
  title: 'Related',
  score: 0.8,
  snippet: 'Relevant context from the related note.',
  tags: [],
  aliases: [],
};

function footerFixture(mode: 'source' | 'preview', backlinks: boolean, earlyAddon = false) {
  const app = createApp({ 'source.md': '', 'related.md': '' });
  const leaf = createLeaf(app);
  const view = new MarkdownView(leaf);
  view.file = app.vault.getFileByPath('source.md');
  leaf.view = view;
  const getMode = vi.spyOn(view, 'getMode').mockReturnValue(mode);
  activeDocument.body.appendChild(view.containerEl);
  const root = view.contentEl.createDiv({
    cls: mode === 'source' ? 'markdown-source-view' : 'markdown-preview-view',
  });
  const sizer = root.createDiv({ cls: mode === 'source' ? 'cm-sizer' : 'markdown-preview-sizer' });
  const content = sizer.createDiv({ cls: mode === 'source' ? 'cm-contentContainer' : 'el-p' });
  const footer = mode === 'source' ? sizer : sizer.createDiv({ cls: 'mod-footer' });
  const addon = createDiv({ cls: 'external-note-addon' });
  if (earlyAddon) footer.appendChild(addon);
  const backlinkEl = backlinks ? footer.createDiv({ cls: 'embedded-backlinks' }) : null;
  vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([leaf]);
  const search = vi.fn().mockResolvedValue([result]);
  const manager = new SimilarNotesBottomManager(app, {
    app,
    manifest: { id: 'hybrid-search' },
    settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
    client: { search },
  } as never);
  return { app, leaf, view, getMode, root, sizer, content, footer, addon, backlinkEl, manager };
}

describe('Similar notes footer placement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    activeDocument.body.empty();
  });

  it.each([
    ['source', true, true],
    ['source', true, false],
    ['source', false, true],
    ['source', false, false],
    ['preview', true, true],
    ['preview', true, false],
    ['preview', false, true],
    ['preview', false, false],
  ] as const)(
    'retains footer order in %s, backlinks %s, early addon %s',
    async (mode, backlinks, early) => {
      const f = footerFixture(mode, backlinks, early);
      f.manager.load();
      await vi.advanceTimersByTimeAsync(150);
      const panel = f.footer.querySelector<HTMLElement>('.hybrid-search-similar-bottom')!;
      if (!early) f.footer.insertBefore(f.addon, f.backlinkEl);
      const expected = [
        ...(mode === 'source' ? [f.content] : []),
        panel,
        f.addon,
        ...(f.backlinkEl ? [f.backlinkEl] : []),
      ];
      expect(panel).not.toBeNull();
      expect([...f.footer.children]).toEqual(expected);
      const row = panel.querySelector('.search-result-file-title');
      const mutations: MutationRecord[] = [];
      const observer = new MutationObserver((records) => mutations.push(...records));
      observer.observe(f.footer, { childList: true });
      f.app.workspace.trigger('active-leaf-change', f.leaf);
      f.app.workspace.trigger('layout-change');
      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(10_000);

      expect([...f.footer.children]).toEqual(expected);
      expect(panel.querySelector('.search-result-file-title')).toBe(row);
      expect(mutations).toHaveLength(0);
      observer.disconnect();
      f.manager.unload();
    },
  );

  it('uses the active mode and reattaches the same panel when its host is replaced', async () => {
    const f = footerFixture('preview', true, true);
    const editorRoot = createDiv({ cls: 'markdown-source-view' });
    f.view.contentEl.prepend(editorRoot);
    const editorSizer = editorRoot.createDiv({ cls: 'cm-sizer' });
    const editorContent = editorSizer.createDiv({ cls: 'cm-contentContainer' });
    const editorBacklinks = editorSizer.createDiv({ cls: 'embedded-backlinks' });
    f.manager.load();
    await vi.advanceTimersByTimeAsync(150);
    const panel = f.footer.querySelector('.hybrid-search-similar-bottom');
    expect(panel).not.toBeNull();
    const row = panel!.querySelector('.search-result-file-title');

    f.getMode.mockReturnValue('source');
    f.app.workspace.trigger('layout-change');
    await vi.advanceTimersByTimeAsync(150);
    expect([...editorSizer.children]).toEqual([editorContent, panel, editorBacklinks]);
    editorSizer.remove();
    const replacement = editorRoot.createDiv({ cls: 'cm-sizer' });
    const replacementContent = replacement.createDiv({ cls: 'cm-contentContainer' });
    const addon = replacement.createDiv({ cls: 'external-note-addon' });
    f.app.workspace.trigger('layout-change');
    await vi.advanceTimersByTimeAsync(150);

    expect([...replacement.children]).toEqual([replacementContent, panel, addon]);
    expect(panel!.querySelector('.search-result-file-title')).toBe(row);
    expect(f.view.containerEl.querySelectorAll('.hybrid-search-similar-bottom')).toHaveLength(1);
    f.manager.unload();
  });

  it.each(['source', 'preview'] as const)(
    'keeps the %s panel outside embedded notes and hidden mode hosts',
    async (mode) => {
      const f = footerFixture(mode, true, true);
      let editorRoot = f.root;
      if (mode === 'preview') {
        editorRoot = createDiv({ cls: 'markdown-source-view' });
        f.view.contentEl.prepend(editorRoot);
      }
      const editorContent =
        editorRoot.querySelector('.cm-contentContainer') ??
        editorRoot.createDiv({ cls: 'cm-sizer' }).createDiv({ cls: 'cm-contentContainer' });
      const embed = editorContent.createDiv({ cls: 'markdown-embed' });
      const embeddedSizer = embed
        .createDiv({ cls: 'markdown-preview-view' })
        .createDiv({ cls: 'markdown-preview-sizer' });
      const embeddedFooter = embeddedSizer.createDiv({ cls: 'mod-footer' });
      embeddedFooter.createDiv({ cls: 'embedded-backlinks' });
      f.manager.load();
      await vi.advanceTimersByTimeAsync(150);

      expect(embed.querySelector('.hybrid-search-similar-bottom')).toBeNull();
      expect(f.footer.querySelector('.hybrid-search-similar-bottom')).not.toBeNull();
      expect(f.footer.querySelector('.hybrid-search-similar-bottom')!.nextElementSibling).toBe(
        f.addon,
      );
      f.manager.unload();
    },
  );
});

describe('SimilarNotesBottomManager', () => {
  beforeEach(() => {
    vi.spyOn(MarkdownRenderer, 'render');
  });
  it('unloads every registered view and clears the registry when one view fails', () => {
    const app = { workspace: { offref: vi.fn() } };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      manifest: { id: 'hybrid-search' },
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);
    const internals = manager as unknown as {
      views: Map<MarkdownView, { unload: () => void }>;
    };
    const failure = new Error('first view unload failed');
    const secondUnload = vi.fn();
    internals.views.set(new MarkdownView(createLeaf()), {
      unload: vi.fn(() => {
        throw failure;
      }),
    });
    internals.views.set(new MarkdownView(createLeaf()), { unload: secondUnload });

    expect(() => manager.unload()).toThrow(failure);

    expect(secondUnload).toHaveBeenCalledOnce();
    expect(internals.views).toHaveLength(0);
  });

  it('invalidates an in-flight result before removing its view', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;
    let resolveSearch!: (results: SearchResult[]) => void;
    const searchPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger: vi.fn(),
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockReturnValue(searchPromise) },
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    const detachedPanel = markdownView.containerEl.querySelector<HTMLElement>(
      '.hybrid-search-similar-bottom',
    )!;
    manager.unload();
    resolveSearch([result]);
    await Promise.resolve();
    await Promise.resolve();

    expect(detachedPanel.isConnected).toBe(false);
    expect(detachedPanel.textContent).not.toContain('Related');
    vi.useRealTimers();
  });

  it('settingsChanged forces reload for the same note', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const wrapper = createDiv();
    const backlinks = createDiv();
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
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(createFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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

  it('refresh forces reload for the same note', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const search = vi.fn().mockResolvedValue([result]);
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger: vi.fn(),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(createFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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

    manager.refresh(true);
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(search).toHaveBeenCalledTimes(2);
    manager.unload();
    vi.useRealTimers();
  });

  it('keeps a forced refresh when a normal refresh is queued before debounce fires', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const layoutCallbacks: Array<() => void> = [];
    const search = vi.fn().mockResolvedValue([result]);
    const app = {
      workspace: {
        on: vi.fn().mockImplementation((eventName: string, callback: () => void) => {
          if (eventName === 'layout-change') layoutCallbacks.push(callback);
          return {};
        }),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger: vi.fn(),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(createFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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

    manager.refresh(true);
    layoutCallbacks[0]!();
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(search).toHaveBeenCalledTimes(2);
    manager.unload();
    vi.useRealTimers();
  });

  it('attaches to the markdown body when embedded backlinks are not present', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => ({ frontmatter: { type: 'daily' } }) },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => ({ frontmatter: { type: 'daily' } }) },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => ({ frontmatter: { type: 'daily' } }) },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
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
        getAbstractFileByPath: (path: string) => Object.assign(createFile(), { path }),
      },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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

  it('preserves last successful results through a silent polling failure and recovery', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const search = vi
      .fn()
      .mockResolvedValueOnce([result])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([result]);
    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: {
        getAbstractFileByPath: (path: string) => Object.assign(createFile(), { path }),
      },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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

    expect(sizer.textContent).toContain('Related');
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(3);
    expect(sizer.textContent).toContain('Related');
    manager.unload();
    vi.useRealTimers();
  });

  it('collapses and expands the whole section when the title is clicked', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    expect(resultsEl?.style.display !== 'none').toBe(false);
    sizer.querySelector<HTMLElement>('.hybrid-search-similar-title-wrap')?.click();
    expect(resultsEl?.style.display !== 'none').toBe(true);
    manager.unload();
    vi.useRealTimers();
  });

  it('opens the filter row when the search toolbar button is clicked', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
      },
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: { getCache: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    expect(searchRow?.style.display !== 'none').toBe(true);
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
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
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
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(createFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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
    const link = sizer.querySelector<HTMLElement>('.hybrid-search-similar-note-link');
    link?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));
    link?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));

    expect(trigger).toHaveBeenCalledWith(
      'hover-link',
      expect.objectContaining({
        linktext: 'related',
        sourcePath: 'source.md',
      }),
    );
    expect(trigger.mock.calls[0]![1].hoverParent).toBe(trigger.mock.calls[1]![1].hoverParent);
    manager.unload();
    vi.useRealTimers();
  });

  it('opens similar note links in a background tab on Mod-click', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
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
      vault: { getAbstractFileByPath: () => Object.assign(createFile(), { path: 'related.md' }) },
      metadataCache: {
        getCache: () => null,
        getFirstLinkpathDest: () => Object.assign(createFile(), { path: 'related.md' }),
      },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
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

  it('still queries without filters after the @similar work', async () => {
    const search = vi.fn().mockResolvedValue([]);
    await fetchSimilarNotesDetailed({ search }, 'Now/Today.md', { limit: 5, threshold: 0 });

    const options = search.mock.calls[0]![1];
    expect(options.notePath).toBe('Now/Today.md');
    expect(options.tag).toBeUndefined();
    expect(options.scope).toBeUndefined();
    expect(options.frontmatter).toBeUndefined();
  });

  it('stamps the bottom panel with the plugin id so a stranded one can be swept', async () => {
    vi.useFakeTimers();
    const leaf = createLeaf();
    const markdownView = new MarkdownView(leaf);
    markdownView.file = Object.assign(createFile(), { path: 'source.md', extension: 'md' });
    const sizer = createDiv();
    sizer.className = 'markdown-preview-sizer';
    markdownView.containerEl.appendChild(sizer);
    leaf.view = markdownView;

    const app = {
      workspace: {
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([leaf]),
        trigger: vi.fn(),
      },
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search-beta' },
      app,
      settings: { ...DEFAULT_SETTINGS, showSimilarNotesAtBottom: true },
      client: { search: vi.fn().mockResolvedValue([]) },
    };
    const manager = new SimilarNotesBottomManager(app as never, plugin as never);

    manager.load();
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    const panel = markdownView.containerEl.querySelector('.hybrid-search-similar-bottom');
    expect(panel?.getAttribute(PANEL_OWNER_ATTR)).toBe('hybrid-search-beta');
    manager.unload();
    vi.useRealTimers();
  });
});
