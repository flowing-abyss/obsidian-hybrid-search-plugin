import { requestUrl, type RequestUrlParam } from 'obsidian';
import type { SearchOptions, SearchResult, SearchService } from '../search/contracts';

interface McpResponse {
  id?: number;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { message?: string };
}

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
}

interface HttpEndpointConfig {
  host: string;
  port: number;
}

interface HttpEndpointStatus {
  host: string;
  port: number;
  label: string;
}

export type HttpSearchClientStatusEvent =
  | {
      type: 'fallback-activated';
      from: HttpEndpointStatus;
      to: HttpEndpointStatus;
      reason: string;
    }
  | {
      type: 'primary-restored';
      from: HttpEndpointStatus;
      to: HttpEndpointStatus;
    }
  | {
      type: 'fallback-failed';
      from: HttpEndpointStatus;
      to: HttpEndpointStatus;
      reason: string;
    };

interface HttpSearchClientOptions {
  fallback?: HttpEndpointConfig;
  onStatusChange?: (event: HttpSearchClientStatusEvent) => void;
}

interface HttpEndpointState extends HttpEndpointConfig {
  url: string;
  healthUrl: string;
  sessionId: string | null;
  readyPromise: Promise<void> | null;
  reconnectFailures: number;
  nextReconnectAt: number;
  sessionGeneration: number;
  cooldownRecordedForSessionGeneration: number | null;
}

const HTTP_RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;
const PRIMARY_FAILOVER_TIMEOUT_MS = 2_000;
const PRIMARY_RETRY_WHILE_ON_FALLBACK_MS = 60_000;
const FALLBACK_FAILED_STATUS_THROTTLE_MS = 60_000;

export class HttpSearchClient implements SearchService {
  private counter = 0;
  private readonly primary: HttpEndpointState;
  private readonly fallback: HttpEndpointState | null;
  private onStatusChange: ((event: HttpSearchClientStatusEvent) => void) | undefined;
  private active: HttpEndpointState;
  private nextPrimaryProbeAt = 0;
  private fallbackFailedStatusActive = false;
  private lastFallbackFailedStatusAt = 0;
  private disposed = false;

  constructor(host: string, port: number, options: HttpSearchClientOptions = {}) {
    this.primary = createHttpEndpointState(host, port);
    this.fallback = options.fallback
      ? createHttpEndpointState(options.fallback.host, options.fallback.port)
      : null;
    this.onStatusChange = options.onStatusChange;
    this.active = this.primary;
  }

  async waitReady(timeoutMs = 30_000): Promise<void> {
    await this.maybeRestorePrimary();
    try {
      await this.waitReadyForEndpoint(this.active, this.timeoutForEndpoint(this.active, timeoutMs));
      this.markEndpointHealthy(this.active);
    } catch (err) {
      const fallback = this.getFailoverEndpoint(this.active, err);
      if (fallback) {
        try {
          await this.waitReadyForEndpoint(fallback, timeoutMs);
          this.markEndpointHealthy(fallback);
          this.nextPrimaryProbeAt = Date.now() + PRIMARY_RETRY_WHILE_ON_FALLBACK_MS;
          this.activateEndpoint(fallback, err);
        } catch (fallbackErr) {
          this.emitFallbackFailed(fallback, fallbackErr);
          this.restorePrimaryAfterFailedFailover();
          throw fallbackErr;
        }
        return;
      }
      throw err;
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.maybeRestorePrimary();
    const attemptedEndpoint = this.active;
    try {
      const results = await this.searchEndpoint(attemptedEndpoint, query, options);
      this.markEndpointHealthy(attemptedEndpoint);
      return results;
    } catch (err) {
      const fallback = this.getFailoverEndpoint(attemptedEndpoint, err);
      if (fallback) {
        try {
          const results = await this.searchEndpoint(fallback, query, options);
          this.markEndpointHealthy(fallback);
          this.nextPrimaryProbeAt = Date.now() + PRIMARY_RETRY_WHILE_ON_FALLBACK_MS;
          this.activateEndpoint(fallback, err);
          return results;
        } catch (fallbackErr) {
          this.emitFallbackFailed(fallback, fallbackErr);
          this.restorePrimaryAfterFailedFailover();
          throw fallbackErr;
        }
      }
      throw err;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.onStatusChange = undefined;
    this.resetHttpSession(this.primary);
    if (this.fallback) this.resetHttpSession(this.fallback);
  }

  private async maybeRestorePrimary(): Promise<void> {
    if (this.active === this.primary || !this.fallback) return;
    if (Date.now() < this.nextPrimaryProbeAt) return;

    try {
      await this.waitReadyForEndpoint(this.primary, this.timeoutForEndpoint(this.primary));
      this.activateEndpoint(this.primary);
    } catch {
      this.nextPrimaryProbeAt = Date.now() + PRIMARY_RETRY_WHILE_ON_FALLBACK_MS;
    }
  }

  private restorePrimaryAfterFailedFailover(): void {
    this.active = this.primary;
    this.nextPrimaryProbeAt = 0;
    this.primary.reconnectFailures = 0;
    this.primary.nextReconnectAt = 0;
  }

  private async waitReadyForEndpoint(
    endpoint: HttpEndpointState,
    timeoutMs = 30_000,
  ): Promise<void> {
    if (endpoint.sessionId) return;
    const now = Date.now();
    if (!endpoint.readyPromise && now < endpoint.nextReconnectAt) {
      const waitMs = Math.ceil(endpoint.nextReconnectAt - now);
      throw new Error(`HTTP MCP reconnect cooling down for ${waitMs}ms`);
    }

    const readyPromise = (endpoint.readyPromise ??= this.initialize(endpoint, timeoutMs));
    try {
      await readyPromise;
      endpoint.reconnectFailures = 0;
      endpoint.nextReconnectAt = 0;
    } catch (err) {
      if (endpoint.readyPromise === readyPromise) {
        endpoint.readyPromise = null;
        this.recordReconnectFailure(endpoint);
      }
      throw err;
    }
  }

  private async searchEndpoint(
    endpoint: HttpEndpointState,
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const timeoutMs = this.timeoutForEndpoint(endpoint);
    try {
      return await this.searchOnce(endpoint, query, options, timeoutMs);
    } catch (err) {
      if (
        isLikelyStaleMcpSessionError(err) &&
        err instanceof McpSearchRequestError &&
        err.requestSessionGeneration === endpoint.sessionGeneration
      ) {
        this.resetHttpSession(endpoint, { invalidateGeneration: true });
        return this.searchOnce(endpoint, query, options, timeoutMs);
      }
      throw err;
    }
  }

  /** Index and provider report from the `status` mcp tool.
   *  Talks to the active endpoint only — diagnostics must not trigger a failover. */
  async statusReport(timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const endpoint = this.active;
    await this.waitReadyForEndpoint(endpoint, timeoutMs);
    const response = await this.postMcp(
      endpoint,
      {
        jsonrpc: '2.0',
        id: ++this.counter,
        method: 'tools/call',
        params: { name: 'status', arguments: {} },
      },
      timeoutMs,
    );
    if (response.error) {
      throw new Error(response.error.message ?? 'Status request failed.');
    }
    const text = response.result?.content?.find((part) => part.type === 'text')?.text;
    if (!text) throw new Error('Status returned no content.');
    // A failing tool answers with a normal result carrying isError, so without this
    // the server's own explanation is lost and the parser below reports bad json.
    if (response.result?.isError === true) throw new Error(text);

    // The tool appends a human-readable warning after the json body.
    const jsonEnd = text.lastIndexOf('}');
    if (jsonEnd < 0) throw new Error('Status returned no json.');
    const payload = JSON.parse(text.slice(0, jsonEnd + 1)) as Record<string, unknown>;

    // Servers older than the failed_chunks field only state the count in that
    // warning, and losing it would hide exactly what the panel exists to show.
    if (typeof payload.failed_chunks !== 'number') {
      const match = /(\d{1,9}) chunk/.exec(text.slice(jsonEnd + 1));
      payload.failed_chunks = match ? Number(match[1]) : 0;
    }
    return payload;
  }

  /** The endpoint currently serving requests, which may be the fallback. */
  activeEndpointLabel(): string {
    return `${this.active.host}:${String(this.active.port)}`;
  }

  private async searchOnce(
    endpoint: HttpEndpointState,
    query: string,
    options: SearchOptions = {},
    timeoutMs = 30_000,
  ): Promise<SearchResult[]> {
    await this.waitReadyForEndpoint(endpoint, timeoutMs);
    const requestSessionGeneration = endpoint.sessionGeneration;
    const response = await this.postSearchMcpRequest(
      endpoint,
      query,
      options,
      requestSessionGeneration,
      timeoutMs,
    );
    if (response.error) return [];
    const text = response.result?.content?.find((part) => part.type === 'text')?.text;
    if (!text) return [];

    try {
      const body = JSON.parse(text) as { results?: SearchResult[] };
      return body.results ?? [];
    } catch {
      return [];
    }
  }

  private async postSearchMcpRequest(
    endpoint: HttpEndpointState,
    query: string,
    options: SearchOptions,
    requestSessionGeneration: number,
    timeoutMs: number,
  ): Promise<McpResponse> {
    try {
      return await this.postMcp(
        endpoint,
        {
          jsonrpc: '2.0',
          id: ++this.counter,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: this.buildSearchArguments(query, options),
          },
        },
        timeoutMs,
      );
    } catch (err) {
      if (this.fallback && isLikelyUnavailableMcpServerError(err)) {
        this.recordSessionUnavailable(endpoint, requestSessionGeneration);
      }
      throw new McpSearchRequestError(err, requestSessionGeneration);
    }
  }

  private resetHttpSession(
    endpoint: HttpEndpointState,
    {
      recordFailure = false,
      invalidateGeneration = false,
    }: {
      recordFailure?: boolean;
      invalidateGeneration?: boolean;
    } = {},
  ): void {
    endpoint.sessionId = null;
    endpoint.readyPromise = null;
    if (invalidateGeneration) {
      endpoint.sessionGeneration++;
      endpoint.cooldownRecordedForSessionGeneration = null;
    }
    if (recordFailure) this.recordReconnectFailure(endpoint);
  }

  private recordSessionUnavailable(endpoint: HttpEndpointState, sessionGeneration: number): void {
    if (endpoint.sessionGeneration !== sessionGeneration) return;
    if (endpoint.cooldownRecordedForSessionGeneration === sessionGeneration) return;

    endpoint.sessionId = null;
    endpoint.readyPromise = null;
    endpoint.cooldownRecordedForSessionGeneration = sessionGeneration;
    this.recordReconnectFailure(endpoint);
  }

  private async initialize(endpoint: HttpEndpointState, timeoutMs: number): Promise<void> {
    const health = await requestWithTimeout({ url: endpoint.healthUrl }, timeoutMs);
    if (health.status < 200 || health.status >= 300) {
      throw new Error(`HTTP MCP server is not healthy: ${health.status}`);
    }
    let healthBody: { ok?: unknown };
    try {
      const parsedHealthBody =
        health.json !== undefined ? health.json : (JSON.parse(health.text) as unknown);
      if (
        typeof parsedHealthBody !== 'object' ||
        parsedHealthBody === null ||
        Array.isArray(parsedHealthBody)
      ) {
        throw new Error('Invalid health body');
      }
      healthBody = parsedHealthBody;
    } catch {
      throw new Error('HTTP MCP server health check failed');
    }
    if (healthBody.ok !== true) {
      throw new Error('HTTP MCP server health check failed');
    }

    await this.postMcp(
      endpoint,
      {
        jsonrpc: '2.0',
        id: ++this.counter,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'obsidian-hybrid-search-plugin', version: '1.0.0' },
        },
      },
      timeoutMs,
      { rejectJsonRpcError: true },
    );
  }

  private recordReconnectFailure(endpoint: HttpEndpointState): void {
    const delayIndex = Math.min(endpoint.reconnectFailures, HTTP_RECONNECT_DELAYS_MS.length - 1);
    endpoint.nextReconnectAt = Date.now() + HTTP_RECONNECT_DELAYS_MS[delayIndex]!;
    endpoint.reconnectFailures++;
  }

  private async postMcp(
    endpoint: HttpEndpointState,
    body: unknown,
    timeoutMs = 30_000,
    options: { rejectJsonRpcError?: boolean } = {},
  ): Promise<McpResponse> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (endpoint.sessionId) headers['mcp-session-id'] = endpoint.sessionId;

    const res = await requestWithTimeout(
      {
        url: endpoint.url,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP MCP request failed: ${res.status} ${res.text}`);
    }
    const parsed = parseMcpResponse(res.text);
    if (options.rejectJsonRpcError && parsed.error) {
      throw new Error(`HTTP MCP JSON-RPC error: ${parsed.error.message ?? 'Unknown error'}`);
    }
    const sessionId = getHeader(res.headers, 'mcp-session-id');
    if (sessionId && sessionId !== endpoint.sessionId) {
      endpoint.sessionId = sessionId;
      endpoint.sessionGeneration++;
    }
    return parsed;
  }

  private buildSearchArguments(query: string, options: SearchOptions): Record<string, unknown> {
    return {
      query,
      ...(options.mode !== undefined && { mode: options.mode }),
      ...(options.related !== undefined && { related: options.related }),
      ...(options.notePath !== undefined && { path: options.notePath }),
      ...(options.limit !== undefined && { limit: options.limit }),
      ...(options.threshold !== undefined && { threshold: options.threshold }),
      ...(options.snippetLength !== undefined && { snippet_length: options.snippetLength }),
      ...(options.tag !== undefined && { tag: options.tag }),
      ...(options.scope !== undefined && { scope: options.scope }),
      ...(options.frontmatter !== undefined && { frontmatter: options.frontmatter }),
      ...(options.anchors !== undefined && { anchors: options.anchors }),
      ...(options.rerank !== undefined && { rerank: options.rerank }),
      ...(options.depth !== undefined && { depth: options.depth }),
      ...(options.direction !== undefined && { direction: options.direction }),
      ...(options.linkType !== undefined && { link_type: options.linkType }),
    };
  }

  private getFailoverEndpoint(endpoint: HttpEndpointState, err: unknown): HttpEndpointState | null {
    if (endpoint !== this.primary || !this.fallback) return null;
    if (err instanceof McpSearchRequestError) {
      if (err.requestSessionGeneration !== endpoint.sessionGeneration) return null;
      return isLikelyUnavailableMcpServerError(err) || isLikelyStaleMcpSessionError(err)
        ? this.fallback
        : null;
    }
    return isLikelyUnavailableMcpServerError(err) ||
      isLikelyUnhealthyMcpServerError(err) ||
      isLikelyStaleMcpSessionError(err) ||
      isReconnectCoolingDownError(err)
      ? this.fallback
      : null;
  }

  private timeoutForEndpoint(endpoint: HttpEndpointState, timeoutMs = 30_000): number {
    return endpoint === this.primary && this.fallback
      ? Math.min(timeoutMs, PRIMARY_FAILOVER_TIMEOUT_MS)
      : timeoutMs;
  }

  private activateEndpoint(endpoint: HttpEndpointState, reason?: unknown): void {
    if (this.active === endpoint) return;

    const previous = this.active;
    this.active = endpoint;

    if (previous === this.primary && endpoint === this.fallback) {
      this.emitStatusChange({
        type: 'fallback-activated',
        from: endpointStatus(previous),
        to: endpointStatus(endpoint),
        reason: errorMessage(reason),
      });
      return;
    }

    if (previous === this.fallback && endpoint === this.primary) {
      this.emitStatusChange({
        type: 'primary-restored',
        from: endpointStatus(previous),
        to: endpointStatus(endpoint),
      });
    }
  }

  private emitFallbackFailed(fallback: HttpEndpointState, err: unknown): void {
    const now = Date.now();
    if (
      this.fallbackFailedStatusActive &&
      now - this.lastFallbackFailedStatusAt < FALLBACK_FAILED_STATUS_THROTTLE_MS
    ) {
      return;
    }
    this.fallbackFailedStatusActive = true;
    this.lastFallbackFailedStatusAt = now;
    this.emitStatusChange({
      type: 'fallback-failed',
      from: endpointStatus(this.primary),
      to: endpointStatus(fallback),
      reason: errorMessage(err),
    });
  }

  private emitStatusChange(event: HttpSearchClientStatusEvent): void {
    if (this.disposed) return;
    this.onStatusChange?.(event);
  }

  private markEndpointHealthy(_endpoint: HttpEndpointState): void {
    this.fallbackFailedStatusActive = false;
  }
}

function createHttpEndpointState(host: string, port: number): HttpEndpointState {
  return {
    host,
    port,
    url: `http://${host}:${port}/mcp`,
    healthUrl: `http://${host}:${port}/health`,
    sessionId: null,
    readyPromise: null,
    reconnectFailures: 0,
    nextReconnectAt: 0,
    sessionGeneration: 0,
    cooldownRecordedForSessionGeneration: null,
  };
}

function endpointLabel(endpoint: HttpEndpointConfig): string {
  return `${endpoint.host}:${endpoint.port}`;
}

function endpointStatus(endpoint: HttpEndpointConfig): HttpEndpointStatus {
  return {
    host: endpoint.host,
    port: endpoint.port,
    label: endpointLabel(endpoint),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requestWithTimeout(request: RequestUrlParam, timeoutMs: number): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('HTTP MCP request timed out')),
      timeoutMs,
    );
    void requestUrl({ ...request, throw: false })
      .then((response) => resolve(response as HttpResponse))
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timer);
      });
  });
}

function isLikelyStaleMcpSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /HTTP MCP request failed: (400|401|403|404|409)\b/.test(err.message);
}

class McpSearchRequestError extends Error {
  constructor(
    err: unknown,
    readonly requestSessionGeneration: number,
  ) {
    super(err instanceof Error ? err.message : String(err));
    this.name = err instanceof Error ? err.name : 'McpSearchRequestError';
    if (err instanceof Error) this.stack = err.stack;
  }
}

function isLikelyUnavailableMcpServerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    /HTTP MCP request failed: (429|500|502|503|504)\b/.test(err.message) ||
    /HTTP MCP request timed out/.test(err.message) ||
    /(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|Failed to fetch|NetworkError|Load failed|fetch failed)/i.test(
      err.message,
    )
  );
}

function isLikelyUnhealthyMcpServerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    /HTTP MCP server is not healthy: (429|500|502|503|504)\b/.test(err.message) ||
    /HTTP MCP server health check failed/.test(err.message)
  );
}

function isReconnectCoolingDownError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /HTTP MCP reconnect cooling down/.test(err.message);
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName)?.[1];
}

function parseMcpResponse(text: string): McpResponse {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as McpResponse;
  const data = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  return JSON.parse(data) as McpResponse;
}
