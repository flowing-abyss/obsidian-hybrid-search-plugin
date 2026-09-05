import { Component, setIcon, TFile, type App, type HoverParent } from 'obsidian';
import type { SearchResult } from '../ipc';
import { runAllCleanupSteps } from './cleanup';
import { hookInternalLinks } from './linkHandler';
import {
  createTreeItemLink,
  getResultTitle,
  hookSuperchargedLinks,
  unhookSuperchargedLinks,
  type SuperchargedWatch,
} from './noteUtils';

export type SimilarNotesScoreMode = 'similarity' | 'structural';

export interface SimilarNotesResultsOptions {
  app: App;
  containerEl: HTMLElement;
  ownerId: string | undefined;
  watchId: string;
  getSourcePath: (targetEl?: HTMLElement) => string;
  hoverParent: HoverParent;
  onToggle: (path: string) => void;
  onContentChanged?: () => void;
  onOpenFile?: (file: TFile, background: boolean) => void;
}

export class SimilarNotesResults extends Component {
  private readonly superchargedWatch: SuperchargedWatch;
  private cleanupInternalLinks?: () => void;

  constructor(private readonly options: SimilarNotesResultsOptions) {
    super();
    this.superchargedWatch = { ownerId: options.ownerId, id: options.watchId };
    this.registerDomEvent(options.containerEl, 'click', (event) => this.handleClick(event));
    this.cleanupInternalLinks = hookInternalLinks(
      options.containerEl,
      options.app,
      (targetEl) => options.getSourcePath(targetEl),
      {
        onHoverPreview: (event, targetEl, href) => {
          // @ts-ignore - hover-link is not typed in the public Obsidian API.
          options.app.workspace.trigger('hover-link', {
            event,
            source: 'similar-notes',
            hoverParent: options.hoverParent,
            targetEl,
            linktext: href,
            sourcePath: options.getSourcePath(targetEl),
          });
        },
        onOpenFile: (file, background) => this.openFile(file, background),
      },
    );
    hookSuperchargedLinks(
      options.app,
      this.superchargedWatch,
      options.containerEl,
      '.hybrid-search-similar-note-link',
      'search-result-file-title',
    );
  }

  render(
    results: SearchResult[],
    scoreMode: SimilarNotesScoreMode,
    expandedPaths: ReadonlySet<string>,
  ): void {
    this.options.containerEl.empty();
    const children = this.options.containerEl.createDiv({ cls: 'search-results-children' });
    for (const result of results) {
      const path = result.path.normalize('NFC');
      const isExpanded = expandedPaths.has(path);
      const row = children.createDiv({
        cls: `tree-item hybrid-search-similar-result${isExpanded ? '' : ' is-collapsed'}`,
      });
      const titleRow = row.createDiv({
        cls: 'tree-item-self search-result-file-title is-clickable',
      });
      const collapseIcon = titleRow.createDiv({
        cls: `tree-item-icon collapse-icon${isExpanded ? '' : ' is-collapsed'}`,
      });
      setIcon(collapseIcon, 'right-triangle');
      collapseIcon.dataset.path = path;
      collapseIcon.setAttribute('aria-label', isExpanded ? 'Collapse result' : 'Expand result');
      createTreeItemLink(
        this.options.app,
        titleRow,
        path,
        getResultTitle(this.options.app, result),
        'hybrid-search-similar-note-link',
        this.options.getSourcePath(),
      );
      const flairOuter = titleRow.createDiv({ cls: 'tree-item-flair-outer' });
      flairOuter.createDiv({
        cls: 'tree-item-flair',
        text: scoreMode === 'similarity' && result.score > 0 ? result.score.toFixed(2) : '',
      });
      if (isExpanded && result.snippet) {
        const matches = row.createDiv({
          cls: 'search-result-file-matches',
          attr: { 'data-source-path': path },
        });
        matches.createDiv({
          cls: 'search-result-file-match tappable',
          text: result.snippet,
          attr: { 'data-source-path': path },
        });
      }
    }
    this.options.onContentChanged?.();
  }

  override unload(): void {
    const cleanupInternalLinks = this.cleanupInternalLinks;
    this.cleanupInternalLinks = undefined;
    runAllCleanupSteps(
      () => unhookSuperchargedLinks(this.options.app, this.superchargedWatch),
      () => cleanupInternalLinks?.(),
      () => super.unload(),
      () => this.options.containerEl.empty(),
    );
  }

  private handleClick(event: Event): void {
    const collapseIcon = (event.target as HTMLElement).closest<HTMLElement>('.collapse-icon');
    if (!collapseIcon?.dataset.path) return;
    event.preventDefault();
    event.stopPropagation();
    this.options.onToggle(collapseIcon.dataset.path);
  }

  private openFile(file: TFile, background: boolean): void {
    if (this.options.onOpenFile) {
      this.options.onOpenFile(file, background);
      return;
    }
    if (background) {
      void this.options.app.workspace.getLeaf('tab').openFile(file, { active: false });
    } else {
      void this.options.app.workspace.getLeaf(false).openFile(file);
    }
  }
}
