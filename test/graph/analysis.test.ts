import { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { analyzeGraph, getCoCitations, getPredictedLinks } from '../../src/graph/analysis';

function appWithLinks() {
  const app = new App();
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
