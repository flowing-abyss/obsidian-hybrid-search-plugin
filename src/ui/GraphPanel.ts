import type { App } from 'obsidian';
import { buildGraph, type GraphData, type GraphEdge, type GraphNode } from '../graph/buildGraph';
import { hookInternalLinks } from './linkHandler';

export class GraphPanel {
  private el: HTMLDivElement;
  private viewportEl: HTMLDivElement;
  private svgEl: SVGSVGElement;
  private layersEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private depth = 1;
  private centerPath: string | undefined;
  private graphData: GraphData | null = null;
  private expandedPaths = new Set<string>();
  private onCloseModal: () => void;
  private static readonly SL_WATCH_ID = 'hybrid-search-graph-panel';

  constructor(
    private app: App,
    options: { onCloseModal: () => void },
  ) {
    this.onCloseModal = options.onCloseModal;
    this.el = activeDocument.body.createDiv('ohs-graph-panel');
    this.el.hide();

    this.viewportEl = this.el.createDiv('ohs-graph-viewport');
    this.svgEl = this.viewportEl.createSvg('svg');
    this.svgEl.classList.add('ohs-graph-edges');
    this.layersEl = this.viewportEl.createDiv('ohs-graph-layers');
    this.footerEl = this.el.createDiv('ohs-graph-footer');
  }

  show(notePath: string): void {
    const nfcPath = notePath.normalize('NFC');
    if (nfcPath === this.centerPath) {
      this.el.show();
      requestAnimationFrame(() => this.renderEdges());
      return;
    }
    if (nfcPath !== this.centerPath) this.expandedPaths.clear();
    this.centerPath = nfcPath;
    this.render();
    this.el.show();
    requestAnimationFrame(() => this.renderEdges());
  }

  hide(): void {
    this.el.hide();
  }

  unload(): void {
    this.unwatchSuperchargedLinks();
    this.el.remove();
  }

  getElement(): HTMLDivElement {
    return this.el;
  }

  isVisible(): boolean {
    return this.el.isShown();
  }

  private render(): void {
    if (!this.centerPath) return;
    this.viewportEl.empty();
    this.svgEl = this.viewportEl.createSvg('svg');
    this.svgEl.classList.add('ohs-graph-edges');
    this.layersEl = this.viewportEl.createDiv('ohs-graph-layers');

    this.graphData = buildGraph(this.app, this.centerPath, this.depth);
    this.applyExpandedNodes(this.graphData);
    this.renderLayers(this.graphData.nodes);
    this.renderFooter(this.graphData.nodes, this.graphData.edges);
    this.hookLinks();
    this.watchSuperchargedLinks();
  }

  private renderLayers(nodes: GraphNode[]): void {
    const byDepth = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      const arr = byDepth.get(node.depth) ?? [];
      arr.push(node);
      byDepth.set(node.depth, arr);
    }

    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    for (const depth of depths) {
      const layer = this.layersEl.createDiv('ohs-graph-layer');
      layer.setAttribute('data-depth', String(depth));
      if (depth === 0) layer.addClass('ohs-graph-center');

      for (const node of byDepth.get(depth)!) this.renderNode(layer, node);
    }
  }

  private renderNode(layer: HTMLDivElement, node: GraphNode): void {
    const item = layer.createDiv('ohs-graph-node-item');
    const isSource = node.path === this.centerPath;
    const link = item.createEl('a', {
      cls: `internal-link ohs-graph-node ohs-graph-node-link${isSource ? ' ohs-graph-source' : ''}`,
      text: node.title,
      attr: {
        'data-href': node.path.replace(/\.md$/, ''),
        'data-path': node.path,
      },
    });
    this.applySuperchargedFallback(link, node.path);

    const expanded = this.expandedPaths.has(node.path);
    const expandBtn = item.createEl('button', {
      cls: 'ohs-graph-expand-btn',
      text: expanded ? '-' : '+',
      attr: {
        'aria-label': expanded ? `Collapse ${node.title}` : `Expand ${node.title}`,
        'data-path': node.path,
      },
    });
    expandBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleNodeExpansion(node.path);
    });
  }

  private applySuperchargedFallback(link: HTMLElement, path: string): void {
    link.classList.add('data-link-icon', 'data-link-icon-after', 'data-link-text');
    const fm = this.app.metadataCache.getCache(path)?.frontmatter;
    if (!fm) return;
    for (const [key, val] of Object.entries(fm)) {
      if (key === 'position') continue;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        const strVal = String(val);
        try {
          link.setAttribute(`data-link-${key}`, strVal);
          link.style.setProperty(`--data-link-${key}`, strVal);
        } catch {
          // skip frontmatter keys that produce invalid attribute names
        }
      }
    }
  }

  private toggleNodeExpansion(path: string): void {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path);
    } else {
      this.expandedPaths.add(path);
    }
    this.render();
    requestAnimationFrame(() => this.renderEdges());
  }

  private applyExpandedNodes(graphData: GraphData): void {
    const nodes = new Map(graphData.nodes.map((node) => [node.path, node]));
    const edges = new Set(graphData.edges.map((edge) => `${edge.source}\x00${edge.target}`));

    for (const path of this.expandedPaths) {
      const base = nodes.get(path);
      if (!base) continue;

      for (const target of Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {})) {
        this.addExpandedEdge(graphData, nodes, edges, path, target, base.depth + 1);
      }
    }
  }

  private addExpandedEdge(
    graphData: GraphData,
    nodes: Map<string, GraphNode>,
    edges: Set<string>,
    source: string,
    target: string,
    newNodeDepth: number,
  ): void {
    const edgeKey = `${source}\x00${target}`;
    if (!edges.has(edgeKey)) {
      graphData.edges.push({ source, target });
      edges.add(edgeKey);
    }

    let missingPath: string | undefined;
    if (!nodes.has(source)) {
      missingPath = source;
    } else if (!nodes.has(target)) {
      missingPath = target;
    }
    if (!missingPath) return;

    const node = {
      path: missingPath,
      depth: newNodeDepth,
      title: this.getTitle(missingPath),
    };
    graphData.nodes.push(node);
    nodes.set(missingPath, node);
  }

  private getTitle(path: string): string {
    const fm = this.app.metadataCache.getCache(path)?.frontmatter;
    return (
      (typeof fm?.['title'] === 'string' ? fm['title'] : undefined) ??
      path.replace(/^.*\//, '').replace(/\.md$/, '')
    );
  }

  private renderEdges(): void {
    this.svgEl.innerHTML = '';
    const svgRect = this.svgEl.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;

    const nodeEls = new Map<string, HTMLElement>();
    for (const nodeEl of this.layersEl.querySelectorAll<HTMLElement>('.ohs-graph-node')) {
      const path = nodeEl.getAttribute('data-path');
      if (path) nodeEls.set(path, nodeEl);
    }

    for (const edge of this.graphData?.edges ?? []) {
      const sourceEl = nodeEls.get(edge.source);
      const targetEl = nodeEls.get(edge.target);
      if (!sourceEl || !targetEl) continue;

      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const line = this.svgEl.createSvg('line');
      line.setAttribute('x1', String(sourceRect.left + sourceRect.width / 2 - svgRect.left));
      line.setAttribute('y1', String(sourceRect.top + sourceRect.height / 2 - svgRect.top));
      line.setAttribute('x2', String(targetRect.left + targetRect.width / 2 - svgRect.left));
      line.setAttribute('y2', String(targetRect.top + targetRect.height / 2 - svgRect.top));
      line.setAttribute('class', 'ohs-graph-edge');
      this.svgEl.appendChild(line);
    }
  }

  private renderFooter(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.footerEl.empty();
    const inDeg = nodes.filter((node) => node.depth < 0).length;
    const outDeg = nodes.filter((node) => node.depth > 0).length;

    this.footerEl.createSpan({
      cls: 'ohs-graph-stats',
      text: `in: ${inDeg}  out: ${outDeg}  edges: ${edges.length}`,
    });

    const ctrl = this.footerEl.createDiv('ohs-graph-depth-control');
    const btnMinus = ctrl.createEl('button', {
      cls: 'ohs-graph-btn',
      text: '-',
      attr: { ...(this.depth <= 1 ? { disabled: '' } : {}) },
    });
    ctrl.createSpan({ text: `depth ${this.depth}` });
    const btnPlus = ctrl.createEl('button', { cls: 'ohs-graph-btn', text: '+' });

    btnMinus.addEventListener('click', () => {
      if (this.depth <= 1) return;
      this.depth--;
      this.render();
      requestAnimationFrame(() => this.renderEdges());
    });
    btnPlus.addEventListener('click', () => {
      this.depth++;
      this.render();
      requestAnimationFrame(() => this.renderEdges());
    });
  }

  private hookLinks(): void {
    hookInternalLinks(this.layersEl, this.app, this.centerPath ?? '', {
      onHoverPreview: (evt, targetEl, href) => {
        // @ts-ignore - hover-link is not typed in the public Obsidian API.
        this.app.workspace.trigger('hover-link', {
          event: evt,
          source: 'ohs-graph',
          hoverParent: { hoverPopover: null },
          targetEl,
          linktext: href,
          sourcePath: this.centerPath ?? '',
        });
      },
      onOpenFile: (file, background) => {
        if (background) {
          // @ts-ignore - 'tab' is a valid PaneType in modern Obsidian.
          void this.app.workspace.getLeaf('tab').openFile(file);
        } else {
          void this.app.workspace.getLeaf(false).openFile(file);
          this.onCloseModal();
        }
      },
    });
  }

  private watchSuperchargedLinks(): void {
    this.unwatchSuperchargedLinks();
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const sl = (this.app as any).plugins?.plugins?.['supercharged-links-obsidian'];
    if (!sl || typeof sl._watchContainerDynamic !== 'function') return;
    sl._watchContainerDynamic(
      GraphPanel.SL_WATCH_ID,
      this.layersEl,
      sl,
      'a.ohs-graph-node-link',
      'ohs-graph-node-item',
    );
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  }

  private unwatchSuperchargedLinks(): void {
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    const sl = (this.app as any).plugins?.plugins?.['supercharged-links-obsidian'];
    if (!sl || !Array.isArray(sl.observers)) return;
    const idx = (sl.observers as Array<[MutationObserver, string, string]>).findIndex(
      ([, id]) => id === GraphPanel.SL_WATCH_ID,
    );
    if (idx >= 0) {
      (sl.observers[idx] as [MutationObserver, string, string])[0].disconnect();
      (sl.observers as unknown[]).splice(idx, 1);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  }
}
