import { TFile, type App } from 'obsidian';
import type { SearchClient, SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';

export type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

export interface SimilarNotesOptions {
  limit: number;
  threshold: number;
}

export interface SimilarNotesFetchResult {
  results: SearchResult[];
  scoreMode: 'similarity' | 'structural';
}

export async function fetchSimilarNotesDetailed(
  client: Pick<SearchClient, 'search'>,
  path: string,
  options: SimilarNotesOptions,
): Promise<SimilarNotesFetchResult> {
  const nfcPath = path.normalize('NFC');
  const semantic = await client.search('', {
    notePath: path,
    limit: options.limit + 1,
    ...(options.threshold > 0 && { threshold: options.threshold }),
  });
  const filteredSemantic = semantic.filter((result) => result.path.normalize('NFC') !== nfcPath);
  if (filteredSemantic.length > 0) {
    return { results: filteredSemantic.slice(0, options.limit), scoreMode: 'similarity' };
  }
  if (options.threshold > 0) {
    return { results: [], scoreMode: 'similarity' };
  }

  const related = await client.search(path, { related: true, limit: options.limit + 1 });
  return {
    results: related
      .filter((result) => result.path.normalize('NFC') !== nfcPath)
      .slice(0, options.limit),
    scoreMode: 'structural',
  };
}

export async function fetchSimilarNotes(
  client: Pick<SearchClient, 'search'>,
  path: string,
  options: SimilarNotesOptions,
): Promise<SearchResult[]> {
  return (await fetchSimilarNotesDetailed(client, path, options)).results;
}

export function getResultTitle(app: App, result: Pick<SearchResult, 'path' | 'title'>): string {
  const nfcPath = result.path.normalize('NFC');
  const fm = app.metadataCache.getCache(nfcPath)?.frontmatter;
  return (
    (typeof fm?.['title'] === 'string' ? fm['title'] : undefined) ??
    (result.title || nfcPath.replace(/^.*\//, '').replace(/\.md$/, ''))
  );
}

export function fileToWikiLink(path: string): string {
  return `[[${path.normalize('NFC').replace(/\.md$/, '')}]]`;
}

export function fileToDragWikiLink(app: App, path: string, sourcePath = ''): string {
  const nfcPath = path.normalize('NFC');
  const abstract = app.vault.getAbstractFileByPath(nfcPath);
  const cache = app.metadataCache as {
    fileToLinktext?: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
  };
  if (abstract instanceof TFile && typeof cache.fileToLinktext === 'function') {
    return `[[${cache.fileToLinktext(abstract, sourcePath, true)}]]`;
  }
  return fileToWikiLink(nfcPath);
}

export function openResult(app: App, path: string, newLeaf: boolean): void {
  const nfcPath = path.normalize('NFC');
  const abstract = app.vault.getAbstractFileByPath(nfcPath);
  if (abstract instanceof TFile) {
    void app.workspace.getLeaf(newLeaf).openFile(abstract);
  }
}

export function createInternalLink(
  app: App,
  parent: HTMLElement,
  path: string,
  text: string,
  className: string,
): HTMLAnchorElement {
  const nfcPath = path.normalize('NFC');
  const link = parent.createEl('a', {
    text,
    cls: `internal-link ${className}`,
    attr: {
      href: nfcPath.replace(/\.md$/, ''),
      'data-href': nfcPath.replace(/\.md$/, ''),
      draggable: 'true',
    },
  });
  link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
  applySuperchargedLinkAttributes(app, link, nfcPath);
  link.addEventListener('dragstart', (evt) => {
    const wikiLink = fileToDragWikiLink(app, nfcPath);
    evt.dataTransfer?.setData('text/plain', wikiLink);
    evt.dataTransfer?.setData('text/markdown', wikiLink);
    if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'all';
  });
  return link;
}

export function createTreeItemLink(
  app: App,
  parent: HTMLElement,
  path: string,
  text: string,
  className: string,
): HTMLElement {
  const nfcPath = path.normalize('NFC');
  const link = parent.createDiv({ cls: `tree-item-inner ${className}` });
  link.textContent = text;
  link.setAttribute('data-href', nfcPath.replace(/\.md$/, ''));
  link.setAttribute('draggable', 'true');
  link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
  applySuperchargedLinkAttributes(app, link, nfcPath);
  link.addEventListener('dragstart', (evt) => {
    const wikiLink = fileToDragWikiLink(app, nfcPath);
    evt.dataTransfer?.setData('text/plain', wikiLink);
    evt.dataTransfer?.setData('text/markdown', wikiLink);
    if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'all';
  });
  return link;
}

export function applySuperchargedLinkAttributes(app: App, link: HTMLElement, path: string): void {
  const fm = app.metadataCache.getCache(path.normalize('NFC'))?.frontmatter;
  if (!fm) return;
  for (const [key, val] of Object.entries(fm)) {
    if (key === 'position') continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      const strVal = String(val);
      try {
        link.setAttribute(`data-link-${key}`, strVal);
        link.style.setProperty(`--data-link-${key}`, strVal);
      } catch {
        // Skip frontmatter keys that produce invalid attribute names.
      }
    }
  }
}

export function hookSuperchargedLinks(
  app: App,
  watchId: string,
  containerEl: HTMLElement,
  linkSelector: string,
  rowClass: string,
): void {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  const sl = (app as any).plugins?.plugins?.['supercharged-links-obsidian'];
  if (!sl || typeof sl._watchContainerDynamic !== 'function') return;
  unhookSuperchargedLinks(app, watchId);
  sl._watchContainerDynamic(watchId, containerEl, sl, linkSelector, rowClass);
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
}

export function unhookSuperchargedLinks(app: App, watchId: string): void {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  const sl = (app as any).plugins?.plugins?.['supercharged-links-obsidian'];
  if (!sl || !Array.isArray(sl.observers)) return;
  const observers = sl.observers as Array<[MutationObserver, string, string]>;
  const idx = observers.findIndex(([, id]) => id === watchId);
  if (idx >= 0) {
    observers[idx]![0].disconnect();
    observers.splice(idx, 1);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
}

export function getSimilarNotesOptions(settings: HybridSearchSettings): SimilarNotesOptions {
  return {
    limit: settings.similarNotesBottomLimit,
    threshold: settings.similarNotesThreshold,
  };
}

export function scoreColor(score: number): string {
  if (score >= 0.8) return '#4caf50';
  if (score >= 0.5) return '#ff9800';
  return '#9e9e9e';
}

export function modeLabel(mode: SearchMode, rerank: boolean): string {
  const letters: Record<SearchMode, string> = {
    hybrid: 'H',
    semantic: 'S',
    fulltext: 'F',
    title: 'T',
  };
  return rerank && mode === 'hybrid' ? `${letters[mode]}*` : letters[mode];
}
