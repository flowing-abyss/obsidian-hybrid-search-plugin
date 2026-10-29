import { MarkdownView } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult, SearchService } from '../src/search/contracts';
import { WorkbenchSelection } from '../src/ui/graph/WorkbenchSelection';
import { createApp, createLeaf } from './support/obsidian';

const hit = (path = 'B.md'): SearchResult => ({
  path,
  title: path,
  score: 0.8,
  tags: [],
  aliases: [],
  snippet: 'An unrelated introduction.',
  previewAnchors: [
    {
      kind: 'semantic',
      headingPath: 'Evidence',
      matchText: 'The matching passage.',
      charStart: null,
      charEnd: null,
    },
  ],
});
const components: WorkbenchSelection[] = [];

function setup(text = 'First idea. Second idea.') {
  const app = createApp({ 'A.md': text, 'B.md': 'The matching passage.' });
  const source = new MarkdownView(createLeaf(app));
  source.file = app.vault.getFileByPath('A.md');
  source.editor.setValue(text);
  source.contentEl.createDiv({ text });
  activeDocument.body.appendChild(source.containerEl);
  vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(source);
  app.workspace.getActiveFile = vi.fn().mockReturnValue(source.file);
  const parent = activeDocument.body.createDiv();
  const client = { search: vi.fn().mockResolvedValue([hit()]) } as unknown as SearchService;
  const state = { client: client as SearchService | undefined, enabled: true };
  const open = vi.fn();
  const changed = vi.fn();
  const component = new WorkbenchSelection(app, parent, {
    getClient: () => state.client,
    isEnabled: () => state.enabled,
    getLimit: () => 8,
    onScopeChange: changed,
    openResult: open,
  });
  component.load();
  component.syncSource('A.md');
  components.push(component);
  const select = async (from = 0, to = text.length) => {
    source.editor.setSelection(source.editor.offsetToPos(from), source.editor.offsetToPos(to));
    const range = activeDocument.createRange();
    range.selectNodeContents(source.contentEl);
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.getSelection()!.addRange(range);
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(300);
  };
  return { app, source, parent, client, state, component, select, open, changed };
}

beforeEach(() => {
  activeDocument.body.empty();
  vi.useFakeTimers();
});
afterEach(() => {
  for (const component of components.splice(0)) component.unload();
  activeDocument.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

describe('Workbench selected text', () => {
  it('uses the indexed whole note for a long selection and shows no duplicate source title or scores', async () => {
    const text = 'Большая мысль 日本語. '.repeat(1200);
    const { select, client, parent } = setup(text);
    await select();
    expect(client.search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        notePath: 'A.md',
        anchors: true,
        limit: 9,
      }),
    );
    expect(parent.querySelector('.ohs-workbench-selection-quote')?.textContent).toBeTruthy();
    expect(parent.textContent).not.toContain('A.md');
    expect(parent.textContent).not.toContain('0.8');
    expect(parent.textContent).toContain('Use whole note');
    expect(parent.querySelector('.ohs-workbench-selection-result')).not.toBeNull();
  });

  it('keeps captured results after deselection and panel focus, then explicitly clears', async () => {
    const { select, source, client, component, parent } = setup();
    await select(0, 11);
    source.editor.setCursor({ line: 0, ch: 11 });
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.dispatchEvent(new Event('selectionchange'));
    parent.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(component.hasSelection).toBe(true);
    expect(client.search).toHaveBeenCalledTimes(1);
    parent.querySelector<HTMLButtonElement>('.ohs-workbench-selection-reset')!.click();
    expect(component.hasSelection).toBe(false);
  });

  it('does not search selections from result content or another tab', async () => {
    const { select, client, parent, state } = setup();
    state.enabled = false;
    await select();
    expect(client.search).not.toHaveBeenCalled();
    state.enabled = true;
    const range = activeDocument.createRange();
    range.selectNodeContents(parent);
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.getSelection()!.addRange(range);
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(300);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('ignores selections in embedded result panels inside the Markdown view', async () => {
    const { source, client } = setup();
    source.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 11 });
    const embedded = source.contentEl.createDiv({
      cls: 'hybrid-search-similar-bottom',
      text: 'Result text',
    });
    const range = activeDocument.createRange();
    range.selectNodeContents(embedded);
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.getSelection()!.addRange(range);
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(300);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('allows a selection again when its pending capture was skipped on another tab', async () => {
    const { source, client, state, select } = setup();
    source.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 11 });
    const range = activeDocument.createRange();
    range.selectNodeContents(source.contentEl);
    activeDocument.getSelection()!.removeAllRanges();
    activeDocument.getSelection()!.addRange(range);
    activeDocument.dispatchEvent(new Event('selectionchange'));
    state.enabled = false;
    await vi.advanceTimersByTimeAsync(300);
    state.enabled = true;
    await select(0, 11);
    expect(client.search).toHaveBeenCalledTimes(1);
  });

  it('releases captured context and pending work when its panel moves to another window', async () => {
    let migrated!: (win: Window) => unknown;
    const unregister = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'onWindowMigrated').mockImplementation(function (
      this: HTMLElement,
      callback,
    ) {
      migrated = callback;
      return unregister;
    });
    const { select, component } = setup();
    await select();
    expect(component.hasSelection).toBe(true);
    expect(migrated).toBeTypeOf('function');
    migrated(window);
    expect(component.hasSelection).toBe(false);
    component.unload();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('does not clear the first selection when a hidden result region reports migration late', async () => {
    const callbacks = new Map<HTMLElement, (win: Window) => unknown>();
    vi.spyOn(HTMLElement.prototype, 'onWindowMigrated').mockImplementation(function (
      this: HTMLElement,
      callback,
    ) {
      callbacks.set(this, callback);
      return () => callbacks.delete(this);
    });
    const { select, component, parent } = setup();
    // Obsidian reports visible host migration first. A hidden descendant's
    // notification waits until the first selected-text result makes it visible.
    callbacks.get(parent)?.(window);
    await select();
    callbacks.get(component.containerEl)?.(window);
    expect(component.hasSelection).toBe(true);
    expect(parent.querySelector('.ohs-workbench-selection-result')).not.toBeNull();
  });

  it('ignores an older query that resolves after a new selection', async () => {
    const { select, client, parent } = setup();
    let resolve!: (results: SearchResult[]) => void;
    vi.mocked(client.search).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await select(0, 11);
    await select(12);
    resolve([hit('Old.md')]);
    await vi.advanceTimersByTimeAsync(1);
    expect(parent.textContent).toContain('B.md');
    expect(parent.textContent).not.toContain('Old.md');
  });

  it('keeps the retained query when a new selection collapses before settling', async () => {
    const { select, source, client, parent } = setup();
    await select(0, 11);
    source.editor.setSelection({ line: 0, ch: 12 }, { line: 0, ch: 24 });
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(100);
    source.editor.setCursor({ line: 0, ch: 12 });
    activeDocument.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(300);
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('.ohs-workbench-selection-quote')?.textContent).toBe('First idea.');
  });

  it('filters a selected source passage beyond the display limit in Reading view', async () => {
    const tail = 'Unique selected tail marker.';
    const { select, source, client, parent } = setup('Earlier selected text. '.repeat(300) + tail);
    vi.spyOn(source, 'getMode').mockReturnValue('preview');
    vi.mocked(client.search).mockResolvedValue([
      {
        ...hit('A.md'),
        previewAnchors: [
          { kind: 'semantic', headingPath: null, matchText: tail, charStart: null, charEnd: null },
        ],
      },
      hit(),
    ]);
    await select();
    expect(
      Array.from(parent.querySelectorAll('.ohs-workbench-link')).map((el) => el.textContent),
    ).toEqual(['B.md']);
  });

  it.each(['reset', 'file', 'edit', 'client', 'close'])(
    'ignores pending work after %s',
    async (kind) => {
      const { select, client, parent, component, app, source, state } = setup();
      let resolve!: (results: SearchResult[]) => void;
      vi.mocked(client.search).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      await select();
      if (kind === 'reset') component.clear();
      if (kind === 'file') component.syncSource('B.md');
      if (kind === 'edit') app.workspace.trigger('editor-change', source.editor, source);
      if (kind === 'client') {
        state.client = undefined;
        component.syncSource('A.md');
      }
      if (kind === 'close') component.unload();
      resolve([hit('Stale.md')]);
      await vi.advanceTimersByTimeAsync(1);
      expect(parent.textContent).not.toContain('Stale.md');
      expect(component.hasSelection).toBe(false);
    },
  );

  it('shows the actual passage on demand and opens its result with keyboard access', async () => {
    const { select, parent, open } = setup();
    await select();
    expect(parent.querySelector('.ohs-workbench-selection-excerpt')).toBeNull();
    parent.querySelector<HTMLButtonElement>('.ohs-workbench-selection-expand')!.click();
    const excerpt = parent.querySelector<HTMLButtonElement>('.ohs-workbench-selection-excerpt')!;
    expect(excerpt.textContent).toContain('The matching passage.');
    expect(excerpt.textContent).not.toContain('unrelated introduction');
    excerpt.click();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'B.md' }),
      false,
      expect.any(Function),
    );
  });

  it('distinguishes rejected searches from empty results and allows retry', async () => {
    const { select, client, parent } = setup();
    vi.mocked(client.search).mockRejectedValueOnce(new Error('service failed'));
    await select();
    expect(parent.textContent).toContain('Search unavailable.');
    expect(parent.textContent).not.toContain('No matches');
    vi.mocked(client.search).mockResolvedValueOnce([]);
    parent.querySelector<HTMLButtonElement>('.ohs-workbench-selection-retry')!.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(parent.textContent).toContain('No matches for this selection.');
  });

  it('removes the selected passage itself but keeps another passage from the source', async () => {
    const text = 'First idea. Second idea.';
    const { select, client, parent } = setup(text);
    vi.mocked(client.search).mockResolvedValueOnce([
      {
        ...hit('A.md'),
        previewAnchors: [
          {
            kind: 'semantic',
            headingPath: null,
            matchText: 'First idea.',
            charStart: 0,
            charEnd: 11,
          },
        ],
      },
      hit(),
    ]);
    await select(0, 11);
    expect(parent.querySelectorAll('.ohs-workbench-selection-result')).toHaveLength(1);
    vi.mocked(client.search).mockResolvedValueOnce([
      {
        ...hit('A.md'),
        previewAnchors: [
          {
            kind: 'semantic',
            headingPath: null,
            matchText: 'First idea.',
            charStart: 0,
            charEnd: 11,
          },
        ],
      },
    ]);
    await select(12);
    expect(parent.querySelector('.ohs-workbench-selection-result')?.textContent).toContain('A.md');
  });

  it('omits an uncertain source match when Markdown cleanup prevents locating its range', async () => {
    const text = 'An **earlier thought**. A *selected thought*.';
    const { select, client, parent } = setup(text);
    vi.mocked(client.search).mockResolvedValue([
      {
        ...hit('A.md'),
        previewAnchors: [
          {
            kind: 'semantic',
            headingPath: null,
            matchText: 'An earlier thought. A selected thought.',
            charStart: 0,
            charEnd: 38,
          },
        ],
      },
      hit(),
    ]);
    await select(text.indexOf('A *selected'));
    expect(
      Array.from(parent.querySelectorAll('.ohs-workbench-link')).map((el) => el.textContent),
    ).toEqual(['B.md']);
  });

  it('omits a source chunk that contains the selected Reading-view sentence', async () => {
    const { select, source, client, parent } = setup('Selected sentence.');
    vi.spyOn(source, 'getMode').mockReturnValue('preview');
    vi.mocked(client.search).mockResolvedValue([
      {
        ...hit('A.md'),
        previewAnchors: [
          {
            kind: 'semantic',
            headingPath: null,
            matchText: 'Before. Selected sentence. After.',
            charStart: null,
            charEnd: null,
          },
        ],
      },
      hit(),
    ]);
    await select();
    expect(
      Array.from(parent.querySelectorAll('.ohs-workbench-link')).map((el) => el.textContent),
    ).toEqual(['B.md']);
  });
});
