import { App, MarkdownView, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeNoteTextStats } from '../src/search/noteStats';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { GraphWorkbenchView } from '../src/ui/graph/GraphWorkbenchView';
import { createApp, createFile, createLeaf } from './support/obsidian';

function result(path: string, score: number) {
  return {
    path,
    title: path.replace('.md', ''),
    score,
    tags: [],
    aliases: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeApp() {
  const app = createApp({ 'A.md': '', 'Backlink.md': '', 'Linked.md': '' });
  app.metadataCache.resolvedLinks = {
    'A.md': { 'Linked.md': 1 },
    'Backlink.md': { 'A.md': 1 },
  };
  app.metadataCache.getCache = (path: string) => ({
    frontmatter: { title: path.replace('.md', '') },
  });
  (app.vault as unknown as { cachedRead: ReturnType<typeof vi.fn> }).cachedRead = vi
    .fn()
    .mockResolvedValue('');
  return app;
}

function makeView(app: App, client: { search: ReturnType<typeof vi.fn> }) {
  const leaf = createLeaf(app);
  const plugin = {
    app,
    client,
    manifest: { id: 'hybrid-search' },
    settings: { ...DEFAULT_SETTINGS, similarNotesBottomLimit: 8 },
    saveSettings: vi.fn(),
  };
  return new GraphWorkbenchView(leaf, plugin as never);
}

describe('GraphWorkbenchView', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    activeDocument.body.empty();
  });

  it('renders an empty state when no note is active', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi.fn().mockReturnValue(null);
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();

    expect(view.containerEl.querySelector('.ohs-workbench-title')).toBeNull();
    expect(view.containerEl.querySelector('.ohs-workbench-svg')).toBeNull();
  });

  it('renders a single panel with one action-tab layer', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([result('Similar.md', 0.91)]);
        return Promise.resolve([result('Linked.md', 0.5)]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();

    expect(view.containerEl.querySelector('.hybrid-search-graph-workbench')).not.toBeNull();
    expect(
      Array.from(view.containerEl.querySelectorAll('.ohs-workbench-tab')).map(
        (tab) => tab.querySelector('.ohs-workbench-tab-label')?.textContent,
      ),
    ).toEqual(['Best', 'Missing', 'Bridges', 'Similar', 'Links', 'Statistics']);
    expect(view.containerEl.querySelector('.ohs-workbench-graph-context')?.textContent).toContain(
      'Best connection map',
    );
    expect(view.containerEl.querySelectorAll('.ohs-workbench-tab-icon')).toHaveLength(6);
    expect(
      Array.from(view.containerEl.querySelectorAll('.ohs-workbench-node')).map((node) =>
        node.getAttribute('data-path'),
      ),
    ).toContain('Similar.md');
  });

  it('keeps result snippets collapsed until the disclosure icon is selected', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) {
          return Promise.resolve([{ ...result('Similar.md', 0.91), snippet: 'hidden snippet' }]);
        }
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[3]!
      .click();

    expect(view.containerEl.querySelector('.ohs-workbench-row-meta')).toBeNull();
    expect(view.containerEl.querySelector('.ohs-workbench-evidence-line')?.textContent).toContain(
      'semantic',
    );
    expect(view.containerEl.querySelector('.ohs-workbench-reason-line')).toBeNull();
    view.containerEl.querySelector<HTMLElement>('.ohs-workbench-collapse')!.click();
    expect(view.containerEl.querySelector('.ohs-workbench-row-meta')?.textContent).toContain(
      'hidden snippet',
    );
  });

  it('expands the anchored passage instead of an unrelated snippet', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi.fn().mockReturnValue(createFile('A.md'));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) =>
        Promise.resolve(
          options.notePath
            ? [
                {
                  ...result('Similar.md', 0.91),
                  snippet: 'Unrelated introduction.',
                  previewAnchors: [
                    {
                      kind: 'semantic',
                      headingPath: 'Useful section',
                      matchText: 'The passage that actually matched.',
                      charStart: null,
                      charEnd: null,
                    },
                  ],
                  primaryAnchorIndex: 0,
                },
              ]
            : [],
        ),
      ),
    };
    const view = makeView(app, client);
    await view.onOpen();
    view.containerEl.querySelector<HTMLElement>('.ohs-workbench-collapse')!.click();
    const excerpt = view.containerEl.querySelector('.ohs-workbench-snippet')!;
    expect(excerpt.textContent).toContain('The passage that actually matched.');
    expect(excerpt.textContent).not.toContain('Unrelated introduction.');
  });

  it('restores the same Best rows, expansion and scroll after using selected text', async () => {
    vi.useFakeTimers();
    const app = makeApp();
    const source = new MarkdownView(createLeaf(app));
    source.file = app.vault.getFileByPath('A.md');
    source.editor.setValue('A selected idea.');
    source.contentEl.createDiv({ text: 'A selected idea.' });
    activeDocument.body.appendChild(source.containerEl);
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(source);
    app.workspace.getActiveFile = vi.fn().mockReturnValue(source.file);
    const client = {
      search: vi.fn().mockResolvedValue([
        {
          ...result('Similar.md', 0.91),
          snippet: 'A matching idea.',
        },
      ]),
    };
    const view = makeView(app, client);
    vi.spyOn(view.contentEl, 'isShown').mockReturnValue(true);
    await view.onOpen();
    const details = view.containerEl.querySelector<HTMLElement>('.ohs-workbench-details')!;
    const row = details.querySelector<HTMLElement>('.ohs-workbench-result')!;
    row.querySelector<HTMLElement>('.ohs-workbench-collapse')!.click();
    const expandedRow = details.querySelector('.ohs-workbench-result');
    const graph = view.containerEl.querySelector<HTMLElement>('.ohs-workbench-graph')!;
    const graphChild = graph.firstElementChild;
    const graphHeader = view.containerEl.querySelector('.ohs-workbench-graph-context')!;
    const headerText = graphHeader.textContent;
    details.scrollTop = 120;
    source.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 16 });
    const range = activeDocument.createRange();
    range.selectNodeContents(source.contentEl);
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.getSelection()!.addRange(range);
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(300);
    expect(details.hidden).toBe(true);
    expect(graph.hidden).toBe(false);
    expect(graph.firstElementChild).toBe(graphChild);
    expect(graphHeader.textContent).toBe(headerText);
    expect(view.containerEl.querySelector('.ohs-workbench-selection-label')?.textContent).toBe(
      'Selected text',
    );
    expect(view.containerEl.querySelector('.ohs-workbench-selection-result')).not.toBeNull();
    view.containerEl
      .querySelector<HTMLElement>('.ohs-workbench-selection .ohs-workbench-link')!
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));
    expect(app.workspace.trigger).toHaveBeenCalledWith(
      'hover-link',
      expect.objectContaining({
        source: 'hybrid-search-graph-workbench',
        sourcePath: 'A.md',
      }),
    );
    client.search.mockClear();
    view.containerEl.querySelector<HTMLButtonElement>('.ohs-workbench-topbar button')!.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.search.mock.calls.some(([, options]) => options?.notePath === 'A.md')).toBe(true);
    expect(client.search.mock.calls.some(([query]) => query === 'A selected idea.')).toBe(true);
    expect(graph.hidden).toBe(false);
    expect(graph.firstElementChild).toBe(graphChild);
    expect(details.hidden).toBe(true);
    expect(view.containerEl.querySelector('.ohs-workbench-selection-result')).not.toBeNull();
    view.containerEl.querySelector<HTMLButtonElement>('.ohs-workbench-selection-reset')!.click();
    expect(details.hidden).toBe(false);
    expect(details.querySelector('.ohs-workbench-result')).toBe(expandedRow);
    expect(details.querySelector('.ohs-workbench-snippet')).not.toBeNull();
    expect(details.scrollTop).toBe(120);
    expect(graph.hidden).toBe(false);
    expect(graph.firstElementChild).toBe(graphChild);

    await view.onClose();
    activeDocument.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it('cross-highlights matching graph nodes and list rows on hover', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([result('Similar.md', 0.91)]);
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    const graphNode = view.containerEl.querySelector<HTMLElement>(
      '.ohs-workbench-graph .ohs-workbench-node-item[data-path="Similar.md"]',
    )!;
    const resultRow = view.containerEl.querySelector<HTMLElement>(
      '.ohs-workbench-details .ohs-workbench-result[data-path="Similar.md"]',
    )!;

    graphNode.dispatchEvent(new MouseEvent('mouseenter'));
    expect(resultRow.classList.contains('is-path-hovered')).toBe(true);
    graphNode.dispatchEvent(new MouseEvent('mouseleave'));
    expect(resultRow.classList.contains('is-path-hovered')).toBe(false);

    resultRow.dispatchEvent(new MouseEvent('mouseenter'));
    expect(graphNode.classList.contains('is-path-hovered')).toBe(true);
    resultRow.dispatchEvent(new MouseEvent('mouseleave'));
    expect(graphNode.classList.contains('is-path-hovered')).toBe(false);
  });

  it('cancels delayed selection-result navigation when the scope is reset', async () => {
    vi.useFakeTimers();
    const app = createApp({ 'A.md': 'First idea.', 'B.md': 'matching passage' });
    const source = new MarkdownView(createLeaf(app));
    source.file = app.vault.getFileByPath('A.md');
    source.editor.setValue('First idea.');
    source.contentEl.createDiv({ text: 'First idea.' });
    activeDocument.body.appendChild(source.containerEl);
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(source);
    app.workspace.getActiveFile = vi.fn().mockReturnValue(source.file);
    const client = {
      search: vi.fn().mockResolvedValue([
        {
          ...result('B.md', 0.9),
          previewAnchors: [
            {
              kind: 'semantic',
              headingPath: null,
              matchText: 'matching passage',
              charStart: null,
              charEnd: null,
            },
          ],
        },
      ]),
    };
    const view = makeView(app, client);
    vi.spyOn(view.contentEl, 'isShown').mockReturnValue(true);
    await view.onOpen();
    source.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 11 });
    const range = activeDocument.createRange();
    range.selectNodeContents(source.contentEl);
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.getSelection()!.addRange(range);
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(300);
    const read = deferred<string>();
    vi.spyOn(app.vault, 'cachedRead').mockReturnValue(read.promise);
    const target = createLeaf(app);
    const open = vi.spyOn(target, 'openFile').mockResolvedValue(undefined);
    vi.mocked(app.workspace.getLeaf).mockReturnValue(target);
    view.containerEl
      .querySelector<HTMLElement>('.ohs-workbench-selection .ohs-workbench-link')!
      .click();
    view.containerEl.querySelector<HTMLButtonElement>('.ohs-workbench-selection-reset')!.click();
    read.resolve('matching passage');
    await vi.advanceTimersByTimeAsync(1);
    await view.onClose();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens co-citation sources with native link actions and keeps evidence distinct', async () => {
    const app = createApp({
      'A.md': '',
      'B.md': '',
      'Source 1.md': '',
      'Source 2.md': '',
      'Source 3.md': '',
      'Source 4.md': '',
      'Source 5.md': '',
    });
    app.workspace.getActiveFile = vi.fn().mockReturnValue(app.vault.getFileByPath('A.md'));
    app.metadataCache.resolvedLinks = {
      'Source 1.md': { 'A.md': 1, 'B.md': 1 },
      'Source 2.md': { 'A.md': 1, 'B.md': 1 },
      'Source 3.md': { 'A.md': 1, 'B.md': 1 },
      'Source 4.md': { 'A.md': 1, 'B.md': 1 },
      'Source 5.md': { 'A.md': 1, 'B.md': 1 },
    };
    const view = makeView(app, {
      search: vi
        .fn()
        .mockImplementation((_query, options) =>
          Promise.resolve(
            options.notePath
              ? [{ ...result('B.md', 0.71), scores: { semantic: 0.71, bm25: 0.32 } }]
              : [],
          ),
        ),
    });
    const target = createLeaf(app);
    const open = vi.spyOn(target, 'openFile').mockResolvedValue(undefined);
    vi.mocked(app.workspace.getLeaf).mockReturnValue(target);
    await view.onOpen();
    view.containerEl.querySelectorAll<HTMLButtonElement>('.ohs-workbench-tab')[3]!.click();
    view.containerEl.querySelector<HTMLElement>('.ohs-workbench-collapse')!.click();
    const metrics = view.containerEl.querySelector<HTMLElement>('.ohs-workbench-expanded-metrics')!;
    const links = metrics.querySelectorAll<HTMLAnchorElement>('a.internal-link');

    expect(links).toHaveLength(4);
    expect(metrics.textContent).toContain('4 of 5 shown');
    expect(metrics.textContent).toContain('Semantic similarity 0.71');
    expect(metrics.textContent).not.toContain('semantic 0.71');
    expect(metrics.textContent).toContain('fulltext 0.32');
    expect(metrics.textContent).not.toContain('. ·');
    expect(metrics.querySelectorAll('.ohs-workbench-evidence-group').length).toBeGreaterThan(1);

    links[0]!.click();
    expect(open).toHaveBeenLastCalledWith(app.vault.getFileByPath('Source 1.md'));
    links[1]!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
    );
    expect(app.workspace.getLeaf).toHaveBeenLastCalledWith('tab');
    expect(open).toHaveBeenLastCalledWith(app.vault.getFileByPath('Source 2.md'), {
      active: false,
    });
    links[2]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));
    expect(app.workspace.trigger).toHaveBeenCalledWith(
      'hover-link',
      expect.objectContaining({ linktext: 'Source 3', sourcePath: 'A.md' }),
    );
    await view.onClose();
  });

  it('renders backlink mention context when a linked note is expanded', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    app.metadataCache.resolvedLinks = {
      'Backlink.md': { 'A.md': 1 },
    };
    (
      app.metadataCache as unknown as {
        getFileCache: (file: TFile) => {
          links?: Array<{
            link: string;
            position: {
              start: { line: number; col: number; offset: number };
              end: { line: number; col: number; offset: number };
            };
          }>;
        };
      }
    ).getFileCache = (file: TFile) =>
      file.path === 'Backlink.md'
        ? {
            links: [
              {
                link: 'A',
                position: {
                  start: { line: 1, col: 16, offset: 22 },
                  end: { line: 1, col: 21, offset: 27 },
                },
              },
            ],
          }
        : {};
    (app.vault as unknown as { cachedRead: ReturnType<typeof vi.fn> }).cachedRead = vi
      .fn()
      .mockResolvedValue('Intro\nThis mentions [[A]] in a concrete backlink context.\nEnd');
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[4]!
      .click();
    view.containerEl
      .querySelector<HTMLElement>('[data-path="Backlink.md"].ohs-workbench-collapse')!
      .click();
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (view.containerEl.textContent?.includes('concrete backlink context')) break;
    }

    const details = view.containerEl.querySelector('.ohs-workbench-details')!;
    expect(details.textContent).toContain('This mentions [[A]] in a concrete backlink context.');
    expect(details.textContent).not.toContain('semantic');
    expect(details.textContent).not.toContain('Search contribution');
    expect(details.textContent).not.toContain('path');
  });

  it('visually distinguishes backlink and outgoing chips in the links tab', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[4]!
      .click();

    expect(view.containerEl.querySelector('.ohs-workbench-direction-outgoing')).not.toBeNull();
    expect(view.containerEl.querySelector('.ohs-workbench-direction-backlink')).not.toBeNull();
    expect(
      view.containerEl.querySelector('.ohs-workbench-direction-outgoing')?.textContent,
    ).toContain('Outgoing link');
    expect(
      view.containerEl.querySelector('.ohs-workbench-direction-backlink')?.textContent,
    ).toContain('Backlink');
  });

  it('keeps diagnostics grouped after tab switching', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[5]!
      .click();

    const groups = Array.from(
      view.containerEl.querySelectorAll<HTMLElement>('.ohs-workbench-stat-group-title'),
    ).map((el) => el.querySelector('span:last-child')?.textContent);
    expect(groups).toContain('Link structure');
    expect(groups).toContain('Recommendations');
    expect(groups).toContain('Discovery inputs');
    expect(
      view.containerEl.querySelectorAll('.ohs-workbench-stat-group-icon').length,
    ).toBeGreaterThanOrEqual(2);
    expect(view.containerEl.querySelector('.ohs-workbench-diagnostic-verdict-title')).toBeNull();
    expect(view.containerEl.textContent).not.toContain('Visible chars');
  });

  it('counts markdown list items inside blockquotes in text statistics', () => {
    const stats = computeNoteTextStats(
      [
        '> - [[Как читать книги]] ([стр. 180](zotero://open-pdf/library/items/WS2QP2EA?page=180&annotation=4AP8TIQS))',
        '> - [[Sonke Ahrens]]',
        '',
        '> A quoted observation.',
        '',
        '> [!note] Useful callout',
        '> Callout body.',
        '',
        'Plain paragraph.',
      ].join('\n'),
      { tags: ['reading'] },
    );

    expect(stats.listItems).toBe(2);
    expect(stats.quoteBlocks).toBe(2);
    expect(stats.callouts).toBe(1);
  });

  it('counts visible markdown text without link targets, comments, footnotes, and code blocks', () => {
    const stats = computeNoteTextStats(
      [
        '---',
        'title: Hidden metadata',
        '---',
        '# Visible title',
        '',
        '[visible label](https://example.com/very/long/path)',
        '[[Folder/Internal target|shown alias]]',
        '[[Folder/Plain note#Heading]]',
        '%% hidden comment words %%',
        '<!-- hidden html words -->',
        '```ts',
        'const hiddenCodeWord = true;',
        '```',
        'Visible paragraph with words.[^1]',
        '',
        '[^1]: hidden footnote words',
      ].join('\n'),
      { aliases: ['Alias'], tags: 'writing, stats' },
    );

    expect(stats.words).toBe(12);
    expect(stats.headings).toBe(1);
    expect(stats.frontmatterFields).toBe(2);
    expect(stats.tags).toBe(2);
    expect(stats.aliases).toBe(1);
    expect(stats.pages).toBeCloseTo(0.04, 2);
  });

  it('uses CJK characters separately for reading time and page estimates', () => {
    const stats = computeNoteTextStats('漢字かなカナ한글 English words.');

    expect(stats.words).toBe(2);
    expect(stats.cjkCharacters).toBe(8);
    expect(stats.readingMinutes).toBe(1);
    expect(stats.pages).toBeCloseTo(10 / 300, 3);
  });

  it('updates the active bottom tab when selecting another analysis tab', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[1]!
      .click();

    const bottomTabs = Array.from(
      view.containerEl.querySelectorAll<HTMLButtonElement>(
        '.ohs-workbench-tabs-bottom .ohs-workbench-tab',
      ),
    );
    expect(bottomTabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('keeps the bridge graph focused on the top ranked bridge rows', async () => {
    const app = makeApp();
    app.metadataCache.resolvedLinks = {
      'A.md': { 'B.md': 1, 'C.md': 1 },
      'B.md': { 'Bridge1.md': 1, 'Bridge2.md': 1, 'Bridge3.md': 1, 'Bridge4.md': 1 },
      'C.md': { 'Bridge1.md': 1, 'Bridge2.md': 1, 'Bridge3.md': 1, 'Bridge4.md': 1 },
    };
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[2]!
      .click();

    expect(view.containerEl.querySelector('.ohs-workbench-graph-disclosure')).toBeNull();
    const graphPaths = Array.from(
      view.containerEl.querySelectorAll<HTMLElement>(
        '.ohs-workbench-graph .ohs-workbench-node-item:not(.ohs-workbench-node-center):not(.ohs-workbench-node-support)',
      ),
    ).map((node) => node.dataset.path);
    const rowPaths = Array.from(
      view.containerEl.querySelectorAll<HTMLElement>(
        '.ohs-workbench-details .ohs-workbench-result',
      ),
    ).map((row) => row.dataset.path);
    expect(rowPaths).toHaveLength(4);
    expect(graphPaths).toEqual(rowPaths.slice(0, 3));
    expect(view.containerEl.querySelectorAll('.ohs-workbench-map-chip')).toHaveLength(3);
  });

  it('keeps actionable bridge candidates before weak bridge signals', async () => {
    const app = makeApp();
    app.metadataCache.resolvedLinks = {
      'A.md': { 'B.md': 1, 'C.md': 1 },
      'B.md': {
        'Medium1.md': 1,
        'Medium2.md': 1,
        'Weak1.md': 1,
        'Weak2.md': 1,
        'Weak3.md': 1,
        'Weak4.md': 1,
        'Weak5.md': 1,
      },
      'C.md': {
        'Medium1.md': 1,
        'Medium2.md': 1,
        'Weak1.md': 1,
        'Weak2.md': 1,
        'Weak3.md': 1,
        'Weak4.md': 1,
        'Weak5.md': 1,
      },
      'Weak1.md': { 'Extra1.md': 1, 'Extra2.md': 1, 'Extra3.md': 1 },
      'Weak2.md': { 'Extra4.md': 1, 'Extra5.md': 1, 'Extra6.md': 1 },
      'Weak3.md': { 'Extra7.md': 1, 'Extra8.md': 1, 'Extra9.md': 1 },
      'Weak4.md': { 'Extra10.md': 1, 'Extra11.md': 1, 'Extra12.md': 1 },
      'Weak5.md': { 'Extra13.md': 1, 'Extra14.md': 1, 'Extra15.md': 1 },
    };
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[2]!
      .click();

    const rowPaths = Array.from(
      view.containerEl.querySelectorAll<HTMLElement>(
        '.ohs-workbench-details .ohs-workbench-result',
      ),
    ).map((row) => row.dataset.path);
    const graphPaths = Array.from(
      view.containerEl.querySelectorAll<HTMLElement>(
        '.ohs-workbench-graph .ohs-workbench-node-item:not(.ohs-workbench-node-center):not(.ohs-workbench-node-support)',
      ),
    ).map((node) => node.dataset.path);
    expect(rowPaths.slice(0, 2)).toEqual(['Medium1.md', 'Medium2.md']);
    expect(rowPaths.length).toBeGreaterThan(2);
    expect(graphPaths).toEqual(rowPaths.slice(0, 3));
    expect(view.containerEl.querySelector('.ohs-workbench-reason-line')).toBeNull();
  });

  it('keeps the similar graph count aligned with the visible similar list', async () => {
    const app = makeApp();
    app.metadataCache.resolvedLinks = {
      'A.md': { 'SimilarLinked.md': 1 },
    };
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const semanticResults = [
      'Similar1.md',
      'Similar2.md',
      'SimilarLinked.md',
      'Similar3.md',
      'Similar4.md',
      'Similar5.md',
      'Similar6.md',
      'Similar7.md',
    ].map((path, index) => result(path, 0.9 - index * 0.02));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve(semanticResults);
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[3]!
      .click();

    const graphCandidateNodes = view.containerEl.querySelectorAll(
      '.ohs-workbench-graph .ohs-workbench-node-item:not(.ohs-workbench-node-center)',
    );
    const listRows = view.containerEl.querySelectorAll(
      '.ohs-workbench-details .ohs-workbench-result',
    );
    expect(graphCandidateNodes).toHaveLength(listRows.length);
    expect(
      view.containerEl.querySelector(
        '.ohs-workbench-edge-bridge, .ohs-workbench-node-bridge, .ohs-workbench-node-missing',
      ),
    ).toBeNull();
  });

  it('keeps the missing-links graph count aligned with the visible missing-link list', async () => {
    const app = makeApp();
    app.metadataCache.resolvedLinks = {};
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const semanticResults = [
      'Missing1.md',
      'Missing2.md',
      'Missing3.md',
      'Missing4.md',
      'Missing5.md',
      'Missing6.md',
      'Missing7.md',
      'Missing8.md',
    ].map((path, index) => result(path, 0.74 - index * 0.01));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve(semanticResults);
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[1]!
      .click();

    const graphCandidateNodes = view.containerEl.querySelectorAll(
      '.ohs-workbench-graph .ohs-workbench-node-item:not(.ohs-workbench-node-center)',
    );
    const listRows = view.containerEl.querySelectorAll(
      '.ohs-workbench-details .ohs-workbench-result',
    );
    expect(graphCandidateNodes).toHaveLength(listRows.length);
  });

  it('keeps medium semantic-only discovery out of the stricter missing-link queue', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([result('SemanticOnly.md', 0.61)]);
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[3]!
      .click();
    await Promise.resolve();

    const details = view.containerEl.querySelector('.ohs-workbench-details')!;
    expect(details.querySelector('[data-path="SemanticOnly.md"]')).not.toBeNull();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[1]!
      .click();
    await Promise.resolve();
    expect(details.querySelector('[data-path="SemanticOnly.md"]')).toBeNull();
  });

  it('keeps high semantic unlinked notes available as weak missing-link suggestions', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([result('HighSemantic.md', 0.72)]);
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[1]!
      .click();
    await Promise.resolve();

    expect(
      view.containerEl.querySelector('.ohs-workbench-details [data-path="HighSemantic.md"]'),
    ).not.toBeNull();
  });

  it('shows a missing link only when semantic similarity has graph support', async () => {
    const app = makeApp();
    app.metadataCache.resolvedLinks = {
      'A.md': { 'Linked.md': 1 },
      'Linked.md': { 'Supported.md': 1, 'Noise1.md': 1, 'Noise2.md': 1, 'Noise3.md': 1 },
      'Supported.md': { 'X.md': 1, 'Y.md': 1, 'Z.md': 1 },
      'Backlink.md': { 'A.md': 1 },
    };
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([result('Supported.md', 0.72)]);
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[1]!
      .click();
    await Promise.resolve();

    expect(
      view.containerEl.querySelector('.ohs-workbench-details [data-path="Supported.md"]'),
    ).not.toBeNull();
  });

  it('keeps semantic results when related lookup fails', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([result('Similar.md', 0.91)]);
        return Promise.reject(new Error('related unavailable'));
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();

    expect(view.containerEl.querySelector('[data-path="Similar.md"]')).not.toBeNull();
  });

  it('renders similar notes structural fallback without semantic scores', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) return Promise.resolve([]);
        return Promise.resolve([result('Structural.md', 0.42)]);
      }),
    };
    const view = makeView(app, client);

    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[3]!
      .click();

    expect(view.containerEl.querySelector('[data-path="Structural.md"]')).not.toBeNull();
    expect(view.containerEl.querySelector('.ohs-workbench-evidence-line')?.textContent).toContain(
      'structural fallback',
    );
    expect(view.containerEl.querySelector('.ohs-workbench-row')?.textContent).not.toContain('0.42');
    const graphNode = view.containerEl.querySelector<HTMLElement>(
      '.ohs-workbench-node-item[data-path="Structural.md"]',
    );
    const graphLink = graphNode?.querySelector<HTMLElement>('.ohs-workbench-node-link');
    expect(graphNode?.classList.contains('ohs-workbench-node-semantic')).toBe(false);
    expect(graphLink?.getAttribute('title')).not.toContain('0.42');
    expect(graphLink?.getAttribute('title')).not.toContain('0.00');
    expect(graphLink?.style.getPropertyValue('--ohs-workbench-node-score')).toBe('');
    expect(client.search).toHaveBeenCalledTimes(2);
  });

  it('does not render the previous note snapshot when a tab is selected during a note change', async () => {
    const app = makeApp();
    let path = 'A.md';
    app.workspace.getActiveFile = vi.fn(() => createFile(path));
    const view = makeView(app, {
      search: vi.fn().mockResolvedValue([result('OldSimilar.md', 0.9)]),
    });
    await view.onOpen();
    const reading = deferred<string>();
    vi.mocked(app.vault.cachedRead).mockReturnValueOnce(reading.promise);
    path = 'B.md';
    const pending = view.refreshFromActiveFile();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[3]!
      .click();
    expect(view.containerEl.querySelector('.ohs-workbench-details')!.textContent).not.toContain(
      'OldSimilar',
    );
    reading.resolve('new note');
    await pending;
    await view.onClose();
  });

  it('discards results from a client replaced during refresh', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi.fn(() => createFile('A.md'));
    const pending = deferred<ReturnType<typeof result>[]>();
    const oldClient = { search: vi.fn().mockReturnValue(pending.promise) };
    const plugin = {
      app,
      client: oldClient,
      manifest: { id: 'hybrid-search' },
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: vi.fn(),
    };
    const view = new GraphWorkbenchView(createLeaf(app), plugin as never);
    const opening = view.onOpen();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    plugin.client = { search: vi.fn().mockResolvedValue([result('NewServer.md', 0.9)]) };
    pending.resolve([result('OldServer.md', 0.9)]);
    await opening;
    expect(oldClient.search).toHaveBeenCalledOnce();
    expect(view.containerEl.textContent).not.toContain('OldServer');
    await view.refreshFromActiveFile(true);
    expect(view.containerEl.querySelector('[data-path="NewServer.md"]')).not.toBeNull();
    await view.onClose();
  });

  it.each(['close', 'note change'])('does not start related search after %s', async (action) => {
    const app = makeApp();
    let path = 'A.md';
    app.workspace.getActiveFile = vi.fn(() => createFile(path));
    const pending = deferred<ReturnType<typeof result>[]>();
    const client = {
      search: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([]),
    };
    const view = makeView(app, client);
    const opening = view.onOpen();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(client.search).toHaveBeenCalledOnce();
    if (action === 'close') await view.onClose();
    else {
      path = 'Linked.md';
      await view.refreshFromActiveFile();
    }
    const calls = client.search.mock.calls.length;
    pending.resolve([result('Backlink.md', 0.9)]);
    await opening;
    expect(client.search).toHaveBeenCalledTimes(calls);
    await view.onClose();
  });

  it('keeps newer note statistics when an older read finishes last', async () => {
    const app = makeApp();
    let activePath = 'A.md';
    app.workspace.getActiveFile = vi.fn(() => createFile(activePath));
    const oldRead = deferred<string>();
    vi.mocked(app.vault.cachedRead).mockImplementation((file) =>
      file.path === 'A.md' ? oldRead.promise : Promise.resolve('new note words'),
    );
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });
    const opening = view.onOpen();
    activePath = 'B.md';
    await view.refreshFromActiveFile(true);
    oldRead.resolve('old');
    await opening;
    expect((view as unknown as { noteTextStats: { words: number } }).noteTextStats.words).toBe(3);
  });

  it('keeps unchanged graph DOM, expansion and scroll during background refresh', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi.fn(() => createFile('A.md'));
    const view = makeView(app, {
      search: vi.fn().mockResolvedValue([{ ...result('Similar.md', 0.9), snippet: 'context' }]),
    });
    await view.onOpen();
    view.containerEl
      .querySelectorAll<HTMLButtonElement>('.ohs-workbench-tabs-bottom .ohs-workbench-tab')[3]!
      .click();
    view.containerEl.querySelector<HTMLElement>('.ohs-workbench-collapse')!.click();
    const row = view.containerEl.querySelector('.ohs-workbench-collapse');
    const details = view.containerEl.querySelector<HTMLElement>('.ohs-workbench-details')!;
    details.scrollTop = 41;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(details, { childList: true, subtree: true });
    await view.refreshFromActiveFile(true);
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    expect(view.containerEl.querySelector('.ohs-workbench-collapse')).toBe(row);
    expect(details.textContent).toContain('context');
    expect(details.scrollTop).toBe(41);
    expect(mutations).toHaveLength(0);
  });

  it('ignores stale async results after a forced refresh starts', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(createFile(), { path: 'A.md' }));
    const staleSemantic = deferred<ReturnType<typeof result>[]>();
    const statsRefresh = deferred<string>();
    let notePathCalls = 0;
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath) {
          notePathCalls++;
          return notePathCalls === 1
            ? staleSemantic.promise
            : Promise.resolve([result('Fresh.md', 0.88)]);
        }
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);

    const openA = view.onOpen();
    for (let index = 0; index < 10 && notePathCalls === 0; index++) await Promise.resolve();
    expect(notePathCalls).toBe(1);
    (app.vault.cachedRead as ReturnType<typeof vi.fn>).mockReturnValueOnce(statsRefresh.promise);
    const refreshA = view.refreshFromActiveFile(true);

    staleSemantic.resolve([result('Stale.md', 0.99)]);
    await openA;
    await Promise.resolve();

    expect(view.containerEl.querySelector('[data-path="Stale.md"]')).toBeNull();

    statsRefresh.resolve('');
    await refreshA;
    for (let index = 0; index < 10 && notePathCalls < 2; index++) await Promise.resolve();
    expect(notePathCalls).toBe(2);

    expect(view.containerEl.querySelector('[data-path="Fresh.md"]')).not.toBeNull();
    expect(view.containerEl.querySelector('[data-path="Stale.md"]')).toBeNull();
  });

  it('ignores stale async results after the active note changes', async () => {
    const app = makeApp();
    let activePath = 'A.md';
    app.workspace.getActiveFile = vi.fn(() => Object.assign(createFile(), { path: activePath }));
    const semanticA = deferred<ReturnType<typeof result>[]>();
    const semanticB = deferred<ReturnType<typeof result>[]>();
    const client = {
      search: vi.fn().mockImplementation((_query: string, options: { notePath?: string }) => {
        if (options.notePath === 'A.md') return semanticA.promise;
        if (options.notePath === 'B.md') return semanticB.promise;
        return Promise.resolve([]);
      }),
    };
    const view = makeView(app, client);
    const openA = view.onOpen();
    await Promise.resolve();

    activePath = 'B.md';
    const refreshB = view.refreshFromActiveFile(true);
    semanticB.resolve([result('Fresh.md', 0.93)]);
    await refreshB;

    semanticA.resolve([result('Stale.md', 0.99)]);
    await openA;

    expect(view.containerEl.querySelector('[data-path="Fresh.md"]')).not.toBeNull();
    expect(view.containerEl.querySelector('[data-path="Stale.md"]')).toBeNull();
  });

  it('onClose runs every registered cleanup when an earlier callback fails', async () => {
    const app = makeApp();
    const view = makeView(app, { search: vi.fn().mockResolvedValue([]) });
    const failure = new Error('first cleanup failed');
    const laterCleanup = vi.fn();
    const internals = view as unknown as { cleanupCallbacks: Array<() => void> };
    internals.cleanupCallbacks.push(() => {
      throw failure;
    }, laterCleanup);

    await expect(view.onClose()).rejects.toBe(failure);

    expect(laterCleanup).toHaveBeenCalledOnce();
    expect(internals.cleanupCallbacks).toHaveLength(0);
  });
});
