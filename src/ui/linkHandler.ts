import { TFile, type App } from 'obsidian';

interface LinkHandlerCallbacks {
  onHoverPreview: (evt: MouseEvent, targetEl: HTMLElement, href: string) => void;
  onOpenFile: (file: TFile, background: boolean, closeModal: boolean) => void;
}

type SourcePathResolver = string | ((link?: HTMLElement) => string);

export function hookInternalLinks(
  el: HTMLElement,
  app: App,
  sourcePath: SourcePathResolver,
  callbacks: LinkHandlerCallbacks,
): void {
  el.addEventListener('mouseover', (evt: MouseEvent) => {
    if (!evt.ctrlKey && !evt.metaKey) return;
    const link = (evt.target as HTMLElement).closest<HTMLElement>('a, [data-href]');
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (!href || /^https?:\/\//.test(href)) return;
    callbacks.onHoverPreview(evt, link, href);
  });

  const handler = (evt: MouseEvent) => {
    const link = (evt.target as HTMLElement).closest<HTMLElement>('a, [data-href]');
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (!href || /^https?:\/\//.test(href)) return;
    evt.preventDefault();
    evt.stopPropagation();

    const currentSourcePath = resolveSourcePath(sourcePath, link);
    const file = app.metadataCache.getFirstLinkpathDest(href, currentSourcePath);
    if (!(file instanceof TFile)) return;
    const background = evt.button === 1 || evt.ctrlKey || evt.metaKey;
    callbacks.onOpenFile(file, background, !background);
  };

  el.addEventListener('click', handler);
  el.addEventListener('auxclick', handler);
}

function resolveSourcePath(sourcePath: SourcePathResolver, link: HTMLElement): string {
  return typeof sourcePath === 'function' ? sourcePath(link) : sourcePath;
}
