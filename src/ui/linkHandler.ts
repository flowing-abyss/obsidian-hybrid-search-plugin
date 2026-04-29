import { TFile, type App } from 'obsidian';

interface LinkHandlerCallbacks {
  onHoverPreview: (evt: MouseEvent, targetEl: HTMLElement, href: string) => void;
  onOpenFile: (file: TFile, background: boolean, closeModal: boolean) => void;
}

export function hookInternalLinks(
  el: HTMLElement,
  app: App,
  sourcePath: string | (() => string),
  callbacks: LinkHandlerCallbacks,
): void {
  el.addEventListener('mouseover', (evt: MouseEvent) => {
    if (!evt.ctrlKey && !evt.metaKey) return;
    const link = (evt.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (!href || /^https?:\/\//.test(href)) return;
    callbacks.onHoverPreview(evt, link, href);
  });

  const handler = (evt: MouseEvent) => {
    const link = (evt.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (!href || /^https?:\/\//.test(href)) return;
    evt.preventDefault();
    evt.stopPropagation();

    if (evt.ctrlKey || evt.metaKey) {
      callbacks.onHoverPreview(evt, link, href);
      return;
    }

    const currentSourcePath = typeof sourcePath === 'function' ? sourcePath() : sourcePath;
    const file = app.metadataCache.getFirstLinkpathDest(href, currentSourcePath);
    if (!(file instanceof TFile)) return;
    if (evt.button === 1) {
      callbacks.onOpenFile(file, true, false);
    } else {
      callbacks.onOpenFile(file, false, true);
    }
  };

  el.addEventListener('click', handler);
  el.addEventListener('auxclick', handler);
}
