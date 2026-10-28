import { parseLinktext, TFile, type App } from 'obsidian';

interface LinkHandlerCallbacks {
  onHoverPreview: (evt: MouseEvent, targetEl: HTMLElement, href: string) => void;
  onOpenFile: (file: TFile, background: boolean, closeModal: boolean, subpath?: string) => void;
}

type SourcePathResolver = string | ((link?: HTMLElement) => string);

export function hookInternalLinks(
  el: HTMLElement,
  app: App,
  sourcePath: SourcePathResolver,
  callbacks: LinkHandlerCallbacks,
): () => void {
  const mouseoverHandler = (evt: MouseEvent) => {
    if (!evt.ctrlKey && !evt.metaKey) return;
    const link = (evt.target as HTMLElement).closest<HTMLElement>('a, [data-href]');
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (!href || /^https?:\/\//.test(href)) return;
    callbacks.onHoverPreview(evt, link, href);
  };
  el.addEventListener('mouseover', mouseoverHandler);

  const handler = (evt: MouseEvent) => {
    const link = (evt.target as HTMLElement).closest<HTMLElement>('a, [data-href]');
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (!href || /^https?:\/\//.test(href)) return;
    evt.preventDefault();
    evt.stopPropagation();

    const currentSourcePath = resolveSourcePath(sourcePath, link);
    const { path, subpath } = parseLinktext(href);
    const file = app.metadataCache.getFirstLinkpathDest(
      path || currentSourcePath,
      currentSourcePath,
    );
    if (!(file instanceof TFile)) return;
    const background = evt.button === 1 || evt.ctrlKey || evt.metaKey;
    if (subpath) callbacks.onOpenFile(file, background, !background, subpath);
    else callbacks.onOpenFile(file, background, !background);
  };

  el.addEventListener('click', handler);
  el.addEventListener('auxclick', handler);
  return () => {
    el.removeEventListener('mouseover', mouseoverHandler);
    el.removeEventListener('click', handler);
    el.removeEventListener('auxclick', handler);
  };
}

function resolveSourcePath(sourcePath: SourcePathResolver, link: HTMLElement): string {
  return typeof sourcePath === 'function' ? sourcePath(link) : sourcePath;
}

/** Let the host resolve headings and block references with its public navigation API. */
export function openLinkedFile(app: App, file: TFile, background: boolean, subpath?: string): void {
  if (subpath) {
    void app.workspace.openLinkText(file.path + subpath, '', background ? 'tab' : false, {
      active: !background,
    });
  } else if (background) {
    void app.workspace.getLeaf('tab').openFile(file, { active: false });
  } else {
    void app.workspace.getLeaf(false).openFile(file);
  }
}
