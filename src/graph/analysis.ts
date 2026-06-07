import type { App } from 'obsidian';

export interface GraphStats {
  outgoing: number;
  backlinks: number;
  neighbours: number;
  edgesAmongNeighbours: number;
  clusteringCoefficient: number;
}

export interface PredictedLink {
  path: string;
  title: string;
  score: number;
  commonNeighbours: number;
  jaccard: number;
  adamicAdar: number;
  resourceAllocation: number;
  preferentialAttachment: number;
  cosine: number;
}

export interface CoCitation {
  path: string;
  title: string;
  count: number;
  sources: string[];
}

export interface GraphAnalysis {
  stats: GraphStats;
  predicted: PredictedLink[];
  coCitations: CoCitation[];
}

export interface GraphIndex {
  outgoing: Map<string, Set<string>>;
  backlinks: Map<string, Set<string>>;
}

export function getTitle(app: App, path: string): string {
  const nfcPath = normalizePath(path);
  const fm = app.metadataCache.getCache(nfcPath)?.frontmatter;
  return (
    (typeof fm?.['title'] === 'string' ? fm['title'] : undefined) ??
    nfcPath.replace(/^.*\//, '').replace(/\.md$/, '')
  );
}

export function analyzeGraph(
  app: App,
  centerPath: string,
  limit = 20,
  index = buildGraphIndex(app),
): GraphAnalysis {
  const center = normalizePath(centerPath);
  const outgoing = getOutgoingFromIndex(index, center);
  const backlinks = getBacklinksFromIndex(index, center);
  const neighbours = union(outgoing, backlinks);

  return {
    stats: getGraphStatsFromIndex(index, center),
    predicted: getPredictedLinksFromIndex(app, index, center, limit, neighbours),
    coCitations: getCoCitationsFromIndex(app, index, center, limit),
  };
}

export function getGraphStats(app: App, centerPath: string): GraphStats {
  return getGraphStatsFromIndex(buildGraphIndex(app), centerPath);
}

export function getGraphStatsFromIndex(index: GraphIndex, centerPath: string): GraphStats {
  const center = normalizePath(centerPath);
  const outgoing = getOutgoingFromIndex(index, center);
  const backlinks = getBacklinksFromIndex(index, center);
  const neighbours = union(outgoing, backlinks);
  const neighbourList = [...neighbours];
  let edgesAmongNeighbours = 0;

  for (let i = 0; i < neighbourList.length; i++) {
    for (let j = i + 1; j < neighbourList.length; j++) {
      if (hasAnyLinkInIndex(index, neighbourList[i]!, neighbourList[j]!)) edgesAmongNeighbours++;
    }
  }

  const possibleEdges = (neighbourList.length * (neighbourList.length - 1)) / 2;
  return {
    outgoing: outgoing.size,
    backlinks: backlinks.size,
    neighbours: neighbours.size,
    edgesAmongNeighbours,
    clusteringCoefficient: possibleEdges > 0 ? edgesAmongNeighbours / possibleEdges : 0,
  };
}

export function getPredictedLinks(app: App, centerPath: string, limit = 20): PredictedLink[] {
  const index = buildGraphIndex(app);
  return getPredictedLinksFromIndex(
    app,
    index,
    centerPath,
    limit,
    getNeighboursFromIndex(index, centerPath),
  );
}

export function getPredictedLinksFromIndex(
  app: App,
  index: GraphIndex,
  centerPath: string,
  limit: number,
  knownNeighbours: Set<string>,
): PredictedLink[] {
  const center = normalizePath(centerPath);
  const centerNeighbours = getNeighboursFromIndex(index, center);
  const candidates = getPredictionCandidates(index, center)
    .filter((path) => path !== center && !knownNeighbours.has(path))
    .map((path) => {
      const candidateNeighbours = getNeighboursFromIndex(index, path);
      const common = intersection(centerNeighbours, candidateNeighbours);
      const unionSize = union(centerNeighbours, candidateNeighbours).size;
      const jaccard = unionSize > 0 ? common.size / unionSize : 0;
      const adamicAdar = [...common].reduce((sum, path) => {
        const degree = getNeighboursFromIndex(index, path).size;
        return degree > 1 ? sum + 1 / Math.log(degree) : sum;
      }, 0);
      const resourceAllocation = [...common].reduce((sum, path) => {
        const degree = getNeighboursFromIndex(index, path).size;
        return degree > 0 ? sum + 1 / degree : sum;
      }, 0);
      const centerDegree = Math.max(1, centerNeighbours.size);
      const candidateDegree = Math.max(1, candidateNeighbours.size);
      const preferentialAttachment = centerDegree * candidateDegree;
      const cosine = common.size / Math.sqrt(centerDegree * candidateDegree);
      const score =
        common.size * 1.4 +
        adamicAdar * 0.9 +
        resourceAllocation * 0.8 +
        jaccard * 1.2 +
        cosine * 1.1 +
        Math.log1p(preferentialAttachment) * 0.08;
      return {
        path,
        title: getTitle(app, path),
        score,
        commonNeighbours: common.size,
        jaccard,
        adamicAdar,
        resourceAllocation,
        preferentialAttachment,
        cosine,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.commonNeighbours - a.commonNeighbours ||
        a.title.localeCompare(b.title),
    );

  return candidates.slice(0, limit);
}

export function getCoCitations(app: App, centerPath: string, limit = 20): CoCitation[] {
  return getCoCitationsFromIndex(app, buildGraphIndex(app), centerPath, limit);
}

export function getCoCitationsFromIndex(
  app: App,
  index: GraphIndex,
  centerPath: string,
  limit: number,
): CoCitation[] {
  const center = normalizePath(centerPath);
  const counts = new Map<string, { count: number; sources: string[] }>();

  for (const source of getBacklinksFromIndex(index, center)) {
    const targets = [...getOutgoingFromIndex(index, source)];

    for (const target of targets) {
      if (target === center) continue;
      const entry = counts.get(target) ?? { count: 0, sources: [] };
      entry.count++;
      if (entry.sources.length < 4) entry.sources.push(normalizePath(source));
      counts.set(target, entry);
    }
  }

  return [...counts.entries()]
    .map(([path, entry]) => ({
      path,
      title: getTitle(app, path),
      count: entry.count,
      sources: entry.sources,
    }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function getOutgoing(app: App, path: string): Set<string> {
  return getOutgoingFromIndex(buildGraphIndex(app), path);
}

export function getBacklinks(app: App, path: string): Set<string> {
  return getBacklinksFromIndex(buildGraphIndex(app), path);
}

export function getNeighbours(app: App, path: string): Set<string> {
  return getNeighboursFromIndex(buildGraphIndex(app), path);
}

export function buildGraphIndex(app: App): GraphIndex {
  const outgoing = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();

  for (const [rawSource, rawTargets] of Object.entries(app.metadataCache.resolvedLinks)) {
    const source = normalizePath(rawSource);
    const targets = new Set(Object.keys(rawTargets).map(normalizePath));
    outgoing.set(source, targets);
    if (!backlinks.has(source)) backlinks.set(source, new Set());
    for (const target of targets) {
      if (!outgoing.has(target)) outgoing.set(target, new Set());
      const incoming = backlinks.get(target) ?? new Set<string>();
      incoming.add(source);
      backlinks.set(target, incoming);
    }
  }
  return { outgoing, backlinks };
}

function getPredictionCandidates(index: GraphIndex, center: string): string[] {
  const candidates = new Set<string>();
  for (const neighbour of getNeighboursFromIndex(index, center)) {
    for (const secondHop of getNeighboursFromIndex(index, neighbour)) candidates.add(secondHop);
  }
  return [...candidates];
}

export function getOutgoingFromIndex(index: GraphIndex, path: string): Set<string> {
  return new Set(index.outgoing.get(normalizePath(path)) ?? []);
}

export function getBacklinksFromIndex(index: GraphIndex, path: string): Set<string> {
  return new Set(index.backlinks.get(normalizePath(path)) ?? []);
}

export function getNeighboursFromIndex(index: GraphIndex, path: string): Set<string> {
  return union(getOutgoingFromIndex(index, path), getBacklinksFromIndex(index, path));
}

function hasAnyLinkInIndex(index: GraphIndex, a: string, b: string): boolean {
  return (
    getOutgoingFromIndex(index, a).has(normalizePath(b)) ||
    getOutgoingFromIndex(index, b).has(normalizePath(a))
  );
}

function normalizePath(path: string): string {
  return path.normalize('NFC');
}

function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((item) => b.has(item)));
}

function union<T>(...sets: Array<Set<T>>): Set<T> {
  const result = new Set<T>();
  for (const set of sets) {
    for (const item of set) result.add(item);
  }
  return result;
}
