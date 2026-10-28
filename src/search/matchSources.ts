import type { SearchResult } from './contracts';

export type SearchMatchSource = 'fulltext' | 'semantic' | 'title';

/** Retrieval provenance belongs to the result, never to its chosen preview anchor. */
export function getMatchSources(result: SearchResult): SearchMatchSource[] {
  const reported = new Set(result.matchedBy);
  const sources: SearchMatchSource[] = [];
  const has = (name: string, score: number | null | undefined): boolean =>
    result.matchedBy !== undefined
      ? reported.has(name)
      : typeof score === 'number' && Number.isFinite(score);
  if (has('bm25', result.scores?.bm25)) sources.push('fulltext');
  if (has('semantic', result.scores?.semantic)) sources.push('semantic');
  if (has('title', result.scores?.fuzzy_title)) sources.push('title');
  return sources;
}
