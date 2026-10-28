export interface MatchAnchor {
  kind: 'bm25' | 'semantic';
  headingPath: string | null;
  matchText: string;
  charStart: number | null;
  charEnd: number | null;
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  rank?: number;
  depth?: number;
  snippet?: string;
  tags: string[];
  aliases: string[];
  matchedBy?: string[];
  links?: string[];
  backlinks?: string[];
  markdownLinks?: string[];
  markdownBacklinks?: string[];
  urls?: string[];
  scores?: {
    semantic?: number | null;
    bm25?: number | null;
    fuzzy_title?: number | null;
    hybrid?: number | null;
  };
  previewAnchors?: MatchAnchor[];
  primaryAnchorIndex?: number;
}

export interface SearchOptions {
  mode?: 'hybrid' | 'semantic' | 'fulltext' | 'title';
  related?: boolean;
  notePath?: string;
  limit?: number;
  threshold?: number;
  snippetLength?: number;
  tag?: string | string[];
  scope?: string | string[];
  frontmatter?: string | string[];
  anchors?: boolean;
  rerank?: boolean;
  depth?: number;
  direction?: 'outgoing' | 'backlinks' | 'both';
  linkType?: 'wiki' | 'markdown' | 'all';
}

export type SearchMode = NonNullable<SearchOptions['mode']>;

export interface SearchService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  waitReady(timeoutMs?: number): Promise<void>;
  statusReport(timeoutMs?: number): Promise<Record<string, unknown>>;
  dispose(): void;
  activeEndpointLabel?(): string;
}
