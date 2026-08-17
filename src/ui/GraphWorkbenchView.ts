/* eslint-disable sonarjs/slow-regex -- graph workbench uses regexes for link parsing and path matching; patterns are bounded by input text length */
import { ItemView, Notice, setIcon, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import {
  analyzeGraph,
  buildGraphIndex,
  getBacklinksFromIndex,
  getNeighboursFromIndex,
  getOutgoingFromIndex,
  getTitle,
  type GraphAnalysis,
  type GraphIndex,
} from '../graph/analysis';
import { buildGraph, type GraphData, type GraphEdge, type GraphNode } from '../graph/buildGraph';
import type { MatchAnchor, SearchResult } from '../ipc';
import type HybridSearchPlugin from '../main';
import { hookInternalLinks } from './linkHandler';
import {
  createInternalLink,
  createTreeItemLink,
  fetchSimilarNotesDetailed,
  getAnchorOffset,
  getPrimaryAnchor,
  hookSuperchargedLinks,
  offsetToEditorPosition,
  openResult,
  unhookSuperchargedLinks,
  type SuperchargedWatch,
} from './noteUtils';

export const GRAPH_WORKBENCH_VIEW_TYPE = 'hybrid-search-graph-workbench';

type GraphMode = 'hybrid' | 'links';
type AnalysisTab = 'best' | 'missing' | 'bridges' | 'similar' | 'neighbors' | 'diagnostics';
type GraphNodeKind = 'center' | 'semantic' | 'neighbor' | 'missing' | 'bridge' | 'support';
type GraphEdgeKind = 'semantic' | 'link' | 'predicted' | 'bridge' | 'support';
type DirectionEvidence = 'outgoing' | 'backlink' | 'bidirectional';

interface WorkbenchNode {
  path: string;
  title: string;
  kind: GraphNodeKind;
  depth?: number;
  score?: number;
  x: number;
  y: number;
}

interface WorkbenchEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  score?: number;
}

interface CandidateNote {
  path: string;
  title: string;
  utilityScore: number;
  bestActionScore: number;
  linkabilityScore: number;
  bridgeScore: number;
  structuralScore: number;
  searchSignalScore: number;
  strengthLabel: 'Very Strong' | 'Strong' | 'Medium' | 'Weak' | 'Noise';
  evidence: string[];
  expandedEvidence: string[];
  kind: 'similar' | 'missing' | 'bridge' | 'neighbor' | 'diagnostic';
  semantic: number;
  snippet?: string;
  previewAnchors?: MatchAnchor[];
  primaryAnchorIndex?: number;
  existingDirectLink: boolean;
  direction: 'outgoing' | 'backlink' | 'bidirectional' | 'none';
  relatedTraversal: boolean;
  commonNeighbours: number;
  coCitations: number;
  jaccard: number;
  adamicAdar: number;
  resourceAllocation: number;
  preferentialAttachment: number;
  cosine: number;
}

interface NoteTextStats {
  words: number;
  characters: number;
  cjkCharacters: number;
  pages: number;
  readingMinutes: number;
  headings: number;
  listItems: number;
  paragraphs: number;
  quoteBlocks: number;
  callouts: number;
  frontmatterFields: number;
  tags: number;
  aliases: number;
}

const GRAPH_WIDTH = 360;
const GRAPH_HEIGHT = 240;
const CENTER_Y = 112;
const GRAPH_NODE_WIDTH = 104;
const GRAPH_NODE_HEIGHT = 30;
const GRAPH_NODE_GAP_X = 8;
const GRAPH_ROW_GAP_Y = 13;
const BRIDGE_GRAPH_LIMIT = 3;
const WORDS_PER_MINUTE = 265;
const CJK_CHARS_PER_MINUTE = 500;
const WORDS_PER_PAGE = 300;
const TAB_DEFINITIONS: Array<{
  tab: AnalysisTab;
  label: string;
  icon: string;
  graphLabel: string;
  subtitle: string;
}> = [
  {
    tab: 'best',
    label: 'Best',
    icon: 'sparkles',
    graphLabel: 'Best connection map',
    subtitle: 'Most actionable candidates for this note.',
  },
  {
    tab: 'missing',
    label: 'Missing Links',
    icon: 'link-2',
    graphLabel: 'Missing-link map',
    subtitle: 'Unlinked notes with enough evidence to consider a link.',
  },
  {
    tab: 'bridges',
    label: 'Bridges',
    icon: 'git-fork',
    graphLabel: 'Bridge map',
    subtitle: 'Top bridge candidates on the map; full ranked bridge list below.',
  },
  {
    tab: 'similar',
    label: 'Similar',
    icon: 'radar',
    graphLabel: 'Similar notes map',
    subtitle: 'Canonical semantic similarity order.',
  },
  {
    tab: 'neighbors',
    label: 'Links',
    icon: 'network',
    graphLabel: 'Expandable links',
    subtitle: 'Existing backlinks and outgoing links with context.',
  },
  {
    tab: 'diagnostics',
    label: 'Diagnostics',
    icon: 'activity',
    graphLabel: 'Graph diagnostics',
    subtitle: 'Structure, discovery, text, and metadata signals.',
  },
];

export class GraphWorkbenchView extends ItemView {
  private graphTabsEl!: HTMLElement;
  private analysisTabsEl!: HTMLElement;
  private graphEl!: HTMLElement;
  private detailsEl!: HTMLElement;
  private analysisTab: AnalysisTab = 'best';
  private centerPath: string | null = null;
  private semanticResults: SearchResult[] = [];
  private similarNotesScoreMode: 'similarity' | 'structural' = 'similarity';
  private relatedResults: SearchResult[] = [];
  private analysis: GraphAnalysis | null = null;
  private graphIndex: GraphIndex | null = null;
  private candidateCache: CandidateNote[] | null = null;
  private noteTextStats: NoteTextStats | null = null;
  private expandedPaths = new Set<string>();
  private expandedGraphPaths = new Set<string>();
  private linkGraphDepth = 1;
  private dismissedPaths = new Set<string>();
  private requestId = 0;
  private closed = true;
  private cleanupCallbacks: Array<() => void> = [];
  private readonly watchIdPrefix = `${GRAPH_WORKBENCH_VIEW_TYPE}-${Date.now().toString(36)}`;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: HybridSearchPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return GRAPH_WORKBENCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Graph workbench';
  }

  getIcon(): string {
    return 'git-fork';
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    this.closed = false;
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('hybrid-search-graph-workbench');

    const topBar = container.createDiv({ cls: 'ohs-workbench-topbar' });
    this.graphTabsEl = topBar.createDiv({ cls: 'ohs-workbench-graph-context' });
    this.renderGraphTabs();
    this.createIconButton(topBar, 'refresh-cw', 'Refresh graph workbench', () => {
      void this.refreshFromActiveFile(true);
    });
    this.graphEl = container.createDiv({ cls: 'ohs-workbench-graph' });

    this.analysisTabsEl = container.createDiv({
      cls: 'ohs-workbench-tabs ohs-workbench-tabs-bottom',
    });
    this.renderAnalysisTabs();
    this.detailsEl = container.createDiv({ cls: 'ohs-workbench-details' });

    this.registerDomEvent(this.detailsEl, 'click', (evt) => this.handleDetailsClick(evt));
    this.registerCleanup(this.hookWorkbenchLinks(this.detailsEl));
    hookSuperchargedLinks(
      this.app,
      this.detailsWatch,
      this.detailsEl,
      '.ohs-workbench-link',
      'ohs-workbench-row',
    );
    this.registerDomEvent(this.detailsEl, 'keydown', (evt) => this.handleDetailsKeydown(evt));
    await this.refreshFromActiveFile(true);
  }

  async onClose(): Promise<void> {
    await Promise.resolve();
    this.closed = true;
    this.requestId++;
    unhookSuperchargedLinks(this.app, this.graphWatch, this.detailsWatch);
    for (const cleanup of this.cleanupCallbacks.splice(0)) cleanup();
  }

  async refreshFromActiveFile(force = false): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.requestId++;
      this.centerPath = null;
      this.semanticResults = [];
      this.similarNotesScoreMode = 'similarity';
      this.relatedResults = [];
      this.analysis = null;
      this.graphIndex = null;
      this.candidateCache = null;
      this.noteTextStats = null;
      this.expandedPaths.clear();
      this.expandedGraphPaths.clear();
      this.renderEmpty('Open a note to inspect its graph.');
      return;
    }

    const path = file.path.normalize('NFC');
    if (!force && path === this.centerPath) return;
    const requestId = ++this.requestId;
    this.centerPath = path;
    this.semanticResults = [];
    this.similarNotesScoreMode = 'similarity';
    this.relatedResults = [];
    this.candidateCache = null;
    this.noteTextStats = null;
    this.expandedPaths.clear();
    this.expandedGraphPaths.clear();
    this.graphIndex = buildGraphIndex(this.app);
    this.analysis = analyzeGraph(this.app, path, this.resultLimit, this.graphIndex);
    this.noteTextStats = await this.loadNoteTextStats(file);
    if (this.closed || requestId !== this.requestId) return;
    this.renderLoading(path);

    await this.loadClientResults(path, requestId);
  }

  private get resultLimit(): number {
    return Math.max(5, Math.min(50, this.plugin.settings.similarNotesBottomLimit || 12));
  }

  private get graphWatch(): SuperchargedWatch {
    return { ownerId: this.plugin.manifest.id, id: `${this.watchIdPrefix}-graph` };
  }

  private get detailsWatch(): SuperchargedWatch {
    return { ownerId: this.plugin.manifest.id, id: `${this.watchIdPrefix}-details` };
  }

  private registerCleanup(cleanup: () => void): void {
    const register = (this as unknown as { register?: (callback: () => void) => void }).register;
    if (typeof register === 'function') {
      register.call(this, cleanup);
      return;
    }
    this.cleanupCallbacks.push(cleanup);
  }

  private async loadNoteTextStats(file: TFile): Promise<NoteTextStats | null> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      return computeNoteTextStats(content, cache?.frontmatter);
    } catch {
      return null;
    }
  }

  private async loadClientResults(path: string, requestId: number): Promise<void> {
    if (!this.plugin.client) {
      if (!this.closed && requestId === this.requestId) this.render();
      return;
    }

    try {
      const similar = await fetchSimilarNotesDetailed(this.plugin.client, path, {
        limit: this.resultLimit,
        threshold: this.plugin.settings.similarNotesThreshold,
        anchors: true,
      }).catch(() => ({ results: [], scoreMode: 'similarity' as const }));
      if (this.closed || requestId !== this.requestId) return;
      const related =
        similar.scoreMode === 'similarity'
          ? await this.plugin.client
              .search(path, {
                related: true,
                depth: 1,
                direction: 'both',
                limit: this.resultLimit + 1,
              })
              .catch(() => [])
          : [];
      if (this.closed || requestId !== this.requestId) return;
      this.semanticResults = similar.results;
      this.similarNotesScoreMode = similar.scoreMode;
      this.relatedResults = related.filter((result) => result.path.normalize('NFC') !== path);
      this.candidateCache = null;
      this.render();
    } catch {
      if (!this.closed && requestId === this.requestId) this.render();
    }
  }

  private renderLoading(_path: string): void {
    this.graphEl.empty();
    this.graphEl.createDiv({ cls: 'search-empty-state', text: 'Loading graph...' });
    this.detailsEl.empty();
    this.detailsEl.createDiv({ cls: 'search-empty-state', text: 'Loading analysis...' });
  }

  private renderEmpty(message: string): void {
    this.graphEl.empty();
    this.graphEl.createDiv({ cls: 'search-empty-state', text: message });
    this.detailsEl.empty();
    this.detailsEl.createDiv({ cls: 'search-empty-state', text: message });
  }

  private render(): void {
    if (!this.centerPath || !this.analysis) {
      this.renderEmpty('Open a note to inspect its graph.');
      return;
    }
    this.renderGraphTabs();
    this.renderAnalysisTabs();
    this.renderGraph();
    this.renderDetails();
  }

  private renderGraphTabs(): void {
    this.graphTabsEl.empty();
    const definition = this.getActiveTabDefinition();
    const titleEl = this.graphTabsEl.createDiv({ cls: 'ohs-workbench-graph-context-title' });
    const iconEl = titleEl.createSpan({ cls: 'ohs-workbench-graph-context-icon' });
    setIcon(iconEl, definition.icon);
    titleEl.createSpan({ text: definition.graphLabel });
    this.graphTabsEl.createDiv({
      cls: 'ohs-workbench-graph-context-subtitle',
      text: this.getActiveTabSubtitle(definition),
    });
  }

  private renderAnalysisTabs(): void {
    this.analysisTabsEl.empty();
    for (const definition of TAB_DEFINITIONS) {
      this.createTab(this.analysisTabsEl, definition, this.analysisTab === definition.tab, () =>
        this.selectAnalysisTab(definition.tab),
      );
    }
  }

  private createTab(
    parent: HTMLElement,
    definition: (typeof TAB_DEFINITIONS)[number],
    active: boolean,
    onClick: () => void,
  ): void {
    const tab = parent.createEl('button', {
      cls: `ohs-workbench-tab${active ? ' is-active' : ''}`,
      attr: { type: 'button', 'aria-pressed': String(active), 'aria-selected': String(active) },
    });
    const iconEl = tab.createSpan({ cls: 'ohs-workbench-tab-icon' });
    setIcon(iconEl, definition.icon);
    tab.createSpan({ cls: 'ohs-workbench-tab-label', text: definition.label });
    tab.addEventListener('click', (evt) => {
      evt.preventDefault();
      onClick();
    });
  }

  private selectAnalysisTab(tab: AnalysisTab): void {
    if (this.analysisTab === tab) return;
    this.analysisTab = tab;
    this.expandedPaths.clear();
    this.renderGraphTabs();
    this.renderAnalysisTabs();
    this.renderGraph();
    this.renderDetails();
  }

  private renderGraph(): void {
    if (!this.centerPath) return;
    this.graphEl.empty();
    this.graphEl.removeClass('ohs-workbench-graph-links');
    unhookSuperchargedLinks(this.app, this.graphWatch);
    if (this.getEffectiveGraphMode() === 'links') {
      this.graphEl.addClass('ohs-workbench-graph-links');
      this.renderExpandableLinksGraph();
      return;
    }

    const graph = this.buildVisibleGraph();
    if (graph.nodes.length <= 1) {
      this.graphEl.createDiv({ cls: 'search-empty-state', text: 'No graph neighbours yet.' });
      return;
    }

    const graphHeight = getGraphHeight(graph.nodes);
    const scale = Math.min(1, Math.max(0.55, (this.graphEl.clientWidth - 16) / GRAPH_WIDTH));
    const canvasEl = this.graphEl.createDiv({ cls: 'ohs-workbench-graph-canvas' });
    canvasEl.style.setProperty('width', `${GRAPH_WIDTH * scale}px`);
    canvasEl.style.setProperty('height', `${graphHeight * scale}px`);
    const sceneEl = canvasEl.createDiv({ cls: 'ohs-workbench-graph-scene' });
    sceneEl.style.setProperty('transform', `scale(${scale})`);
    sceneEl.style.setProperty('height', `${graphHeight}px`);
    if (this.analysisTab === 'bridges') this.renderBridgeColumnLabels(sceneEl);
    const svg = sceneEl.createSvg('svg');
    svg.classList.add('ohs-workbench-svg');
    svg.setAttribute('height', String(graphHeight));
    svg.setAttribute('viewBox', `0 0 ${GRAPH_WIDTH} ${graphHeight}`);

    for (const edge of graph.edges) {
      const source = graph.nodes.find((node) => node.path === edge.source);
      const target = graph.nodes.find((node) => node.path === edge.target);
      if (!source || !target) continue;
      const line = svg.createSvg('line');
      line.setAttribute('x1', String(source.x));
      line.setAttribute('y1', String(source.y));
      line.setAttribute('x2', String(target.x));
      line.setAttribute('y2', String(target.y));
      line.setAttribute('class', `ohs-workbench-edge ohs-workbench-edge-${edge.kind}`);
      if (edge.score !== undefined) {
        line.style.opacity = String(Math.max(0.18, Math.min(0.75, edge.score)));
      }
    }

    const nodesEl = sceneEl.createDiv({ cls: 'ohs-workbench-graph-nodes' });
    for (const node of graph.nodes) this.renderGraphNode(nodesEl, node);
    this.hookWorkbenchLinks(nodesEl);
    hookSuperchargedLinks(
      this.app,
      this.graphWatch,
      nodesEl,
      'a.ohs-workbench-node-link',
      'ohs-workbench-node-item',
    );
  }

  private buildVisibleGraph(): { nodes: WorkbenchNode[]; edges: WorkbenchEdge[] } {
    const graphMode = this.getEffectiveGraphMode();
    const centerPath = this.centerPath!;
    if (this.analysisTab === 'bridges') return this.buildBridgeGraph(centerPath);

    const nodeMap = new Map<string, Omit<WorkbenchNode, 'x' | 'y'>>();
    const edges: WorkbenchEdge[] = [];
    nodeMap.set(centerPath, {
      path: centerPath,
      title: getTitle(this.app, centerPath),
      kind: 'center',
      depth: 0,
    });

    const includeLinkedGraph =
      this.analysisTab === 'neighbors' || this.analysisTab === 'diagnostics';
    if (includeLinkedGraph) {
      const linked = buildGraph(
        this.app,
        centerPath,
        1,
        this.graphIndex ?? buildGraphIndex(this.app),
      );
      if (graphMode === 'links') this.applyExpandedLinkNodes(linked);
      for (const node of linked.nodes) {
        if (node.path === centerPath) continue;
        nodeMap.set(node.path, {
          path: node.path,
          title: node.title,
          kind: 'neighbor',
          depth: node.depth,
        });
      }
      for (const edge of linked.edges) edges.push({ ...edge, kind: 'link' });
    }

    if (graphMode !== 'links') {
      const graphCandidates = this.getVisibleGraphCandidates();
      for (const candidate of graphCandidates) {
        const path = candidate.path.normalize('NFC');
        const existing = nodeMap.get(path);
        const candidateKind = this.getGraphCandidateKind(candidate);
        let edgeKind: GraphEdgeKind = 'predicted';
        if (this.analysisTab === 'similar' && this.similarNotesScoreMode === 'similarity') {
          edgeKind = 'semantic';
        } else if (candidate.existingDirectLink) {
          edgeKind = 'link';
        } else if (candidate.kind === 'bridge') {
          edgeKind = 'bridge';
        }
        const displayScore = this.getCandidateScoreForTab(candidate, this.analysisTab);
        const graphScore =
          this.analysisTab === 'similar' && this.similarNotesScoreMode === 'structural'
            ? undefined
            : displayScore;
        nodeMap.set(path, {
          path,
          title: existing?.title ?? candidate.title,
          kind: candidateKind,
          depth: existing?.depth ?? 2,
          score: graphScore,
        });
        edges.push({
          source: centerPath,
          target: path,
          kind: edgeKind,
          score: candidate.existingDirectLink ? undefined : graphScore,
        });
      }
    }

    const nodes = [...nodeMap.values()].slice(0, this.resultLimit + 1);
    return {
      nodes: layoutStructuredNodes(nodes),
      edges: edges.filter(
        (edge) =>
          nodeMap.has(edge.source) && nodeMap.has(edge.target) && edge.source !== edge.target,
      ),
    };
  }

  private buildBridgeGraph(centerPath: string): { nodes: WorkbenchNode[]; edges: WorkbenchEdge[] } {
    const bridgeCandidates = this.getVisibleGraphCandidates('bridges');
    const nodes = new Map<string, WorkbenchNode>();
    const edges: WorkbenchEdge[] = [];
    const usedSupports = new Set<string>();
    const index = this.graphIndex ?? buildGraphIndex(this.app);
    const centerNeighbours = getNeighboursFromIndex(index, centerPath);
    const rowGap = GRAPH_NODE_HEIGHT + 14;
    const firstY = 56;
    const lastY = firstY + Math.max(0, bridgeCandidates.length - 1) * rowGap;
    const centerY = bridgeCandidates.length > 0 ? (firstY + lastY) / 2 : CENTER_Y;

    nodes.set(centerPath, {
      path: centerPath,
      title: getTitle(this.app, centerPath),
      kind: 'center',
      depth: 0,
      x: 56,
      y: centerY,
    });

    bridgeCandidates.forEach((candidate, candidateIndex) => {
      const y = firstY + candidateIndex * rowGap;
      nodes.set(candidate.path, {
        path: candidate.path,
        title: candidate.title,
        kind: 'bridge',
        depth: 1,
        score: candidate.utilityScore,
        x: 176,
        y,
      });
      edges.push({
        source: centerPath,
        target: candidate.path,
        kind: 'bridge',
        score: candidate.utilityScore,
      });

      const candidateNeighbours = getNeighboursFromIndex(index, candidate.path);
      const commonNeighbours = [...centerNeighbours].filter((path) =>
        candidateNeighbours.has(path),
      );
      const coCitationSources =
        this.analysis?.coCitations.find((item) => item.path === candidate.path)?.sources ?? [];
      const supports = unique([...commonNeighbours, ...coCitationSources])
        .filter((path) => path !== centerPath && path !== candidate.path)
        .filter((path) => !usedSupports.has(path))
        .sort((a, b) => {
          const coCitationDelta =
            Number(coCitationSources.includes(b)) - Number(coCitationSources.includes(a));
          if (coCitationDelta !== 0) return coCitationDelta;
          return getNeighboursFromIndex(index, a).size - getNeighboursFromIndex(index, b).size;
        })
        .slice(0, 1);

      supports.forEach((supportPath) => {
        usedSupports.add(supportPath);
        if (!nodes.has(supportPath)) {
          nodes.set(supportPath, {
            path: supportPath,
            title: getTitle(this.app, supportPath),
            kind: 'support',
            depth: 2,
            x: 304,
            y,
          });
        }
        edges.push({
          source: candidate.path,
          target: supportPath,
          kind: 'support',
        });
      });
    });

    return { nodes: [...nodes.values()], edges };
  }

  private renderBridgeColumnLabels(parent: HTMLElement): void {
    const labels = parent.createDiv({ cls: 'ohs-workbench-bridge-labels' });
    labels.createSpan({ text: 'Current' }).setCssProps({ '--ohs-bridge-label-left': '56px' });
    labels.createSpan({ text: 'Bridge' }).setCssProps({ '--ohs-bridge-label-left': '176px' });
    labels.createSpan({ text: 'Evidence' }).setCssProps({ '--ohs-bridge-label-left': '304px' });
  }

  private renderGraphNode(parent: HTMLElement, node: WorkbenchNode): void {
    const item = parent.createDiv({
      cls: `ohs-workbench-node-item ohs-workbench-node-${node.kind}`,
    });
    item.dataset.path = node.path;
    item.dataset.sourcePath = this.centerPath ?? '';
    this.bindPathHover(item, node.path);
    item.setCssProps({
      '--ohs-workbench-node-left': `${node.x}px`,
      '--ohs-workbench-node-top': `${node.y}px`,
    });
    const link = createInternalLink(
      this.app,
      item,
      node.path,
      truncate(node.title, node.kind === 'center' ? 18 : 15),
      'ohs-workbench-node ohs-workbench-node-link',
      this.centerPath ?? '',
      'ohs-workbench-node-label',
    );
    link.dataset.path = node.path;
    link.dataset.sourcePath = this.centerPath ?? '';
    const scoreTitle = node.score === undefined ? '' : ` · ${node.score.toFixed(2)}`;
    link.setAttribute('title', `${node.title}${scoreTitle}`);
    if (node.kind === 'center') link.setAttribute('aria-current', 'true');
    if (node.score !== undefined) {
      link.setCssProps({ '--ohs-workbench-node-score': relevanceColor(node.score) });
    }
  }

  private getEffectiveGraphMode(): GraphMode {
    if (this.analysisTab === 'neighbors') return 'links';
    return 'hybrid';
  }

  private getActiveTabDefinition(): (typeof TAB_DEFINITIONS)[number] {
    return (
      TAB_DEFINITIONS.find((definition) => definition.tab === this.analysisTab) ??
      TAB_DEFINITIONS[0]!
    );
  }

  private getActiveTabSubtitle(definition: (typeof TAB_DEFINITIONS)[number]): string {
    if (this.analysisTab === 'similar' && this.similarNotesScoreMode === 'structural') {
      return 'Structural fallback order from graph traversal.';
    }
    return definition.subtitle;
  }

  private renderExpandableLinksGraph(): void {
    if (!this.centerPath) return;

    const graphData = buildGraph(
      this.app,
      this.centerPath,
      this.linkGraphDepth,
      this.graphIndex ?? buildGraphIndex(this.app),
    );
    this.applyExpandedLinkNodes(graphData);
    if (graphData.nodes.length <= 1) {
      this.graphEl.createDiv({ cls: 'search-empty-state', text: 'No graph neighbours yet.' });
      return;
    }

    const viewportEl = this.graphEl.createDiv({
      cls: 'ohs-workbench-link-viewport ohs-graph-viewport',
    });
    const svgEl = viewportEl.createSvg('svg');
    svgEl.classList.add('ohs-graph-edges');
    const layersEl = viewportEl.createDiv('ohs-graph-layers');

    this.renderExpandableLinkLayers(layersEl, svgEl, graphData);
    this.renderExpandableLinkFooter(graphData);
    this.hookWorkbenchLinks(layersEl);
    hookSuperchargedLinks(
      this.app,
      this.graphWatch,
      layersEl,
      'a.ohs-graph-node-link',
      'ohs-graph-node-item',
    );
    window.requestAnimationFrame(() =>
      this.renderExpandableLinkEdges(svgEl, layersEl, graphData.edges),
    );
  }

  private renderExpandableLinkLayers(
    layersEl: HTMLDivElement,
    svgEl: SVGSVGElement,
    graphData: GraphData,
  ): void {
    const byDepth = new Map<number, GraphNode[]>();
    for (const node of graphData.nodes) {
      const arr = byDepth.get(node.depth) ?? [];
      arr.push(node);
      byDepth.set(node.depth, arr);
    }

    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    for (const depth of depths) {
      const layer = layersEl.createDiv('ohs-graph-layer');
      layer.setAttribute('data-depth', String(depth));
      if (depth === 0) layer.addClass('ohs-graph-center');

      for (const node of byDepth.get(depth)!) {
        this.renderExpandableLinkNode(layer, svgEl, layersEl, graphData, node);
      }
    }
  }

  private renderExpandableLinkNode(
    layer: HTMLDivElement,
    svgEl: SVGSVGElement,
    layersEl: HTMLDivElement,
    graphData: GraphData,
    node: GraphNode,
  ): void {
    const item = layer.createDiv('ohs-graph-node-item');
    item.dataset.path = node.path;
    item.dataset.sourcePath = node.path;
    this.bindPathHover(item, node.path);
    const isSource = node.path === this.centerPath;
    const link = createInternalLink(
      this.app,
      item,
      node.path,
      node.title,
      `ohs-graph-node ohs-graph-node-link${isSource ? ' ohs-graph-source' : ''}`,
      this.centerPath ?? '',
      'ohs-graph-node-label',
    );
    link.dataset.path = node.path;
    link.dataset.sourcePath = node.path;

    item.addEventListener('mouseenter', () => {
      this.highlightExpandableLinkNeighborhood(svgEl, layersEl, graphData.edges, node.path);
    });
    item.addEventListener('mouseleave', () => this.clearExpandableLinkHighlight(svgEl, layersEl));

    if (isSource) return;

    const expanded = this.expandedGraphPaths.has(node.path);
    let expandIcon = '↓';
    if (expanded) expandIcon = '-';
    else if (node.depth < 0) expandIcon = '↑';
    const expandBtn = item.createEl('button', {
      cls: 'ohs-graph-expand-btn',
      text: expandIcon,
      attr: {
        type: 'button',
        'aria-label': expanded ? `Collapse ${node.title}` : `Expand ${node.title}`,
        'data-path': node.path,
      },
    });
    expandBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (expanded) this.expandedGraphPaths.delete(node.path);
      else this.expandedGraphPaths.add(node.path);
      this.renderGraph();
    });
  }

  private renderExpandableLinkEdges(
    svgEl: SVGSVGElement,
    layersEl: HTMLElement,
    edges: GraphEdge[],
  ): void {
    svgEl.innerHTML = '';
    const svgRect = svgEl.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;

    const nodeEls = new Map<string, HTMLElement>();
    for (const nodeEl of layersEl.querySelectorAll<HTMLElement>('.ohs-graph-node')) {
      const path = nodeEl.getAttribute('data-path');
      if (path) nodeEls.set(path, nodeEl);
    }

    for (const edge of edges) {
      const sourceEl = nodeEls.get(edge.source);
      const targetEl = nodeEls.get(edge.target);
      if (!sourceEl || !targetEl) continue;

      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const line = svgEl.createSvg('line');
      line.setAttribute('x1', String(sourceRect.left + sourceRect.width / 2 - svgRect.left));
      line.setAttribute('y1', String(sourceRect.top + sourceRect.height / 2 - svgRect.top));
      line.setAttribute('x2', String(targetRect.left + targetRect.width / 2 - svgRect.left));
      line.setAttribute('y2', String(targetRect.top + targetRect.height / 2 - svgRect.top));
      line.setAttribute('class', 'ohs-graph-edge');
      line.setAttribute('data-source', edge.source);
      line.setAttribute('data-target', edge.target);
    }
  }

  private renderExpandableLinkFooter(graphData: GraphData): void {
    const footerEl = this.graphEl.createDiv({ cls: 'ohs-workbench-link-footer ohs-graph-footer' });
    const inDeg = graphData.nodes.filter((node) => node.depth < 0).length;
    const outDeg = graphData.nodes.filter((node) => node.depth > 0).length;

    footerEl.createSpan({
      cls: 'ohs-graph-stats',
      text: `in: ${inDeg}  out: ${outDeg}  edges: ${graphData.edges.length}`,
    });

    const ctrl = footerEl.createDiv('ohs-graph-depth-control');
    const btnMinus = ctrl.createEl('button', {
      cls: 'ohs-graph-btn',
      text: '-',
      attr: { type: 'button', ...(this.linkGraphDepth <= 1 ? { disabled: '' } : {}) },
    });
    ctrl.createSpan({ text: `depth ${this.linkGraphDepth}` });
    const btnPlus = ctrl.createEl('button', {
      cls: 'ohs-graph-btn',
      text: '+',
      attr: { type: 'button' },
    });

    btnMinus.addEventListener('click', () => {
      if (this.linkGraphDepth <= 1) return;
      this.linkGraphDepth--;
      this.renderGraph();
    });
    btnPlus.addEventListener('click', () => {
      this.linkGraphDepth++;
      this.renderGraph();
    });
  }

  private highlightExpandableLinkNeighborhood(
    svgEl: SVGSVGElement,
    layersEl: HTMLElement,
    edges: GraphEdge[],
    path: string,
  ): void {
    const connected = new Set<string>([path]);
    for (const edge of edges) {
      if (edge.source === path) connected.add(edge.target);
      if (edge.target === path) connected.add(edge.source);
    }

    for (const nodeEl of layersEl.querySelectorAll<HTMLElement>('.ohs-graph-node')) {
      const nodePath = nodeEl.getAttribute('data-path');
      if (nodePath && connected.has(nodePath)) nodeEl.classList.add('ohs-graph-node-highlighted');
      else nodeEl.classList.add('ohs-graph-node-dimmed');
    }

    for (const lineEl of svgEl.querySelectorAll<SVGLineElement>('.ohs-graph-edge')) {
      const src = lineEl.getAttribute('data-source');
      const tgt = lineEl.getAttribute('data-target');
      if (src === path || tgt === path) lineEl.classList.add('ohs-graph-edge-highlighted');
      else lineEl.classList.add('ohs-graph-edge-dimmed');
    }
  }

  private clearExpandableLinkHighlight(svgEl: SVGSVGElement, layersEl: HTMLElement): void {
    for (const nodeEl of layersEl.querySelectorAll<HTMLElement>('.ohs-graph-node')) {
      nodeEl.classList.remove('ohs-graph-node-highlighted', 'ohs-graph-node-dimmed');
    }
    for (const lineEl of svgEl.querySelectorAll<SVGLineElement>('.ohs-graph-edge')) {
      lineEl.classList.remove('ohs-graph-edge-highlighted', 'ohs-graph-edge-dimmed');
    }
  }

  private renderDetails(): void {
    this.detailsEl.empty();
    if (!this.centerPath || !this.analysis) {
      this.detailsEl.createDiv({ cls: 'search-empty-state', text: 'Open a note to inspect it.' });
      return;
    }

    if (this.analysisTab === 'diagnostics') {
      this.renderDiagnostics();
      return;
    }

    const candidates = this.getVisibleListCandidates();
    if (candidates.length === 0) {
      this.detailsEl.createDiv({
        cls: 'search-empty-state',
        text: 'No actionable connections yet.',
      });
      return;
    }
    for (const candidate of candidates) this.renderCandidate(candidate);
  }

  private renderDiagnostics(): void {
    const stats = this.analysis!.stats;
    const unlinkedSemantic = this.semanticResults.filter(
      (result) => !this.isKnownNeighbour(result.path),
    ).length;
    const candidates = this.getCandidates();
    const missingShown = this.getVisibleListCandidates('missing').length;
    const bridgesShown = this.getVisibleListCandidates('bridges').length;
    const rawBridgeCount = candidates.filter((candidate) => candidate.kind === 'bridge').length;
    const hiddenBridgeSignals = Math.max(0, rawBridgeCount - bridgesShown);
    const priorityBridgeCount = candidates.filter(
      (candidate) =>
        candidate.kind === 'bridge' && isActionableStrength(strengthLabel(candidate.bridgeScore)),
    ).length;
    const groups = this.detailsEl.createDiv({ cls: 'ohs-workbench-stat-groups' });
    this.createStatGroup(groups, 'Link structure', 'network', [
      ['Outgoing links', stats.outgoing],
      ['Backlinks', stats.backlinks],
      ['Neighbour cohesion', `${Math.round(stats.clusteringCoefficient * 100)}%`],
    ]);
    this.createStatGroup(groups, 'Recommendations', 'sparkles', [
      ['Shown missing links', missingShown],
      ['Shown bridge candidates', bridgesShown],
      ['Priority bridges', priorityBridgeCount],
      ['Hidden bridge signals', hiddenBridgeSignals],
      ['Co-cited notes', this.analysis!.coCitations.length],
      ['Unlinked semantic matches', unlinkedSemantic],
    ]);
    this.createStatGroup(groups, 'Discovery inputs', 'search-check', [
      ['Semantic matches', this.semanticResults.length],
      ['Graph candidates', this.analysis!.predicted.length],
      ['Related traversal', this.relatedResults.length],
    ]);
    if (this.noteTextStats) {
      this.createStatGroup(groups, 'Text shape', 'file-text', [
        ['Words', this.noteTextStats.words],
        ['Pages', this.noteTextStats.pages.toFixed(1)],
        ['Reading time', `${this.noteTextStats.readingMinutes} min`],
        ['Quote blocks', this.noteTextStats.quoteBlocks],
        ['Callouts', this.noteTextStats.callouts],
        ['Paragraphs', this.noteTextStats.paragraphs],
        ['Headings', this.noteTextStats.headings],
        ['List items', this.noteTextStats.listItems],
      ]);
      this.createStatGroup(groups, 'Metadata', 'tags', [
        ['Frontmatter fields', this.noteTextStats.frontmatterFields],
        ['Tags', this.noteTextStats.tags],
        ['Aliases', this.noteTextStats.aliases],
      ]);
    }
  }

  private getVisibleListCandidates(tab: AnalysisTab = this.analysisTab): CandidateNote[] {
    const candidates = this.getCandidates();
    if (tab === 'best') {
      return this.getBestCandidates(candidates);
    }
    if (tab === 'missing') {
      return candidates
        .filter((candidate) => candidate.kind === 'missing' && candidate.linkabilityScore >= 0.22)
        .sort((a, b) => b.linkabilityScore - a.linkabilityScore || a.title.localeCompare(b.title))
        .slice(0, this.resultLimit);
    }
    if (tab === 'bridges') {
      return candidates
        .filter((candidate) => candidate.kind === 'bridge' && candidate.bridgeScore >= 0.18)
        .sort((a, b) => b.bridgeScore - a.bridgeScore || a.title.localeCompare(b.title))
        .slice(0, this.resultLimit);
    }
    if (tab === 'similar') {
      const byPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
      return this.semanticResults
        .map((result) => byPath.get(result.path.normalize('NFC')))
        .filter((candidate): candidate is CandidateNote => Boolean(candidate))
        .slice(0, this.resultLimit);
    }
    if (tab === 'neighbors') {
      return candidates.filter((candidate) => candidate.kind === 'neighbor');
    }
    if (tab === 'diagnostics') return candidates;
    return [];
  }

  private getBestCandidates(candidates: CandidateNote[]): CandidateNote[] {
    const sorted = candidates
      .filter((candidate) => candidate.bestActionScore >= 0.2)
      .filter((candidate) => candidate.kind !== 'neighbor' || candidate.bestActionScore >= 0.35)
      .sort((a, b) => b.bestActionScore - a.bestActionScore || a.title.localeCompare(b.title));
    const caps = new Map<CandidateNote['kind'], number>([
      ['missing', 4],
      ['bridge', 3],
      ['similar', 2],
      ['neighbor', 1],
      ['diagnostic', 0],
    ]);
    const counts = new Map<CandidateNote['kind'], number>();
    const selected: CandidateNote[] = [];
    for (const candidate of sorted) {
      const count = counts.get(candidate.kind) ?? 0;
      if (count >= (caps.get(candidate.kind) ?? 0)) continue;
      selected.push(candidate);
      counts.set(candidate.kind, count + 1);
      if (selected.length >= this.resultLimit) return selected;
    }
    for (const candidate of sorted) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= this.resultLimit) break;
    }
    return selected;
  }

  private getVisibleGraphCandidates(tab: AnalysisTab = this.analysisTab): CandidateNote[] {
    const list = this.getVisibleListCandidates(tab);
    if (tab === 'bridges') return list.slice(0, BRIDGE_GRAPH_LIMIT);
    return list;
  }

  private isCandidateOnMap(candidate: CandidateNote): boolean {
    if (this.analysisTab !== 'bridges') return false;
    const path = candidate.path.normalize('NFC');
    return this.getVisibleGraphCandidates('bridges').some(
      (item) => item.path.normalize('NFC') === path,
    );
  }

  private getVisibleCandidates(): CandidateNote[] {
    return this.getVisibleListCandidates();
  }

  private renderCandidate(candidate: CandidateNote): void {
    const item = this.createResultItem(candidate);
    this.createEvidenceLine(item, candidate);
    this.createMeta(item, candidate);
  }

  private createResultItem(candidate: CandidateNote): HTMLElement {
    const nfcPath = candidate.path.normalize('NFC');
    const isExpanded = this.expandedPaths.has(nfcPath);
    const resultKindClass =
      this.analysisTab === 'neighbors'
        ? 'ohs-workbench-result-link'
        : `ohs-workbench-result-${strengthClassName(this.getDisplayStrength(candidate))}`;
    const collapsedClass = isExpanded ? '' : ' is-collapsed';
    const item = this.detailsEl.createDiv({
      cls: `tree-item ohs-workbench-result ${resultKindClass}${collapsedClass}`,
    });
    item.dataset.path = nfcPath;
    item.dataset.sourcePath = this.centerPath ?? '';
    this.bindPathHover(item, nfcPath);
    const row = item.createDiv({
      cls: 'tree-item-self search-result-file-title ohs-workbench-row is-clickable',
    });
    row.dataset.path = nfcPath;
    row.dataset.sourcePath = this.centerPath ?? '';
    const collapseIcon = row.createDiv({
      cls: `tree-item-icon collapse-icon ohs-workbench-collapse${isExpanded ? '' : ' is-collapsed'}`,
    });
    collapseIcon.dataset.path = nfcPath;
    collapseIcon.setAttribute('aria-label', isExpanded ? 'Collapse result' : 'Expand result');
    setIcon(collapseIcon, 'right-triangle');
    createTreeItemLink(
      this.app,
      row,
      candidate.path,
      candidate.title,
      'ohs-workbench-link',
      this.centerPath ?? '',
    );
    if (this.analysisTab === 'best') {
      const kindIcon = getBestKindIcon(candidate.kind);
      const flairOuter = row.createDiv({ cls: 'tree-item-flair-outer' });
      const flair = flairOuter.createDiv({
        cls: 'tree-item-flair ohs-workbench-flair ohs-workbench-kind-flair',
      });
      const iconEl = flair.createSpan({ cls: 'ohs-workbench-kind-flair-icon' });
      setIcon(iconEl, kindIcon);
    } else {
      const displayScore = this.getCandidateDisplayScore(candidate);
      if (displayScore) {
        const flairOuter = row.createDiv({ cls: 'tree-item-flair-outer' });
        flairOuter.createDiv({
          cls: 'tree-item-flair ohs-workbench-flair',
          text: displayScore,
        });
      }
    }
    return item;
  }

  private createEvidenceLine(parent: HTMLElement, candidate: CandidateNote): void {
    const line = parent.createDiv({ cls: 'ohs-workbench-evidence-line' });
    if (this.analysisTab !== 'neighbors') {
      const displayStrength = this.getDisplayStrength(candidate);
      line.createSpan({
        cls: `ohs-workbench-strength ohs-workbench-strength-${strengthClassName(displayStrength)}`,
        text: this.getDisplayStrengthLabel(candidate, displayStrength),
      });
    }
    if (this.isCandidateOnMap(candidate)) {
      const chip = line.createSpan({
        cls: 'ohs-workbench-chip ohs-workbench-map-chip',
        attr: { title: 'Shown on the bridge map above' },
      });
      const iconEl = chip.createSpan({ cls: 'ohs-workbench-map-chip-icon' });
      setIcon(iconEl, 'map-pin');
      chip.createSpan({ text: 'on map' });
    }
    for (const evidence of this.getVisibleEvidence(candidate)) {
      this.createEvidenceChip(line, evidence, candidate);
    }
  }

  private createEvidenceChip(
    parent: HTMLElement,
    evidence: string,
    candidate: CandidateNote,
  ): void {
    const direction = getDirectionEvidence(evidence);
    if (!direction) {
      parent.createSpan({
        cls: 'ohs-workbench-chip',
        text: this.getDisplayEvidence(evidence, candidate),
      });
      return;
    }

    const chip = parent.createSpan({
      cls: `ohs-workbench-chip ohs-workbench-direction-chip ohs-workbench-direction-${direction}`,
      attr: { title: getDirectionTitle(direction) },
    });
    const iconEl = chip.createSpan({ cls: 'ohs-workbench-direction-icon' });
    setIcon(iconEl, getDirectionIcon(direction));
    chip.createSpan({ text: this.getDisplayEvidence(evidence, candidate) });
  }

  private createMeta(parent: HTMLElement, candidate: CandidateNote): void {
    if (!this.expandedPaths.has(candidate.path.normalize('NFC'))) return;
    const matches = parent.createDiv({
      cls: 'search-result-file-matches',
      attr: { 'data-source-path': candidate.path.normalize('NFC') },
    });
    const match = matches.createDiv({
      cls: 'search-result-file-match tappable ohs-workbench-row-meta',
      attr: { 'data-source-path': candidate.path.normalize('NFC') },
    });
    if (this.analysisTab !== 'neighbors' && candidate.expandedEvidence.length > 0) {
      const metrics = match.createDiv({ cls: 'ohs-workbench-expanded-metrics' });
      metrics.textContent = candidate.expandedEvidence.join(' · ');
    }
    if (this.analysisTab === 'neighbors' && candidate.existingDirectLink) {
      this.createLinkContextSnippet(match, candidate);
    } else if (candidate.snippet) {
      const snippet = match.createDiv({
        cls: 'ohs-workbench-expanded-text ohs-workbench-snippet',
      });
      snippet.dataset.path = candidate.path.normalize('NFC');
      snippet.setAttribute('role', 'button');
      snippet.setAttribute('tabindex', '0');
      snippet.setAttribute('aria-label', `Open ${candidate.title} at matching snippet`);
      snippet.textContent = candidate.snippet;
    }
  }

  private createLinkContextSnippet(parent: HTMLElement, candidate: CandidateNote): void {
    const requestId = this.requestId;
    const centerPath = this.centerPath;
    const analysisTab = this.analysisTab;
    const candidatePath = candidate.path.normalize('NFC');
    const snippet = parent.createDiv({
      cls: 'ohs-workbench-expanded-text ohs-workbench-snippet',
    });
    snippet.setAttribute('role', 'button');
    snippet.setAttribute('tabindex', '0');
    snippet.textContent = 'Loading link context...';
    void this.loadLinkContext(candidate)
      .then((context) => {
        if (
          requestId !== this.requestId ||
          centerPath !== this.centerPath ||
          analysisTab !== this.analysisTab ||
          candidatePath !== candidate.path.normalize('NFC')
        ) {
          return;
        }
        if (!snippet.parentElement) return;
        if (!context) {
          snippet.removeAttribute('role');
          snippet.removeAttribute('tabindex');
          snippet.textContent = 'No link context found in Obsidian cache.';
          return;
        }
        snippet.dataset.path = context.sourcePath;
        snippet.dataset.line = String(context.line);
        snippet.setAttribute('aria-label', `Open ${context.sourceTitle} at link context`);
        snippet.textContent = context.text;
      })
      .catch(() => {
        if (
          requestId !== this.requestId ||
          centerPath !== this.centerPath ||
          analysisTab !== this.analysisTab ||
          candidatePath !== candidate.path.normalize('NFC')
        ) {
          return;
        }
        if (!snippet.parentElement) return;
        snippet.removeAttribute('role');
        snippet.removeAttribute('tabindex');
        snippet.textContent = 'No link context found in Obsidian cache.';
      });
  }

  private createStat(parent: HTMLElement, label: string, value: string | number): void {
    const card = parent.createDiv({ cls: 'ohs-workbench-stat' });
    card.createDiv({ cls: 'ohs-workbench-stat-value', text: String(value) });
    card.createDiv({ cls: 'ohs-workbench-stat-label', text: label });
  }

  private createStatGroup(
    parent: HTMLElement,
    title: string,
    icon: string,
    stats: Array<[label: string, value: string | number]>,
  ): void {
    const group = parent.createDiv({ cls: 'ohs-workbench-stat-group' });
    const titleEl = group.createDiv({ cls: 'ohs-workbench-stat-group-title' });
    const iconEl = titleEl.createSpan({ cls: 'ohs-workbench-stat-group-icon' });
    setIcon(iconEl, icon);
    titleEl.createSpan({ text: title });
    const grid = group.createDiv({ cls: 'ohs-workbench-stats' });
    for (const [label, value] of stats) this.createStat(grid, label, value);
  }

  private bindPathHover(element: HTMLElement, path: string): void {
    const nfcPath = path.normalize('NFC');
    element.addEventListener('mouseenter', () => this.setPathHover(nfcPath, true));
    element.addEventListener('mouseleave', () => this.setPathHover(nfcPath, false));
  }

  private setPathHover(path: string, active: boolean): void {
    const nfcPath = path.normalize('NFC');
    const targets = this.containerEl.querySelectorAll<HTMLElement>(
      '.ohs-workbench-result[data-path], .ohs-workbench-node-item[data-path], .ohs-graph-node-item[data-path]',
    );
    for (const target of targets) {
      if (target.dataset.path?.normalize('NFC') !== nfcPath) continue;
      target.classList.toggle('is-path-hovered', active);
      target
        .closest<HTMLElement>(
          '.ohs-workbench-node-item, .ohs-graph-node-item, .ohs-workbench-result',
        )
        ?.classList.toggle('is-path-hovered', active);
    }
  }

  private getVisibleEvidence(candidate: CandidateNote): string[] {
    if (this.analysisTab === 'neighbors') {
      return candidate.direction === 'none' ? [] : [candidate.direction];
    }
    if (this.analysisTab === 'similar') {
      if (this.similarNotesScoreMode === 'structural') {
        const evidence = candidate.evidence
          .filter((item) => item !== 'semantic' && item !== 'structural')
          .slice(0, 3);
        return evidence.length > 0 ? evidence : ['structural'];
      }
      const evidence = candidate.semantic > 0 ? ['semantic'] : [];
      if (candidate.direction !== 'none') evidence.push(candidate.direction);
      return evidence;
    }
    return candidate.evidence.slice(0, 4);
  }

  private getCandidateDisplayScore(candidate: CandidateNote): string {
    if (this.analysisTab === 'neighbors') return '';
    if (this.analysisTab === 'similar' && this.similarNotesScoreMode === 'structural') return '';
    return this.getCandidateScoreForTab(candidate, this.analysisTab).toFixed(2);
  }

  private getDisplayStrength(candidate: CandidateNote): CandidateNote['strengthLabel'] {
    return strengthLabel(this.getCandidateScoreForTab(candidate, this.analysisTab));
  }

  private getCandidateScoreForTab(candidate: CandidateNote, tab: AnalysisTab): number {
    if (tab === 'similar' && candidate.semantic > 0) return candidate.semantic;
    if (tab === 'missing') return candidate.linkabilityScore;
    if (tab === 'bridges') return candidate.bridgeScore;
    if (tab === 'best') return candidate.bestActionScore;
    return candidate.utilityScore;
  }

  private getGraphCandidateKind(candidate: CandidateNote): GraphNodeKind {
    if (this.analysisTab === 'similar' && this.similarNotesScoreMode === 'similarity') {
      return 'semantic';
    }
    if (this.analysisTab === 'similar' && this.similarNotesScoreMode === 'structural') {
      return candidate.kind === 'neighbor' ? 'neighbor' : 'bridge';
    }
    if (this.analysisTab === 'neighbors' || this.analysisTab === 'diagnostics') {
      return getCandidateGraphNodeKind(candidate);
    }
    if (candidate.kind === 'bridge') return 'bridge';
    if (candidate.kind === 'missing') return 'missing';
    return 'semantic';
  }

  private getDisplayStrengthLabel(
    candidate: CandidateNote,
    strength: CandidateNote['strengthLabel'],
  ): string {
    if (this.analysisTab === 'similar') {
      if (strength === 'Very Strong' || strength === 'Strong') return 'Close';
      if (strength === 'Medium') return 'Related';
      return 'Loose';
    }
    if (this.analysisTab === 'missing') {
      if (strength === 'Very Strong' || strength === 'Strong') return 'Link candidate';
      if (strength === 'Medium') return 'Possible link';
      return 'Semantic lead';
    }
    if (this.analysisTab === 'best') {
      if (candidate.kind === 'missing') return 'Add link';
      if (candidate.kind === 'bridge') return 'Bridge';
      if (candidate.kind === 'neighbor') return 'Linked';
      if (candidate.kind === 'similar') return 'Compare';
    }
    if (this.analysisTab === 'bridges' || candidate.kind === 'bridge') {
      if (strength === 'Very Strong' || strength === 'Strong') return 'Strong bridge';
      if (strength === 'Medium') return 'Bridge';
      return 'Weak bridge';
    }
    return strength;
  }

  private getSupportSummary(candidate: CandidateNote): string {
    const parts: string[] = [];
    if (candidate.semantic > 0) parts.push(`semantic ${candidate.semantic.toFixed(2)}`);
    if (candidate.commonNeighbours > 0) {
      parts.push(
        `${candidate.commonNeighbours} shared ${candidate.commonNeighbours === 1 ? 'neighbour' : 'neighbours'}`,
      );
    }
    if (candidate.coCitations > 0) parts.push(`co-cited x${candidate.coCitations}`);
    if (candidate.cosine > 0) parts.push(`graph cosine ${candidate.cosine.toFixed(2)}`);
    return parts.slice(0, 3).join(' + ');
  }

  private getDisplayEvidence(evidence: string, candidate: CandidateNote): string {
    if (evidence === 'semantic' && candidate.semantic > 0) {
      return `semantic ${candidate.semantic.toFixed(2)}`;
    }
    if (evidence === 'structural') return 'structural fallback';
    if (evidence === 'two-hop' && candidate.cosine > 0) {
      return `cosine ${candidate.cosine.toFixed(2)}`;
    }
    if (evidence === 'fulltext') return 'fulltext';
    if (evidence === 'title') return 'title';
    if (evidence === 'backlink') return 'Backlink';
    if (evidence === 'outgoing') return 'Outgoing link';
    if (evidence === 'bidirectional') return 'Bidirectional link';
    return evidence;
  }

  private hookWorkbenchLinks(containerEl: HTMLElement): () => void {
    const getSourcePath = (targetEl?: HTMLElement | null): string =>
      targetEl?.closest<HTMLElement>('[data-source-path]')?.dataset.sourcePath ??
      this.centerPath ??
      '';
    return hookInternalLinks(containerEl, this.app, getSourcePath, {
      onHoverPreview: (evt, targetEl, href) => {
        const sourcePath = getSourcePath(targetEl);
        // @ts-ignore - hover-link is not typed in the public Obsidian API.
        this.app.workspace.trigger('hover-link', {
          event: evt,
          source: GRAPH_WORKBENCH_VIEW_TYPE,
          hoverParent: { hoverPopover: null },
          targetEl,
          linktext: href,
          sourcePath,
        });
      },
      onOpenFile: (file, background) => {
        if (background) {
          // @ts-ignore - 'tab' is a valid PaneType in modern Obsidian.
          void this.app.workspace.getLeaf('tab').openFile(file, { active: false });
        } else {
          void this.app.workspace.getLeaf(false).openFile(file);
        }
      },
    });
  }

  private applyExpandedLinkNodes(graphData: GraphData): void {
    const index = this.graphIndex ?? buildGraphIndex(this.app);
    const nodes = new Map(graphData.nodes.map((node) => [node.path, node]));
    const edges = new Set(graphData.edges.map((edge) => `${edge.source}\x00${edge.target}`));

    for (const path of this.expandedGraphPaths) {
      const base = nodes.get(path);
      if (!base) continue;

      if (base.depth < 0) {
        for (const source of getBacklinksFromIndex(index, path)) {
          this.addExpandedLinkEdge(graphData, nodes, edges, source, path, base.depth - 1);
        }
      } else {
        for (const target of getOutgoingFromIndex(index, path)) {
          this.addExpandedLinkEdge(graphData, nodes, edges, path, target, base.depth + 1);
        }
      }
    }
  }

  private addExpandedLinkEdge(
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
    if (!nodes.has(source)) missingPath = source;
    else if (!nodes.has(target)) missingPath = target;
    if (!missingPath) return;

    const node = {
      path: missingPath,
      depth: newNodeDepth,
      title: getTitle(this.app, missingPath),
    };
    graphData.nodes.push(node);
    nodes.set(missingPath, node);
  }

  private handleDetailsClick(evt: Event): void {
    const mouseEvt = evt as MouseEvent;
    const snippet = (mouseEvt.target as HTMLElement).closest<HTMLElement>('.ohs-workbench-snippet');
    if (snippet?.dataset.path) {
      mouseEvt.preventDefault();
      mouseEvt.stopPropagation();
      const line = Number(snippet.dataset.line);
      if (Number.isInteger(line) && line >= 0) {
        this.openPathAtLine(snippet.dataset.path, line, mouseEvt.ctrlKey || mouseEvt.metaKey);
        return;
      }
      void this.openCandidateAtSnippet(snippet.dataset.path, mouseEvt.ctrlKey || mouseEvt.metaKey);
      return;
    }
    const collapseIcon = (mouseEvt.target as HTMLElement).closest<HTMLElement>(
      '.ohs-workbench-collapse',
    );
    if (collapseIcon?.dataset.path) {
      mouseEvt.preventDefault();
      mouseEvt.stopPropagation();
      this.toggleResult(collapseIcon.dataset.path);
      return;
    }
    if ((mouseEvt.target as HTMLElement).closest<HTMLElement>('[data-href], a')) return;
    const row = (mouseEvt.target as HTMLElement).closest<HTMLElement>('.ohs-workbench-row');
    const path = row?.dataset.path;
    if (!path) return;
    mouseEvt.preventDefault();
    openResult(this.app, path, mouseEvt.ctrlKey || mouseEvt.metaKey);
  }

  private handleDetailsKeydown(evt: KeyboardEvent): void {
    const snippet = (evt.target as HTMLElement).closest<HTMLElement>('.ohs-workbench-snippet');
    if (!snippet?.dataset.path || (evt.key !== 'Enter' && evt.key !== ' ')) return;
    evt.preventDefault();
    const line = Number(snippet.dataset.line);
    if (Number.isInteger(line) && line >= 0) {
      this.openPathAtLine(snippet.dataset.path, line, evt.ctrlKey || evt.metaKey);
      return;
    }
    void this.openCandidateAtSnippet(snippet.dataset.path, evt.ctrlKey || evt.metaKey);
  }

  private toggleResult(path: string): void {
    const nfcPath = path.normalize('NFC');
    if (this.expandedPaths.has(nfcPath)) this.expandedPaths.delete(nfcPath);
    else this.expandedPaths.add(nfcPath);
    this.renderDetails();
  }

  private async openCandidateAtSnippet(path: string, newLeaf: boolean): Promise<void> {
    const nfcPath = path.normalize('NFC');
    const candidate = this.getCandidates().find((item) => item.path === nfcPath);
    const abstract = this.app.vault.getAbstractFileByPath(nfcPath);
    if (!(abstract instanceof TFile)) return;
    const target = newLeaf
      ? this.app.workspace.getLeaf('tab')
      : (this.app.workspace.getLeavesOfType('markdown').find((leaf) => leaf !== this.leaf) ??
        this.app.workspace.getLeaf('tab'));
    const openState = candidate ? await this.getSnippetOpenState(abstract, candidate) : undefined;
    void target.openFile(abstract, openState);
  }

  private openPathAtLine(path: string, line: number, newLeaf: boolean): void {
    const abstract = this.app.vault.getAbstractFileByPath(path.normalize('NFC'));
    if (!(abstract instanceof TFile)) return;
    const target = newLeaf
      ? this.app.workspace.getLeaf('tab')
      : (this.app.workspace.getLeavesOfType('markdown').find((leaf) => leaf !== this.leaf) ??
        this.app.workspace.getLeaf('tab'));
    void target.openFile(abstract, {
      active: true,
      eState: {
        line,
        cursor: {
          from: { line, ch: 0 },
          to: { line, ch: 0 },
        },
      },
    });
  }

  private async getSnippetOpenState(
    file: TFile,
    candidate: CandidateNote,
  ): Promise<Parameters<WorkspaceLeaf['openFile']>[1] | undefined> {
    const anchor = getPrimaryAnchor(candidate);
    if (!anchor) return undefined;
    try {
      const content = await this.app.vault.cachedRead(file);
      const startOffset = getAnchorOffset(content, anchor);
      if (startOffset < 0) return undefined;
      const endOffset =
        typeof anchor.charEnd === 'number' && anchor.charEnd >= startOffset
          ? anchor.charEnd
          : startOffset;
      const from = offsetToEditorPosition(content, startOffset);
      const to = offsetToEditorPosition(content, endOffset);
      return {
        active: true,
        eState: {
          line: from.line,
          cursor: { from, to },
        },
      };
    } catch {
      return undefined;
    }
  }

  private async loadLinkContext(candidate: CandidateNote): Promise<{
    sourcePath: string;
    sourceTitle: string;
    line: number;
    text: string;
  } | null> {
    if (!this.centerPath) return null;
    const sourcePath =
      candidate.direction === 'outgoing' ? this.centerPath : candidate.path.normalize('NFC');
    const targetPath =
      candidate.direction === 'outgoing' ? candidate.path.normalize('NFC') : this.centerPath;
    const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof TFile)) return null;

    const cache = this.app.metadataCache.getFileCache(sourceFile);
    const references = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
    const content = await this.app.vault.cachedRead(sourceFile);
    const link = references.find((item) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
      return dest?.path.normalize('NFC') === targetPath;
    });

    const fallbackLine = link ? null : findWikiLinkLine(content, sourcePath, targetPath, this.app);
    if (!link && !fallbackLine) return null;

    const line = link?.position.start.line ?? fallbackLine!.line;
    const lines = content.split(/\r?\n/);
    const rawLine = lines[line] ?? '';
    const text =
      rawLine.trim() ||
      extractInlineContext(content, link?.position.start.offset ?? fallbackLine?.offset ?? 0);
    return {
      sourcePath,
      sourceTitle: getTitle(this.app, sourcePath),
      line,
      text,
    };
  }

  private createIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: 'clickable-icon ohs-workbench-icon-btn',
      attr: { type: 'button', 'aria-label': label, title: label },
    });
    setIcon(button, icon);
    this.registerDomEvent(button, 'click', (evt) => {
      evt.preventDefault();
      onClick();
    });
    return button;
  }

  private getCandidates(): CandidateNote[] {
    if (this.candidateCache) return this.candidateCache;
    if (!this.centerPath || !this.analysis || !this.graphIndex) return [];
    const candidates = new Map<string, CandidateNote>();
    const outgoing = getOutgoingFromIndex(this.graphIndex, this.centerPath);
    const backlinks = getBacklinksFromIndex(this.graphIndex, this.centerPath);

    const ensureCandidate = (path: string): CandidateNote => {
      const nfcPath = path.normalize('NFC');
      const outgoingLink = outgoing.has(nfcPath);
      const backlink = backlinks.has(nfcPath);
      const direction = getConnectionDirection(outgoingLink, backlink);
      const existing =
        candidates.get(nfcPath) ??
        ({
          path: nfcPath,
          title: getTitle(this.app, nfcPath),
          utilityScore: 0,
          bestActionScore: 0,
          linkabilityScore: 0,
          bridgeScore: 0,
          structuralScore: 0,
          searchSignalScore: 0,
          strengthLabel: 'Noise',
          evidence: [],
          expandedEvidence: [],
          kind: 'similar',
          semantic: 0,
          existingDirectLink: direction !== 'none',
          direction,
          relatedTraversal: false,
          commonNeighbours: 0,
          coCitations: 0,
          jaccard: 0,
          adamicAdar: 0,
          resourceAllocation: 0,
          preferentialAttachment: 0,
          cosine: 0,
        } satisfies CandidateNote);
      candidates.set(nfcPath, existing);
      return existing;
    };

    for (const path of [...outgoing, ...backlinks]) {
      const candidate = ensureCandidate(path);
      candidate.kind = 'neighbor';
      candidate.evidence.push(candidate.direction);
      candidate.expandedEvidence.push(`Existing ${candidate.direction} connection.`);
    }

    for (const result of this.semanticResults) {
      const candidate = ensureCandidate(result.path);
      candidate.snippet = result.snippet;
      candidate.previewAnchors = result.previewAnchors;
      candidate.primaryAnchorIndex = result.primaryAnchorIndex;
      if (this.similarNotesScoreMode === 'similarity') {
        candidate.semantic = Math.max(candidate.semantic, result.score);
        candidate.evidence.push('semantic');
        for (const signal of getSearchMatchSignals(result)) candidate.evidence.push(signal);
        candidate.expandedEvidence.push(`Semantic similarity ${result.score.toFixed(2)}.`);
        const searchBreakdown = formatSearchBreakdown(result);
        if (searchBreakdown) candidate.expandedEvidence.push(searchBreakdown);
      } else {
        candidate.relatedTraversal = true;
        candidate.evidence.push('structural');
        candidate.expandedEvidence.push('Found by structural fallback.');
      }
    }

    for (const item of this.analysis.predicted) {
      const candidate = ensureCandidate(item.path);
      candidate.commonNeighbours = item.commonNeighbours;
      candidate.jaccard = item.jaccard;
      candidate.adamicAdar = item.adamicAdar;
      candidate.resourceAllocation = item.resourceAllocation;
      candidate.preferentialAttachment = item.preferentialAttachment;
      candidate.cosine = item.cosine;
      candidate.evidence.push(`${item.commonNeighbours} common`);
      candidate.evidence.push('two-hop');
      if (item.adamicAdar >= 0.75) candidate.evidence.push(`adamic ${item.adamicAdar.toFixed(2)}`);
      if (item.resourceAllocation >= 0.35) {
        candidate.evidence.push(`resource ${item.resourceAllocation.toFixed(2)}`);
      }
      candidate.expandedEvidence.push(
        `${item.commonNeighbours} common neighbours; Jaccard ${item.jaccard.toFixed(2)}; Adamic ${item.adamicAdar.toFixed(2)}; Resource ${item.resourceAllocation.toFixed(2)}; Cosine ${item.cosine.toFixed(2)}; Preferential ${item.preferentialAttachment}.`,
      );
    }

    for (const item of this.analysis.coCitations) {
      const candidate = ensureCandidate(item.path);
      candidate.coCitations = item.count;
      candidate.evidence.push(`co-cited x${item.count}`);
      candidate.expandedEvidence.push(
        `Co-cited with current note in ${item.sources.map((path) => getTitle(this.app, path)).join(', ')}.`,
      );
    }

    for (const result of this.relatedResults) {
      const candidate = ensureCandidate(result.path);
      if (candidate.kind === 'similar')
        candidate.kind = candidate.existingDirectLink ? 'neighbor' : 'bridge';
      candidate.relatedTraversal = true;
      candidate.expandedEvidence.push('Found by local graph traversal.');
    }

    this.candidateCache = [...candidates.values()]
      .filter((candidate) => candidate.path !== this.centerPath)
      .filter((candidate) => !this.dismissedPaths.has(candidate.path))
      .map((candidate) => this.finalizeCandidate(candidate))
      .sort((a, b) => b.utilityScore - a.utilityScore || a.title.localeCompare(b.title));
    return this.candidateCache;
  }

  private finalizeCandidate(candidate: CandidateNote): CandidateNote {
    candidate.evidence = unique(candidate.evidence).filter(Boolean);
    candidate.expandedEvidence = unique(candidate.expandedEvidence).filter(Boolean);
    candidate.kind = this.classifyCandidate(candidate);
    const structural = this.getStructuralScore(candidate);
    const searchSignal = this.getSearchSignalScore(candidate);
    const noisePenalty = isNoisyPath(candidate.path) ? 0.12 : 0;
    candidate.structuralScore = structural;
    candidate.searchSignalScore = searchSignal;
    candidate.linkabilityScore = clamp01(
      candidate.semantic * 0.62 +
        structural * 0.22 +
        searchSignal * 0.42 +
        Math.min(candidate.coCitations * 0.04, 0.12) -
        (candidate.existingDirectLink ? 0.35 : 0) -
        noisePenalty,
    );
    candidate.bridgeScore = clamp01(
      structural * 0.68 +
        Math.min(candidate.commonNeighbours * 0.08, 0.24) +
        Math.min(candidate.coCitations * 0.1, 0.24) +
        candidate.semantic * 0.12 +
        (candidate.relatedTraversal ? 0.06 : 0) -
        (candidate.existingDirectLink ? 0.22 : 0) -
        noisePenalty,
    );
    const semanticCompareScore = clamp01(candidate.semantic * 0.72 - noisePenalty);
    const neighborScore = clamp01(
      (candidate.existingDirectLink ? 0.24 : 0) +
        candidate.semantic * 0.3 +
        Math.min(candidate.coCitations * 0.06, 0.18) -
        noisePenalty,
    );
    candidate.bestActionScore = clamp01(
      Math.max(
        candidate.linkabilityScore,
        candidate.bridgeScore * 0.95,
        semanticCompareScore,
        neighborScore,
      ),
    );
    candidate.utilityScore = getPrimaryUtilityScore(candidate, neighborScore, semanticCompareScore);
    candidate.strengthLabel = strengthLabel(candidate.utilityScore);
    if (candidate.kind === 'similar' && !candidate.existingDirectLink) {
      candidate.evidence.push('missing link');
    }
    return candidate;
  }

  private classifyCandidate(candidate: CandidateNote): CandidateNote['kind'] {
    if (candidate.existingDirectLink) return 'neighbor';
    const hasSemantic = candidate.semantic > 0;
    const highSemantic = candidate.semantic >= 0.7;
    const supportedSemantic = candidate.semantic >= 0.56;
    const hasPathSignal = candidate.relatedTraversal;
    const hasCoCitation = candidate.coCitations > 0;
    const hasSearchSignal = this.getSearchSignalScore(candidate) > 0;
    const hasGraphSignal =
      candidate.commonNeighbours > 0 ||
      candidate.adamicAdar > 0 ||
      candidate.resourceAllocation > 0 ||
      candidate.jaccard > 0 ||
      candidate.cosine >= 0.15;
    const bridgeSignal =
      candidate.commonNeighbours >= 2 ||
      candidate.coCitations >= 2 ||
      candidate.adamicAdar >= 1 ||
      candidate.resourceAllocation >= 0.5 ||
      candidate.cosine >= 0.45;

    if (
      highSemantic ||
      (supportedSemantic &&
        (hasSearchSignal || hasGraphSignal || hasCoCitation || hasPathSignal)) ||
      (candidate.semantic >= 0.5 && hasSearchSignal) ||
      (hasCoCitation && hasGraphSignal)
    ) {
      return 'missing';
    }
    if (bridgeSignal && (candidate.commonNeighbours >= 2 || hasCoCitation || hasSemantic)) {
      return 'bridge';
    }
    if (hasSemantic) return 'similar';
    if (
      hasGraphSignal ||
      hasCoCitation ||
      (hasPathSignal && (candidate.commonNeighbours > 0 || hasCoCitation))
    ) {
      return 'bridge';
    }
    return 'diagnostic';
  }

  private getStructuralScore(candidate: CandidateNote): number {
    return clamp01(
      candidate.commonNeighbours * 0.14 +
        candidate.adamicAdar * 0.1 +
        candidate.resourceAllocation * 0.1 +
        candidate.cosine * 0.18 +
        Math.log1p(candidate.preferentialAttachment) * 0.025 +
        candidate.coCitations * 0.08 +
        (candidate.existingDirectLink ? 0.25 : 0),
    );
  }

  private getSearchSignalScore(candidate: CandidateNote): number {
    let score = 0;
    if (candidate.evidence.includes('title')) score += 0.2;
    if (candidate.evidence.includes('fulltext')) score += 0.1;
    return clamp01(score);
  }

  private isKnownNeighbour(path: string): boolean {
    return this.centerPath && this.graphIndex
      ? getNeighboursFromIndex(this.graphIndex, this.centerPath).has(path.normalize('NFC'))
      : false;
  }
}

export async function revealGraphWorkbench(plugin: HybridSearchPlugin): Promise<void> {
  const existing = plugin.app.workspace.getLeavesOfType(GRAPH_WORKBENCH_VIEW_TYPE)[0];
  const leaf = existing ?? plugin.app.workspace.getRightLeaf(false);
  if (!leaf) {
    new Notice('Hybrid search: could not open graph workbench.');
    return;
  }
  await leaf.setViewState({ type: GRAPH_WORKBENCH_VIEW_TYPE, active: true });
  const workspace = plugin.app.workspace as unknown as {
    revealLeaf?: (workspaceLeaf: WorkspaceLeaf) => void | Promise<void>;
  };
  await workspace.revealLeaf?.(leaf);
  if (leaf.view instanceof GraphWorkbenchView) await leaf.view.refreshFromActiveFile(true);
}

function layoutStructuredNodes(nodes: Array<Omit<WorkbenchNode, 'x' | 'y'>>): WorkbenchNode[] {
  const center = nodes.find((node) => node.kind === 'center');
  const incoming = nodes
    .filter((node) => node.kind === 'neighbor' && (node.depth ?? 1) < 0)
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  const outgoing = nodes
    .filter((node) => node.kind === 'neighbor' && (node.depth ?? 1) >= 0)
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  const recommendations = nodes.filter(
    (node) => node.kind !== 'center' && node.kind !== 'neighbor',
  );
  const rows: Array<Array<Omit<WorkbenchNode, 'x' | 'y'>>> = [];
  const maxPerRow = Math.max(
    1,
    Math.floor((GRAPH_WIDTH - GRAPH_NODE_GAP_X * 2) / (GRAPH_NODE_WIDTH + GRAPH_NODE_GAP_X)),
  );
  for (let index = 0; index < incoming.length; index += maxPerRow)
    rows.push(incoming.slice(index, index + maxPerRow));
  if (center) rows.push([center]);
  for (let index = 0; index < outgoing.length; index += maxPerRow)
    rows.push(outgoing.slice(index, index + maxPerRow));
  for (let index = 0; index < recommendations.length; index += maxPerRow) {
    rows.push(recommendations.slice(index, index + maxPerRow));
  }

  const totalRowsHeight =
    rows.length * GRAPH_NODE_HEIGHT + Math.max(0, rows.length - 1) * GRAPH_ROW_GAP_Y;
  const firstY = Math.max(
    GRAPH_NODE_HEIGHT / 2 + 8,
    (GRAPH_HEIGHT - totalRowsHeight) / 2 + GRAPH_NODE_HEIGHT / 2,
  );
  const positioned: WorkbenchNode[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    const y = firstY + rowIndex * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP_Y);
    const rowWidth = row.length * GRAPH_NODE_WIDTH + Math.max(0, row.length - 1) * GRAPH_NODE_GAP_X;
    const firstX = (GRAPH_WIDTH - rowWidth) / 2 + GRAPH_NODE_WIDTH / 2;
    for (let index = 0; index < row.length; index++) {
      positioned.push({
        ...row[index]!,
        x: firstX + index * (GRAPH_NODE_WIDTH + GRAPH_NODE_GAP_X),
        y,
      });
    }
  }
  return positioned;
}

function getGraphHeight(nodes: WorkbenchNode[]): number {
  const maxNodeY = nodes.reduce((max, node) => Math.max(max, node.y), 0);
  return Math.max(GRAPH_HEIGHT, Math.ceil(maxNodeY + GRAPH_NODE_HEIGHT / 2 + 16));
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function extractInlineContext(content: string, offset: number): string {
  const safeOffset = Math.max(0, Math.min(content.length, offset));
  const start = Math.max(0, safeOffset - 140);
  const end = Math.min(content.length, safeOffset + 180);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function findWikiLinkLine(
  content: string,
  sourcePath: string,
  targetPath: string,
  app: App,
): { line: number; offset: number } | null {
  const lines = content.split(/\r?\n/);
  let offset = 0;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? '';
    const wikiRegexp = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    for (const match of text.matchAll(wikiRegexp)) {
      const linkpath = match[1]?.trim();
      if (!linkpath) continue;
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      if (dest?.path.normalize('NFC') === targetPath) {
        return { line, offset: offset + (match.index ?? 0) };
      }
    }
    const markdownRegexp = /!?\[[^\]]+\]\((?![a-z][a-z0-9+.-]*:)([^)#]+)(?:#[^)]*)?\)/gi;
    for (const match of text.matchAll(markdownRegexp)) {
      const linkpath = safeDecodeLinkpath(match[1]?.trim() ?? '').replace(/\.md$/i, '');
      if (!linkpath) continue;
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      if (dest?.path.normalize('NFC') === targetPath) {
        return { line, offset: offset + (match.index ?? 0) };
      }
    }
    offset += text.length + 1;
  }
  return null;
}

function safeDecodeLinkpath(linkpath: string): string {
  try {
    return decodeURIComponent(linkpath);
  } catch {
    return linkpath;
  }
}

export function computeNoteTextStats(
  content: string,
  frontmatter?: Record<string, unknown>,
): NoteTextStats {
  const body = stripFrontmatter(content);
  const visibleBody = normalizeVisibleMarkdown(body);
  const cjkCharacters = countCjkCharacters(visibleBody);
  const wordText = visibleBody.replace(CJK_CHARACTER_PATTERN, ' ');
  const words = wordText.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  const characters = visibleBody.replace(/\s/g, '').length;
  const headings = body.match(/^\s*#{1,6}\s+\S.*$/gm)?.length ?? 0;
  const listItems = body.match(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\S.*$/gm)?.length ?? 0;
  const quoteBlocks = countQuoteBlocks(body);
  const callouts = countCalloutBlocks(body);
  const paragraphs = visibleBody
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter((part) => Boolean(part.replace(/^#+\s+/gm, '').trim())).length;
  const frontmatterFields = frontmatter ? Object.keys(frontmatter).length : 0;
  const frontmatterTags = countFrontmatterValues(frontmatter?.['tags'] ?? frontmatter?.['tag']);
  const inlineTags = new Set(
    Array.from(visibleBody.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu), (match) => match[2]),
  ).size;
  const aliases = countFrontmatterValues(frontmatter?.['aliases'] ?? frontmatter?.['alias']);
  const readingMinutes = Math.max(
    1,
    Math.ceil(words / WORDS_PER_MINUTE + cjkCharacters / CJK_CHARS_PER_MINUTE),
  );
  const pages = (words + cjkCharacters) / WORDS_PER_PAGE;
  return {
    words,
    characters,
    cjkCharacters,
    pages,
    readingMinutes,
    headings,
    listItems,
    paragraphs,
    quoteBlocks,
    callouts,
    frontmatterFields,
    tags: frontmatterTags + inlineTags,
    aliases,
  };
}

const CJK_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

function normalizeVisibleMarkdown(content: string): string {
  return content
    .replace(/(^|\n)(```|~~~)[\s\S]*?(?:\n\2[ \t]*(?=\n|$)|$)/g, '\n')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/!\[[^\]]*?\]\([^)]+?\)/g, ' ')
    .replace(/\[([^\]]*?)\]\([^)]+?\)/g, '$1')
    .replace(/\[([^\]]*?)\]\[[^\]]*?\]/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, (_, linkText: string) => displayLinkText(linkText))
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~=`>|[\]{}()]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function displayLinkText(linkText: string): string {
  return linkText.replace(/^.*\//, '').replace(/\.md$/i, '').trim();
}

function countCjkCharacters(content: string): number {
  let count = 0;
  CJK_CHARACTER_PATTERN.lastIndex = 0;
  while (CJK_CHARACTER_PATTERN.exec(content)) count++;
  return count;
}

function countCalloutBlocks(content: string): number {
  return content.match(/^\s*>\s*\[![^\]]+\]/gim)?.length ?? 0;
}

function countQuoteBlocks(content: string): number {
  let count = 0;
  let inQuoteBlock = false;
  let currentBlockIsCallout = false;
  const quoteLinePattern = /^\s*>\s?(.*)$/;
  for (const line of content.split(/\r?\n/)) {
    const quoteMatch = quoteLinePattern.exec(line);
    if (!quoteMatch) {
      if (inQuoteBlock && !currentBlockIsCallout) count++;
      inQuoteBlock = false;
      currentBlockIsCallout = false;
      continue;
    }
    if (!inQuoteBlock) {
      inQuoteBlock = true;
      currentBlockIsCallout = /^\s*\[![^\]]+\]/i.test(quoteMatch[1] ?? '');
    }
  }
  if (inQuoteBlock && !currentBlockIsCallout) count++;
  return count;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
}

function countFrontmatterValues(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean).length;
  }
  return value == null ? 0 : 1;
}

function getSearchMatchSignals(result: SearchResult): string[] {
  const matchedBy = new Set(result.matchedBy ?? []);
  const signals: string[] = [];
  if (matchedBy.has('bm25') || result.scores?.bm25 != null) signals.push('fulltext');
  if (matchedBy.has('title') || result.scores?.fuzzy_title != null) signals.push('title');
  return signals;
}

function getDirectionEvidence(evidence: string): DirectionEvidence | null {
  if (evidence === 'outgoing' || evidence === 'backlink' || evidence === 'bidirectional') {
    return evidence;
  }
  return null;
}

function getConnectionDirection(outgoing: boolean, backlink: boolean): CandidateNote['direction'] {
  if (outgoing && backlink) return 'bidirectional';
  if (outgoing) return 'outgoing';
  if (backlink) return 'backlink';
  return 'none';
}

function getPrimaryUtilityScore(
  candidate: CandidateNote,
  neighborScore: number,
  semanticCompareScore: number,
): number {
  if (candidate.kind === 'missing') return candidate.linkabilityScore;
  if (candidate.kind === 'bridge') return candidate.bridgeScore;
  if (candidate.kind === 'neighbor') return neighborScore;
  return semanticCompareScore;
}

function getDirectionIcon(direction: DirectionEvidence): string {
  if (direction === 'backlink') return 'corner-up-left';
  if (direction === 'outgoing') return 'corner-up-right';
  return 'repeat-2';
}

function getDirectionTitle(direction: CandidateNote['direction']): string {
  if (direction === 'backlink') return 'Backlink';
  if (direction === 'outgoing') return 'Outgoing link';
  if (direction === 'bidirectional') return 'Bidirectional link';
  return 'No direct link';
}

function getCandidateGraphNodeKind(candidate: CandidateNote): GraphNodeKind {
  if (candidate.kind === 'neighbor') return 'neighbor';
  if (candidate.kind === 'bridge') return 'bridge';
  if (candidate.kind === 'missing') return 'missing';
  return 'semantic';
}

function getBestKindIcon(kind: CandidateNote['kind']): string {
  switch (kind) {
    case 'missing':
      return 'link-2';
    case 'bridge':
      return 'git-fork';
    case 'similar':
      return 'radar';
    case 'neighbor':
      return 'network';
    case 'diagnostic':
      return 'activity';
  }
}

function formatSearchBreakdown(result: SearchResult): string | null {
  const parts: string[] = [];
  if (result.scores?.semantic != null) parts.push(`semantic ${result.scores.semantic.toFixed(2)}`);
  if (result.scores?.bm25 != null) parts.push(`fulltext ${result.scores.bm25.toFixed(2)}`);
  if (result.scores?.fuzzy_title != null)
    parts.push(`title ${result.scores.fuzzy_title.toFixed(2)}`);
  if (result.scores?.hybrid != null) parts.push(`hybrid ${result.scores.hybrid.toFixed(2)}`);
  return parts.length > 0 ? `Search contribution: ${parts.join('; ')}.` : null;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function strengthLabel(score: number): CandidateNote['strengthLabel'] {
  if (score >= 0.75) return 'Very Strong';
  if (score >= 0.55) return 'Strong';
  if (score >= 0.35) return 'Medium';
  if (score >= 0.2) return 'Weak';
  return 'Noise';
}

function isActionableStrength(strength: CandidateNote['strengthLabel']): boolean {
  return strength === 'Very Strong' || strength === 'Strong' || strength === 'Medium';
}

function strengthClassName(strength: CandidateNote['strengthLabel']): string {
  return strength.toLowerCase().replace(/\s+/g, '-');
}

function relevanceColor(score: number): string {
  if (score >= 0.75) return '#d36a5f';
  if (score >= 0.55) return '#c8564f';
  if (score >= 0.35) return '#b39a62';
  if (score >= 0.2) return '#7f8b99';
  return '#62676f';
}

function isNoisyPath(path: string): boolean {
  return (
    /(^|\/)(daily|periodic|templates|archive|attachments)\//i.test(path) ||
    /(^|\/)\d{4}-\d{2}-\d{2}\.md$/i.test(path)
  );
}

/* eslint-enable sonarjs/slow-regex -- graph workbench regexes completed */
