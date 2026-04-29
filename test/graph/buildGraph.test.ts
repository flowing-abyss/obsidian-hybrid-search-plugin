import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/graph/buildGraph';

function mockApp(links: Record<string, Record<string, number>>) {
  return {
    metadataCache: {
      resolvedLinks: links,
      getCache: (path: string) => {
        const titles: Record<string, string> = {
          'A.md': 'Note A',
          'B.md': 'Note B',
          'C.md': 'Note C',
          'D.md': 'Note D',
        };
        return {
          frontmatter: { title: titles[path] },
        };
      },
    },
  } as unknown as import('obsidian').App;
}

describe('buildGraph', () => {
  it('returns only center node when no links exist', () => {
    const app = mockApp({});
    const result = buildGraph(app, 'A.md', 1);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toEqual({ path: 'A.md', depth: 0, title: 'Note A' });
    expect(result.edges).toHaveLength(0);
  });

  it('finds outgoing links at depth 1', () => {
    const app = mockApp({
      'A.md': { 'B.md': 1, 'C.md': 2 },
    });
    const result = buildGraph(app, 'A.md', 1);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes.find((node) => node.path === 'B.md')?.depth).toBe(1);
    expect(result.nodes.find((node) => node.path === 'C.md')?.depth).toBe(1);
  });

  it('finds backlinks at depth -1', () => {
    const app = mockApp({
      'B.md': { 'A.md': 1 },
      'C.md': { 'A.md': 1 },
    });
    const result = buildGraph(app, 'A.md', 1);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes.find((node) => node.path === 'B.md')?.depth).toBe(-1);
    expect(result.nodes.find((node) => node.path === 'C.md')?.depth).toBe(-1);
  });

  it('traverses outgoing depth 2', () => {
    const app = mockApp({
      'A.md': { 'B.md': 1 },
      'B.md': { 'C.md': 1 },
    });
    const result = buildGraph(app, 'A.md', 2);
    expect(result.nodes.find((node) => node.path === 'C.md')?.depth).toBe(2);
    expect(result.edges).toContainEqual({ source: 'B.md', target: 'C.md' });
  });

  it('deduplicates nodes reached via multiple paths', () => {
    const app = mockApp({
      'A.md': { 'B.md': 1, 'C.md': 1 },
      'B.md': { 'C.md': 1 },
    });
    const result = buildGraph(app, 'A.md', 2);
    expect(result.nodes.filter((node) => node.path === 'C.md')).toHaveLength(1);
  });
});
