import type { SearchResult } from '../../search/contracts';
import { getMatchSources, type SearchMatchSource } from '../../search/matchSources';

const LABELS: Record<SearchMatchSource, { code: string; label: string }> = {
  fulltext: { code: 'F', label: 'full-text' },
  semantic: { code: 'S', label: 'semantic' },
  title: { code: 'T', label: 'title / aliases' },
};

export function getMatchSourceDescription(result: SearchResult): string {
  const text = getMatchSources(result)
    .map((source) => LABELS[source].label)
    .join(' + ');
  return text ? text[0]!.toUpperCase() + text.slice(1) : '';
}

/** Update only the optional annotation, retaining score, selection and result DOM. */
export function updateMatchSourceBadge(
  score: HTMLElement,
  result: SearchResult,
  enabled: boolean,
): void {
  const existing = score.parentElement?.querySelector<HTMLElement>('.hybrid-search-match-sources');
  const sources = enabled ? getMatchSources(result) : [];
  if (!sources.length) {
    existing?.remove();
    return;
  }
  const text = sources.map((source) => LABELS[source].code).join('·');
  if (existing?.textContent === text) return;
  const badge = existing ?? score.parentElement!.createSpan({ cls: 'hybrid-search-match-sources' });
  badge.textContent = text;
  const description = `Found by: ${sources.map((source) => LABELS[source].label).join(' + ')}`;
  badge.setAttribute('title', description);
  badge.setAttribute('aria-label', description);
  score.before(badge);
}
