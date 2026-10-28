import { describe, expect, it, vi } from 'vitest';
import {
  analyzeGraph,
  getCoCitations,
  getGraphStatsFromIndex,
  getPredictedLinks,
} from '../../src/graph/analysis';
import { createApp } from '../support/obsidian';

function appWithLinks() {
  const app = createApp();
  app.metadataCache.resolvedLinks = {
    'A.md': { 'B.md': 1, 'C.md': 1 },
    'B.md': { 'D.md': 1 },
    'C.md': { 'D.md': 1 },
    'Journal.md': { 'A.md': 1, 'Topic.md': 1, 'Other.md': 1 },
    'Daily.md': { 'A.md': 1, 'Topic.md': 1 },
  };
  app.metadataCache.getCache = (path: string) => ({
    frontmatter: { title: path.replace('.md', '') },
  });
  return app;
}

describe('graph analysis helpers', () => {
  it('counts induced edges without copying adjacency for every neighbor pair', () => {
    const neighbors = Array.from({ length: 120 }, (_, i) => `note-${i}`);
    const outgoing = new Map([
      ['center', new Set(neighbors)],
      ...neighbors.map(
        (path) => [path, new Set(neighbors.filter((other) => other !== path))] as const,
      ),
    ]);
    let copiedEntries = 0;
    for (const values of outgoing.values()) {
      const iterator = values[Symbol.iterator].bind(values);
      vi.spyOn(values, Symbol.iterator).mockImplementation(() => {
        copiedEntries += values.size;
        return iterator();
      });
    }
    const stats = getGraphStatsFromIndex({ outgoing, backlinks: new Map() }, 'center');
    expect(stats.edgesAmongNeighbours).toBe((120 * 119) / 2);
    expect(stats.clusteringCoefficient).toBe(1);
    expect(copiedEntries).toBeLessThan(120 * 120 * 2);
  });

  it('computes local stats for outgoing links and backlinks', () => {
    const analysis = analyzeGraph(appWithLinks(), 'A.md');

    expect(analysis.stats.outgoing).toBe(2);
    expect(analysis.stats.backlinks).toBe(2);
    expect(analysis.stats.neighbours).toBe(4);
  });

  it('scores predicted links using multiple graph signals', () => {
    const predicted = getPredictedLinks(appWithLinks(), 'A.md');

    expect(predicted[0]?.path).toBe('D.md');
    expect(predicted[0]?.commonNeighbours).toBe(2);
    expect(predicted[0]?.jaccard).toBeGreaterThan(0);
    expect(predicted[0]?.adamicAdar).toBeGreaterThan(0);
    expect(predicted[0]?.resourceAllocation).toBeGreaterThan(0);
    expect(predicted[0]?.preferentialAttachment).toBeGreaterThan(0);
    expect(predicted[0]?.cosine).toBeGreaterThan(0);
  });

  it('counts co-citations involving the active note without full pair expansion', () => {
    const coCitations = getCoCitations(appWithLinks(), 'A.md');

    expect(coCitations[0]).toMatchObject({
      path: 'Topic.md',
      count: 2,
      sources: ['Journal.md', 'Daily.md'],
    });
  });
});
