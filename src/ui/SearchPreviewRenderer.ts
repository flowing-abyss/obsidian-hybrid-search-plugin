import { App, MarkdownRenderChild, MarkdownRenderer, TFile } from 'obsidian';
import type { MatchAnchor } from '../ipc';
import { hookInternalLinks } from './linkHandler';

export interface SearchPreviewRendererOptions {
  app: App;
  containerEl: HTMLElement;
  getSourcePath: () => string;
  onPosition?: () => void;
}

export class SearchPreviewRenderer {
  private previewChild?: MarkdownRenderChild;
  private cleanupInternalLinks?: () => void;
  private currentPath?: string;
  private currentAnchorKey?: string;
  private requestId = 0;

  constructor(private readonly options: SearchPreviewRendererOptions) {}

  unload(): void {
    this.requestId++;
    this.cleanupInternalLinks?.();
    this.cleanupInternalLinks = undefined;
    this.previewChild?.unload();
    this.previewChild = undefined;
    this.currentPath = undefined;
    this.currentAnchorKey = undefined;
    this.options.containerEl.empty();
  }

  async render(
    path: string,
    snippet?: string,
    anchors?: MatchAnchor[],
    primaryIdx = 0,
  ): Promise<void> {
    const nfcPath = path.normalize('NFC');
    const key = anchorKey(anchors, primaryIdx);

    if (this.currentPath === nfcPath) {
      if (this.currentAnchorKey !== key) {
        this.currentAnchorKey = key;
        this.clearHighlights();
        this.applyHighlight(snippet, anchors, primaryIdx);
      }
      return;
    }

    const requestId = ++this.requestId;
    this.previewChild?.unload();
    this.previewChild = undefined;
    this.options.containerEl.empty();

    const file = this.options.app.vault.getAbstractFileByPath(nfcPath);
    if (!(file instanceof TFile)) return;

    let content: string;
    try {
      content = await this.options.app.vault.cachedRead(file);
    } catch {
      return;
    }
    if (requestId !== this.requestId) return;

    this.previewChild = new MarkdownRenderChild(this.options.containerEl);
    this.previewChild.load();
    await MarkdownRenderer.render(
      this.options.app,
      content,
      this.options.containerEl,
      nfcPath,
      this.previewChild,
    );
    if (requestId !== this.requestId) return;

    this.cleanupInternalLinks?.();
    this.cleanupInternalLinks = hookInternalLinks(
      this.options.containerEl,
      this.options.app,
      this.options.getSourcePath,
      {
        onHoverPreview: (evt, targetEl, href) => this.triggerHoverPreview(evt, targetEl, href),
        onOpenFile: (openFile, background) => {
          const leaf = background
            ? this.options.app.workspace.getLeaf('tab')
            : this.options.app.workspace.getLeaf(false);
          void leaf.openFile(openFile);
        },
      },
    );

    this.currentPath = nfcPath;
    this.currentAnchorKey = key;
    this.applyHighlight(snippet, anchors, primaryIdx);
    this.options.onPosition?.();
  }

  private triggerHoverPreview(evt: MouseEvent, targetEl: HTMLElement, href: string): void {
    // @ts-ignore - hover-link is not typed in the public Obsidian API.
    this.options.app.workspace.trigger('hover-link', {
      event: evt,
      source: 'hybrid-search-inline-preview',
      hoverParent: { hoverPopover: null },
      targetEl,
      linktext: href,
      sourcePath: this.currentPath ?? this.options.getSourcePath(),
    });
  }

  private clearHighlights(): void {
    for (const el of this.options.containerEl.querySelectorAll('.hybrid-search-semantic-match')) {
      el.classList.remove('hybrid-search-semantic-match');
    }
  }

  private applyHighlight(snippet?: string, anchors?: MatchAnchor[], primaryIdx = 0): void {
    const anchor = anchors?.[primaryIdx] ?? anchors?.[0];
    const target =
      (anchor ? this.findAnchorBlock(anchor) : undefined) ??
      (snippet ? this.findSnippetBlock(snippetScrollCandidates(snippet)) : undefined);
    if (!target) return;
    target.classList.add('hybrid-search-semantic-match');
    window.setTimeout(() => {
      if (!target.isConnected) return;
      target.scrollIntoView({ block: 'center' });
    }, 80);
  }

  private findAnchorBlock(anchor: MatchAnchor): HTMLElement | undefined {
    const headingEl = this.findHeadingElement(anchor.headingPath);
    if (!anchor.matchText) return headingEl;
    const needle = toDisplayText(anchor.matchText).toLowerCase();
    if (!needle) return headingEl;
    return this.findTextBlock([needle]) ?? headingEl;
  }

  private findHeadingElement(headingPath: string | null): HTMLElement | undefined {
    if (!headingPath) return undefined;
    const leaf = headingPath.split(' > ').pop()?.trim().toLowerCase();
    if (!leaf) return undefined;
    const headings = Array.from(
      this.options.containerEl.querySelectorAll('h1, h2, h3, h4, h5, h6'),
    );
    return headings.find((h) => (h.textContent ?? '').trim().toLowerCase() === leaf) as
      | HTMLElement
      | undefined;
  }

  private findSnippetBlock(candidates: string[]): HTMLElement | undefined {
    return this.findTextBlock(candidates);
  }

  private findTextBlock(candidates: string[]): HTMLElement | undefined {
    const blocks = Array.from(
      this.options.containerEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'),
    ).filter((block) => !block.closest('.callout'));
    for (const candidate of candidates) {
      const found = blocks.find((block) =>
        (block.textContent ?? '').toLowerCase().includes(candidate),
      );
      if (found) return found as HTMLElement;
    }
    return undefined;
  }
}

function anchorKey(anchors?: MatchAnchor[], idx?: number): string {
  if (!anchors?.length) return '';
  const anchor = anchors[idx ?? 0] ?? anchors[0]!;
  return `${anchor.headingPath ?? ''}\x00${anchor.matchText ?? ''}`;
}

const MD_STRIP = /[*_`#^~|\\]/g;

function toDisplayText(s: string): string {
  /* eslint-disable sonarjs/slow-regex -- markdown link stripping is bounded to one snippet line or anchor string */
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(MD_STRIP, '');
  /* eslint-enable sonarjs/slow-regex */
}

function snippetScrollCandidates(snippet: string): string[] {
  const candidates: string[] = [];
  for (const line of snippet.split('\n')) {
    const stripped = toDisplayText(line).trim();
    if (!stripped) continue;
    if (stripped.includes(' > ')) {
      stripped
        .split(' > ')
        .reverse()
        .map((part) => part.trim())
        .filter((part) => part.length >= 10)
        .forEach((part) => candidates.push(part.toLowerCase().slice(0, 60)));
      continue;
    }
    const raw = stripped
      .replace(/^\.{3}/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[xX ]\]\s*/, '')
      .trim();
    if (raw.length >= 10) candidates.push(raw.toLowerCase().slice(0, 60));
  }
  snippet
    .split('...')
    .map((part) => toDisplayText(part).replace(/>/g, '').replace(/\n/g, ' ').trim())
    .filter((part) => part.length >= 10)
    .sort((a, b) => b.length - a.length)
    .forEach((part) => candidates.push(part.toLowerCase().slice(0, 60)));
  return [...new Set(candidates)];
}
