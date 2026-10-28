/** Any client that can report on the index it serves. Both transports satisfy it,
 *  so the panel never needs to know which one it is talking to. */
export interface StatusCapableClient {
  statusReport(timeoutMs?: number): Promise<Record<string, unknown>>;
}

/** Normalised view of what the server reports about the index and the provider. */
export interface CliStatus {
  total: number | null;
  indexed: number | null;
  /** Notes with no body to embed. Still searchable by title, tags and fulltext. */
  notesWithoutChunks: number | null;
  pending: number | null;
  chunks: number | null;
  /** Chunks the embedding provider rejected. Unlike the above, a real failure. */
  failedChunks: number;
  links: number | null;
  lastIndexed: string | null;
  dbSizeMb: number | null;
  apiBaseUrl: string | null;
  /** Model the index was built with. */
  model: string | null;
  /** Model the server would embed with now. Differs when the environment drifted. */
  activeModel: string | null;
  embeddingDim: number | null;
  contextLength: number | null;
  version: string | null;
  ignorePatterns: string[];
}

const STATUS_TIMEOUT_MS = 15_000;

export function isStatusCapable(client: unknown): client is StatusCapableClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as StatusCapableClient).statusReport === 'function'
  );
}

export async function fetchStatus(client: unknown): Promise<CliStatus> {
  if (!isStatusCapable(client)) {
    throw new Error('Search server is not connected yet.');
  }
  return normaliseStatus(await client.statusReport(STATUS_TIMEOUT_MS));
}

/** Older servers omit the newer counters, so every field degrades to null rather
 *  than to a number that would read as real data. */
export function normaliseStatus(raw: Record<string, unknown>): CliStatus {
  const total = numberOrNull(raw.total);
  const indexed = numberOrNull(raw.indexed);

  return {
    total,
    indexed,
    // Servers that predate this counter still report both totals it is derived from.
    notesWithoutChunks:
      numberOrNull(raw.notes_without_chunks) ??
      (total !== null && indexed !== null ? total - indexed : null),
    pending: numberOrNull(raw.pending),
    chunks: numberOrNull(raw.chunks),
    failedChunks: numberOrNull(raw.failed_chunks) ?? 0,
    links: numberOrNull(raw.links),
    lastIndexed: stringOrNull(raw.last_indexed),
    dbSizeMb: numberOrNull(raw.db_size_mb),
    apiBaseUrl: stringOrNull(raw.api_base_url),
    model: stringOrNull(raw.model),
    activeModel: stringOrNull(raw.active_model),
    embeddingDim: numberOrNull(raw.embedding_dim),
    contextLength: numberOrNull(raw.context_length),
    version: stringOrNull(raw.version),
    ignorePatterns: Array.isArray(raw.ignore_patterns)
      ? raw.ignore_patterns.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
