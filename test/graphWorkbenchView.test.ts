import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { GraphWorkbenchView, computeNoteTextStats } from '../src/ui/GraphWorkbenchView';

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
  const app = new App();
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
  const leaf = new WorkspaceLeaf();
  (leaf as WorkspaceLeaf & { app: App }).app = app;
  const plugin = {
    app,
    client,
    settings: { ...DEFAULT_SETTINGS, similarNotesBottomLimit: 8 },
    saveSettings: vi.fn(),
  };
  return new GraphWorkbenchView(leaf, plugin as never);
}

describe('GraphWorkbenchView', () => {
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
    ).toEqual(['Best', 'Missing Links', 'Bridges', 'Similar', 'Links', 'Diagnostics']);
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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

  it('cross-highlights matching graph nodes and list rows on hover', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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

  it('renders backlink mention context when a linked note is expanded', async () => {
    const app = makeApp();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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
      .mockReturnValue(Object.assign(new TFile(), { path: 'A.md' }));
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

  it('ignores stale async results after the active note changes', async () => {
    const app = makeApp();
    let activePath = 'A.md';
    app.workspace.getActiveFile = vi.fn(() => Object.assign(new TFile(), { path: activePath }));
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
});
