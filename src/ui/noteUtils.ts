import { TFile, type App } from 'obsidian';
import type { MatchAnchor, SearchClient, SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';

export type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

/** The primary anchor is the one scrollTo/highlight logic should target — semantic when present. */
export function getPrimaryAnchor(source: {
  previewAnchors?: MatchAnchor[];
  primaryAnchorIndex?: number;
}): MatchAnchor | undefined {
  const anchors = source.previewAnchors;
  if (!anchors || anchors.length === 0) return undefined;
  const index =
    typeof source.primaryAnchorIndex === 'number' && source.primaryAnchorIndex >= 0
      ? source.primaryAnchorIndex
      : 0;
  return anchors[index] ?? anchors[0];
}

/** Resolve an anchor's real character offset in `content`, validating charStart against
 *  matchText and falling back to a literal search when the offset doesn't line up. */
export function getAnchorOffset(content: string, anchor: MatchAnchor): number {
  if (
    typeof anchor.charStart === 'number' &&
    anchor.charStart >= 0 &&
    anchor.charStart <= content.length
  ) {
    if (!anchor.matchText || content.startsWith(anchor.matchText, anchor.charStart)) {
      return anchor.charStart;
    }
  }
  if (!anchor.matchText) return -1;
  return content.indexOf(anchor.matchText);
}

export function offsetToEditorPosition(
  content: string,
  offset: number,
): { line: number; ch: number } {
  let line = 0;
  let lineStart = 0;
  const boundedOffset = Math.max(0, Math.min(offset, content.length));
  for (let index = 0; index < boundedOffset; index++) {
    if (content.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, ch: boundedOffset - lineStart };
}

export interface SimilarNotesOptions {
  limit: number;
  threshold: number;
  anchors?: boolean;
}

export interface SimilarNotesFetchResult {
  results: SearchResult[];
  scoreMode: 'similarity' | 'structural';
}

export interface SuperchargedLinksPlugin {
  _watchContainerDynamic: (
    watchId: string,
    container: HTMLElement,
    plugin: unknown,
    linkSelector: string,
    rowClass: string,
  ) => void;
  observers?: Array<[MutationObserver, string, string]>;
}

export interface AppWithSuperchargedLinks {
  plugins?: {
    plugins?: Record<string, SuperchargedLinksPlugin | undefined>;
  };
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
    ...(options.anchors && { anchors: true }),
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
  sourcePath = '',
  textClassName = '',
): HTMLAnchorElement {
  const nfcPath = path.normalize('NFC');
  const link = parent.createEl('a', {
    cls: `internal-link ${className}`,
    attr: {
      href: nfcPath.replace(/\.md$/, ''),
      'data-href': nfcPath.replace(/\.md$/, ''),
      draggable: 'true',
    },
  });
  if (textClassName) {
    link.createSpan({ cls: textClassName, text });
  } else {
    link.textContent = text;
  }
  link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
  applySuperchargedLinkAttributes(app, link, nfcPath);
  link.addEventListener('dragstart', (evt) => {
    const wikiLink = fileToDragWikiLink(app, nfcPath, sourcePath);
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
  sourcePath = '',
): HTMLElement {
  const nfcPath = path.normalize('NFC');
  const link = parent.createDiv({ cls: `tree-item-inner ${className}` });
  link.textContent = text;
  link.setAttribute('data-href', nfcPath.replace(/\.md$/, ''));
  link.setAttribute('draggable', 'true');
  link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
  applySuperchargedLinkAttributes(app, link, nfcPath);
  link.addEventListener('dragstart', (evt) => {
    const wikiLink = fileToDragWikiLink(app, nfcPath, sourcePath);
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
  const sl = (app as unknown as AppWithSuperchargedLinks).plugins?.plugins?.[
    'supercharged-links-obsidian'
  ];
  if (!sl || typeof sl._watchContainerDynamic !== 'function') return;
  unhookSuperchargedLinks(app, watchId);
  sl._watchContainerDynamic(watchId, containerEl, sl, linkSelector, rowClass);
}

export function unhookSuperchargedLinks(app: App, watchId: string): void {
  const sl = (app as unknown as AppWithSuperchargedLinks).plugins?.plugins?.[
    'supercharged-links-obsidian'
  ];
  if (!sl || !Array.isArray(sl.observers)) return;
  for (let idx = sl.observers.length - 1; idx >= 0; idx--) {
    if (sl.observers[idx]?.[1] === watchId) {
      sl.observers[idx]![0].disconnect();
      sl.observers.splice(idx, 1);
    }
  }
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
