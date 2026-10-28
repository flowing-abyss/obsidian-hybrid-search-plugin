import type { App } from 'obsidian';
import {
  buildGraphIndex,
  getBacklinksFromIndex,
  getOutgoingFromIndex,
  type GraphIndex,
} from './analysis';

export interface GraphNode {
  path: string;
  title: string;
  depth: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function getTitle(app: App, path: string): string {
  const cache = app.metadataCache.getCache(path);
  const fm = cache?.frontmatter;
  return (
    (typeof fm?.['title'] === 'string' ? fm['title'] : undefined) ??
    path.replace(/^.*\//, '').replace(/\.md$/, '')
  );
}

export function buildGraph(
  app: App,
  centerPath: string,
  maxDepth: number,
  index: GraphIndex = buildGraphIndex(app),
): GraphData {
  const normalizedCenter = centerPath.normalize('NFC');
  const depthLimit = Math.max(0, Math.floor(maxDepth));
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string) => {
    const key = JSON.stringify([source, target]);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target });
  };

  nodes.set(normalizedCenter, {
    path: normalizedCenter,
    depth: 0,
    title: getTitle(app, normalizedCenter),
  });

  let frontier = [normalizedCenter];
  for (let depth = 1; depth <= depthLimit; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const target of getOutgoingFromIndex(index, path)) {
        addEdge(path, target);
        if (!nodes.has(target)) {
          nodes.set(target, { path: target, depth, title: getTitle(app, target) });
          next.push(target);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const incomingVisited = new Set([normalizedCenter]);
  frontier = [normalizedCenter];
  for (let depth = 1; depth <= depthLimit; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const source of getBacklinksFromIndex(index, path)) {
        addEdge(source, path);
        if (!nodes.has(source)) {
          nodes.set(source, { path: source, depth: -depth, title: getTitle(app, source) });
        }
        if (!incomingVisited.has(source)) {
          incomingVisited.add(source);
          next.push(source);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return { nodes: [...nodes.values()], edges };
}
