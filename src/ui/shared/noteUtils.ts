import { TFile, type App } from 'obsidian';
import type { SearchMode, SearchResult } from '../../search/contracts';
import type { SimilarTarget } from '../../search/queryParser';

interface SuperchargedLinksPlugin {
  _watchContainerDynamic: (
    watchId: string,
    container: HTMLElement,
    plugin: unknown,
    linkSelector: string,
    rowClass: string,
  ) => void;
  observers?: Array<[MutationObserver, string, string]>;
}

// Not exported: talking to supercharged-links is this module's job now, so nothing else needs
// to reach into its internals.
interface AppWithSuperchargedLinks {
  plugins?: {
    plugins?: Record<string, SuperchargedLinksPlugin | undefined>;
  };
}

export function getResultTitle(app: App, result: Pick<SearchResult, 'path' | 'title'>): string {
  const nfcPath = result.path.normalize('NFC');
  const fm = app.metadataCache.getCache(nfcPath)?.frontmatter;
  return (
    (typeof fm?.['title'] === 'string' ? fm['title'] : undefined) ??
    (result.title || nfcPath.replace(/^.*\//, '').replace(/\.md$/, ''))
  );
}

function fileToWikiLink(path: string): string {
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

/**
 * Identifies one container we ask supercharged-links to watch.
 *
 * The observers live in the supercharged-links plugin's own shared array, and unhooking works by
 * matching the id, so two installed copies of this plugin sharing an id would disconnect each
 * other's observers. `ownerId` namespaces the key; it is a required field with a nullable value
 * so that forgetting to wire it is a compile error rather than silent cross-copy interference.
 */
export interface SuperchargedWatch {
  ownerId: string | undefined;
  /** Identifies the container within one plugin instance. */
  id: string;
}

function watchKey(watch: SuperchargedWatch): string {
  return watch.ownerId ? `${watch.ownerId}:${watch.id}` : watch.id;
}

export function hookSuperchargedLinks(
  app: App,
  watch: SuperchargedWatch,
  containerEl: HTMLElement,
  linkSelector: string,
  rowClass: string,
): void {
  const sl = (app as unknown as AppWithSuperchargedLinks).plugins?.plugins?.[
    'supercharged-links-obsidian'
  ];
  if (!sl || typeof sl._watchContainerDynamic !== 'function') return;
  unhookSuperchargedLinks(app, watch);
  sl._watchContainerDynamic(watchKey(watch), containerEl, sl, linkSelector, rowClass);
}

export function unhookSuperchargedLinks(app: App, ...watches: SuperchargedWatch[]): void {
  const sl = (app as unknown as AppWithSuperchargedLinks).plugins?.plugins?.[
    'supercharged-links-obsidian'
  ];
  if (!sl || !Array.isArray(sl.observers)) return;
  const keys = new Set(watches.map(watchKey));
  let failed = false;
  let firstError: unknown;
  for (let idx = sl.observers.length - 1; idx >= 0; idx--) {
    const observerEntry = sl.observers[idx];
    const id = observerEntry?.[1];
    if (id !== undefined && keys.has(id)) {
      sl.observers.splice(idx, 1);
      try {
        observerEntry![0].disconnect();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }
  if (failed) throw firstError;
}

export function scoreColor(score: number): string {
  if (score >= 0.8) return '#4caf50';
  if (score >= 0.5) return '#ff9800';
  return '#9e9e9e';
}

/**
 * Turn a parsed @similar target into a vault-relative path.
 *
 * `activePath` is a parameter rather than an app lookup because the surfaces
 * disagree about what "active" means: the modal holds a snapshot taken when it
 * opened, while the panel and inline suggester track the live active file.
 *
 * An unresolvable wikilink falls through to the raw ref — the backend has its own
 * path resolution and reports ambiguity, so guessing here would only lose information.
 */
export function resolveSimilarTarget(
  app: App,
  target: SimilarTarget,
  activePath: string | undefined,
  sourcePath: string,
): string | null {
  if (target.kind === 'active') return activePath ?? null;
  const dest = app.metadataCache.getFirstLinkpathDest(target.ref, sourcePath);
  return dest?.path ?? target.ref;
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
