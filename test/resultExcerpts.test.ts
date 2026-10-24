import { TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchAnchor, SearchResult } from '../src/ipc';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SearchModal } from '../src/ui/SearchModal';

const anchor: MatchAnchor = {
  kind: 'semantic',
  headingPath: '## 电源管理 > ### 电量查询 FN+D',
  matchText: '充电时白色指示灯快闪。',
  charStart: 80,
  charEnd: 391,
};
const result: SearchResult = {
  path: '键盘/EVO80.md',
  title: '键盘说明',
  score: 0.99,
  tags: [],
  aliases: [],
  snippet:
    '## 电源管理\n\n两块 4000 毫安时电池。\n\n### 电量查询 FN+D\n\n充电时**白色指示灯快闪**。\n\n满电时绿色常亮。',
  previewAnchors: [anchor],
  primaryAnchorIndex: 0,
};
const source =
  '---\ntitle: 键盘\n---\n\n## 电源管理\n\n两块电池。\n\n### 电量查询 FN+D\n\n充电时**白色指示灯快闪**。\n\n满电时绿色常亮。';
const search = vi.fn();
const read = vi.fn();
const open = vi.fn();
const getLeaf = vi.fn(() => ({ openFile: open }));
const app = {
  workspace: { getLeaf, getLastOpenFiles: () => [] },
  vault: {
    cachedRead: read,
    getAbstractFileByPath: (path: string) => Object.assign(new TFile(), { path }),
  },
  metadataCache: { getCache: () => null },
};
function modal(showPreview = false, scrollToSnippet = false) {
  return new SearchModal(
    app as never,
    { search },
    {
      ...DEFAULT_SETTINGS,
      showPreview,
      scrollToSnippet,
      showMeta: false,
    },
    vi.fn(),
  );
}
async function query(m: SearchModal, text = '电量 FN+D') {
  const pending = m.getSuggestions(text);
  await vi.advanceTimersByTimeAsync(150);
  return pending;
}
async function render(item = result, text = '电量 FN+D') {
  const m = modal();
  await query(m, text);
  const el = activeDocument.createDiv();
  m.renderSuggestion(item, el);
  return el;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  search.mockResolvedValue([result]);
  read.mockResolvedValue(source);
  open.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('modal result excerpts', () => {
  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])('requests snippets and anchors with preview=%s scroll=%s', async (preview, scroll) => {
    await query(modal(preview, scroll));
    expect(search).toHaveBeenCalledWith(
      '电量 FN+D',
      expect.objectContaining({ snippetLength: 400, anchors: true }),
    );
  });
  it('shows the primary chapter and answer body, skipping unrelated chunk introduction', async () => {
    const el = await render();
    expect(el.querySelector('.hybrid-search-result-heading')?.textContent).toBe(
      '电源管理 > 电量查询 FN+D',
    );
    const excerpt = el.querySelector('.hybrid-search-result-snippet');
    expect(excerpt?.textContent).toBe('充电时白色指示灯快闪。 满电时绿色常亮。');
    expect(el.querySelector('.hybrid-search-result-filename')?.textContent).toBe('EVO80.md');
    expect(el.querySelector('a')?.getAttribute('data-href')).toBe('键盘/EVO80');
  });
  it('preserves literal hashes that belong to a chapter name', async () => {
    const el = await render({ ...result, previewAnchors: [{ ...anchor, headingPath: '## C#' }] });
    expect(el.querySelector('.hybrid-search-result-heading')?.textContent).toBe('C#');
  });
  it('keeps answer text when the BM25 primary anchor is a Markdown heading', async () => {
    const el = await render({
      ...result,
      previewAnchors: [{ ...anchor, headingPath: null, matchText: '### 电量查询 FN+D' }],
    });
    expect(el.querySelector('.hybrid-search-result-snippet')?.textContent).toBe(
      '充电时白色指示灯快闪。 满电时绿色常亮。',
    );
  });
  it('highlights only literal Chinese and symbol-bearing query tokens', async () => {
    const el = await render({
      ...result,
      snippet: '按 FN+D 看电量；不要按 FND。',
      previewAnchors: [],
    });
    expect([...el.querySelectorAll('mark')].map((x) => x.textContent)).toEqual(['FN+D', '电量']);
    expect(el.textContent).toContain('FND');
  });
  it('does not invent lexical matches for a semantic paraphrase', async () => {
    const el = await render(
      { ...result, snippet: '剩余能量通过灯色表示。', previewAnchors: [] },
      '电量',
    );
    expect(el.querySelector('mark')).toBeNull();
    expect(el.textContent).toContain('剩余能量通过灯色表示。');
  });
  it('flattens tables without Markdown separators', async () => {
    const el = await render({
      ...result,
      snippet: '| 电量 | 灯色 |\n| --- | --- |\n| 0%-10% | 红色 |',
      previewAnchors: [],
    });
    expect(el.querySelector('.hybrid-search-result-snippet')?.textContent).toBe(
      '电量 · 灯色 0%-10% · 红色',
    );
  });
  it('renders markup as text and never expands embeds or attachments', async () => {
    const el = await render({
      ...result,
      snippet: '<img src=x onerror=alert(1)> **电量** ![[secret--private]] ![img](secret.png)',
      previewAnchors: [],
    });
    expect(el.querySelector('img,script,iframe')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el.querySelector('.hybrid-search-result-snippet')?.textContent).not.toContain('secret');
    expect(read).not.toHaveBeenCalled();
  });
  it.each([undefined, '', '---\n![[image.png]]'])(
    'shows a truthful empty fallback for %s',
    async (snippet) => {
      const el = await render({ ...result, snippet, previewAnchors: [] });
      expect(el.querySelector('.hybrid-search-result-snippet')?.textContent).toBe(
        '暂无可用片段',
      );
    },
  );
  it('resets query highlighting after switching to recent mode', async () => {
    const m = modal();
    await query(m);
    await m.getSuggestions('');
    const el = activeDocument.createDiv();
    m.renderSuggestion(result, el);
    expect(el.querySelector('.hybrid-search-result-snippet')).toBeNull();
  });
  it('invalidates an in-flight response and uses only the newest query tokens', async () => {
    let finish!: (r: SearchResult[]) => void;
    search.mockImplementationOnce(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          finish = resolve;
        }),
    );
    const m = modal();
    const old = m.getSuggestions('电量');
    await vi.advanceTimersByTimeAsync(150);
    const current = m.getSuggestions('白色');
    await vi.advanceTimersByTimeAsync(150);
    expect(await old).toEqual([]);
    expect(await current).toEqual([result]);
    finish([{ ...result, title: 'old response' }]);
    await Promise.resolve();
    const el = activeDocument.createDiv();
    m.renderSuggestion(result, el);
    expect([...el.querySelectorAll('mark')].map((x) => x.textContent)).toEqual(['白色']);
  });
  it('does not return results after closing during an in-flight search', async () => {
    let finish!: (r: SearchResult[]) => void;
    search.mockImplementationOnce(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          finish = resolve;
        }),
    );
    const m = modal();
    const pending = m.getSuggestions('电量');
    await vi.advanceTimersByTimeAsync(150);
    m.onClose();
    finish([result]);
    expect(await pending).toEqual([]);
  });
});

describe('validated modal navigation', () => {
  it('opens at the current Markdown answer despite body-relative chunk coordinates', async () => {
    const m = modal();
    await m.onChooseSuggestion(result, new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: result.path }), {
      eState: { line: 10, cursor: { from: { line: 10, ch: 0 }, to: { line: 10, ch: 0 } } },
    });
  });
  it('mouse selection uses the same verified position', async () => {
    await modal().onChooseSuggestion(result, new MouseEvent('click'));
    expect(open.mock.calls[0]?.[1]?.eState.line).toBe(10);
  });
  it.each([undefined, [{ ...anchor, matchText: 'deleted answer' }]])(
    'falls back to ordinary open for missing/stale anchors',
    async (anchors) => {
      await modal().onChooseSuggestion(
        { ...result, previewAnchors: anchors },
        new MouseEvent('click'),
      );
      expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: result.path }));
    },
  );
  it('falls back when reading the current file fails', async () => {
    read.mockRejectedValueOnce(new Error('unavailable'));
    await modal().onChooseSuggestion(result, new MouseEvent('click'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: result.path }));
  });
  it('resolves identical leaf headings under distinct complete chapter paths', async () => {
    read.mockResolvedValue(
      '## 其他\n### 电量查询 FN+D\n充电时**白色指示灯快闪**。\n## 电源管理\n### 电量查询 FN+D\n充电时**白色指示灯快闪**。',
    );
    await modal().onChooseSuggestion(result, new MouseEvent('click'));
    expect(open.mock.calls[0]?.[1]?.eState.line).toBe(5);
  });
  it('refuses an ambiguous repeated section instead of choosing the first match', async () => {
    read.mockResolvedValue(
      '## 电源管理\n### 电量查询 FN+D\n充电时**白色指示灯快闪**。\n## 电源管理\n### 电量查询 FN+D\n充电时**白色指示灯快闪**。',
    );
    await modal().onChooseSuggestion(result, new MouseEvent('click'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: result.path }));
  });
  it('locates a literal table row without using a guessed chunk end', async () => {
    read.mockResolvedValue(
      '---\ntitle: demo\n---\n## 电源管理\n### 电量查询 FN+D\n| 电量 | 灯色 |\n| --- | --- |\n| 0%-10% | 红色 |',
    );
    await modal().onChooseSuggestion(
      {
        ...result,
        previewAnchors: [{ ...anchor, matchText: '0%-10% | 红色', charStart: null, charEnd: null }],
      },
      new MouseEvent('click'),
    );
    expect(open.mock.calls[0]?.[1]?.eState.line).toBe(7);
  });
});
