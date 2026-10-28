import { setIcon } from 'obsidian';
import type { SearchResult } from '../../search/contracts';
import type { ResultExcerpt } from '../../search/excerpts';

interface ResultDetailsOptions {
  showMeta: boolean;
  compact: boolean;
  excerpt?: ResultExcerpt;
}

/** Only presentation: callers own search, selection, navigation and preview lifetime. */
export function renderResultDetails(
  container: HTMLElement,
  result: SearchResult,
  { showMeta, compact, excerpt }: ResultDetailsOptions,
): void {
  if (compact) container.addClass('hybrid-search-result-compact');
  if (showMeta) renderResultMetadata(container, result, compact);
  if (!excerpt) return;

  const row = container.createDiv({ cls: 'hybrid-search-excerpt' });
  if (excerpt.section) {
    row.createSpan({
      cls: 'hybrid-search-excerpt-section',
      text: `${excerpt.section} · `,
      attr: { title: excerpt.sectionTitle ?? excerpt.section },
    });
  }
  let cursor = 0;
  for (const { start, end } of excerpt.highlights) {
    row.appendChild(row.ownerDocument.createTextNode(excerpt.text.slice(cursor, start)));
    row.createEl('mark', { text: excerpt.text.slice(start, end) });
    cursor = end;
  }
  row.appendChild(row.ownerDocument.createTextNode(excerpt.text.slice(cursor)));
}

/** Shared metadata for modal, sidebar and inline results; no data fetching or navigation. */
export function renderResultMetadata(
  container: HTMLElement,
  result: SearchResult,
  disambiguateFilename = false,
): HTMLElement | undefined {
  const path = result.path.normalize('NFC');
  const folder = path.includes('/') ? path.replace(/\/[^/]+$/, '') : '';
  const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const includeFilename = disambiguateFilename && filename !== result.title.normalize('NFC');
  const label = includeFilename ? path.replace(/\.md$/, '') : folder;
  if (!label && !result.tags.length) return undefined;

  const meta = container.createDiv({ cls: 'hybrid-search-meta' });
  const fullLabel = [path, ...result.tags.map((tag) => `#${tag}`)].join(' · ');
  meta.setAttribute('title', fullLabel);
  meta.setAttribute('aria-label', fullLabel);
  if (label) {
    const pathSpan = meta.createSpan({ cls: 'hybrid-search-meta-path' });
    setIcon(pathSpan, 'folder');
    pathSpan.createSpan({ text: label });
  }
  for (const tag of result.tags) {
    // Text-space break opportunities let tags use the rest of a wrapped path's
    // last line. A flex item for the entire path would reserve that whole line.
    if (meta.hasChildNodes()) meta.appendChild(meta.ownerDocument.createTextNode(' '));
    meta.createSpan({ text: `#${tag}`, cls: 'hybrid-search-tag' });
  }
  return meta;
}
