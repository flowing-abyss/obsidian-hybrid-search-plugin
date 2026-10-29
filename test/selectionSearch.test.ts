import { describe, expect, it, vi } from 'vitest';
import type { SearchResult, SearchService } from '../src/search/contracts';
import { searchSelection } from '../src/search/selectionSearch';

const hit = (path: string): SearchResult => ({
  path,
  title: path,
  score: 1,
  tags: [],
  aliases: [],
});
const service = () =>
  ({ search: vi.fn().mockResolvedValue([hit('B.md')]) }) as unknown as SearchService;

describe('selection search policy', () => {
  it('keeps a short selection as one complete hybrid query', async () => {
    const client = service();
    await searchSelection(client, { path: 'A.md', text: 'a complete thought' }, 8, () => true);
    expect(client.search).toHaveBeenCalledWith(
      'a complete thought',
      expect.objectContaining({ mode: 'hybrid', anchors: true, limit: 9 }),
    );
  });

  it('uses the indexed note for a large whole-note selection, including hidden YAML', async () => {
    const client = service();
    const text = 'An entire note. '.repeat(1000);
    await searchSelection(
      client,
      { path: 'A.md', text, sourceText: '---\ntitle: A\n---\n' + text },
      8,
      () => true,
    );
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(client.search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ notePath: 'A.md', anchors: true }),
    );
  });

  it('covers every character of a large partial selection without issuing a giant query', async () => {
    const client = service();
    const text = 'Большой фрагмент 日本語 🧠.\n'.repeat(100);
    await searchSelection(
      client,
      { path: 'A.md', text, sourceText: text + 'outside selection' },
      8,
      () => true,
    );
    const queries = vi.mocked(client.search).mock.calls.map(([query]) => query);
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.join('')).toBe(text);
    expect(Math.max(...queries.map((query) => Array.from(query).length))).toBeLessThanOrEqual(500);
    expect(queries.every((query) => !/[\uD800-\uDBFF]$/.test(query))).toBe(true);
  });

  it('combines passage evidence, deduplicates notes and retains the best matching excerpt', async () => {
    const client = service();
    vi.mocked(client.search)
      .mockResolvedValueOnce([hit('One.md'), { ...hit('Shared.md'), snippet: 'weaker passage' }])
      .mockResolvedValueOnce([{ ...hit('Shared.md'), snippet: 'best passage' }, hit('Two.md')]);
    const result = await searchSelection(
      client,
      { path: 'A.md', text: 'a'.repeat(1000) },
      8,
      () => true,
    );
    expect(result?.map((item) => item.path)).toEqual(['Shared.md', 'One.md', 'Two.md']);
    expect(result?.[0]?.snippet).toBe('best passage');
  });

  it('stops scheduling more passages when the selection is no longer current', async () => {
    const client = service();
    let current = true;
    vi.mocked(client.search).mockImplementation(async () => {
      current = false;
      return [hit('B.md')];
    });
    expect(
      await searchSelection(client, { path: 'A.md', text: 'x'.repeat(3000) }, 8, () => current),
    ).toBeNull();
    expect(vi.mocked(client.search).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('falls back to passage queries when a whole note has no indexed recommendations', async () => {
    const client = service();
    vi.mocked(client.search).mockResolvedValueOnce([]);
    const text = 'x'.repeat(1000);
    const results = await searchSelection(
      client,
      { path: 'A.md', text, sourceText: text },
      8,
      () => true,
    );
    expect(results?.[0]?.path).toBe('B.md');
    expect(client.search).toHaveBeenCalledTimes(3);
  });
});
