import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import type { RequestUrlParam } from 'obsidian';
import { requestUrl } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

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
  snippet?: string;
  tags: string[];
  aliases: string[];
  matchedBy?: string[];
  scores?: {
    semantic?: number | null;
    bm25?: number | null;
    fuzzy_title?: number | null;
    hybrid?: number | null;
  };
  previewAnchors?: MatchAnchor[];
  primaryAnchorIndex?: number;
}

interface SearchOptions {
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
}

interface StdioResponse {
  ready?: boolean;
  id?: string;
  results?: SearchResult[];
  error?: string;
}

interface McpResponse {
  id?: number;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
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

/** Extra directories added to PATH on spawn so the binary is found regardless
 *  of how Obsidian was launched (autostart, .desktop file, etc.).
 *  On macOS these paths are already present when launched from Terminal;
 *  when launched from Finder they often aren't. */
function augmentedPath(): string {
  const home = os.homedir();

  const extras: string[] = [
    '/usr/local/bin',
    '/usr/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/opt/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.pnpm'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.config', 'npm', 'node_global', 'bin'),
  ];

  // Windows npm global paths
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      extras.push(path.join(process.env.APPDATA, 'npm'));
    }
    if (process.env.LOCALAPPDATA) {
      extras.push(path.join(process.env.LOCALAPPDATA, 'npm'));
    }
    // Fallback using homedir if env vars are missing
    extras.push(path.join(home, 'AppData', 'Roaming', 'npm'));
  }

  // nvm
  const nvmBase = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmBase)) {
    try {
      for (const v of fs.readdirSync(nvmBase)) {
        extras.push(path.join(nvmBase, v, 'bin'));
      }
    } catch {
      /* ignore permission errors */
    }
  }

  // fnm (typical install paths)
  for (const fnmBase of [
    path.join(home, '.local', 'share', 'fnm', 'node-versions'),
    path.join(home, '.fnm', 'node-versions'),
  ]) {
    if (fs.existsSync(fnmBase)) {
      try {
        for (const v of fs.readdirSync(fnmBase)) {
          extras.push(path.join(fnmBase, v, 'installation', 'bin'));
        }
      } catch {
        /* ignore permission errors */
      }
    }
  }

  const existing = process.env.PATH ?? '';
  return existing
    ? `${existing}${path.delimiter}${extras.join(path.delimiter)}`
    : extras.join(path.delimiter);
}

/** Try to turn a bare command name into an absolute path by scanning the
 *  augmented PATH.  If the caller already supplied an absolute/relative path
 *  we leave it untouched so that any ENOENT is reported on the exact path
 *  they configured. */
function resolveBinary(binaryPath: string): string {
  // Absolute or relative path — trust the user, but on Windows try adding
  // executable extensions if the exact path is missing.
  if (path.isAbsolute(binaryPath) || binaryPath.includes(path.sep)) {
    if (process.platform === 'win32' && !path.extname(binaryPath)) {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        const candidate = binaryPath + ext;
        try {
          if (fs.statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          /* keep looking */
        }
      }
    }
    return binaryPath;
  }

  const searchDirs = augmentedPath()
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);

  for (const dir of searchDirs) {
    // On Windows, check .exe/.cmd/.bat BEFORE the bare name.  npm installs both a
    // Unix shell script (no extension) and a .cmd wrapper; statSync reports isFile:true
    // for both, but only .cmd is executable by the Windows process model.
    const candidates: string[] =
      process.platform === 'win32' && !path.extname(binaryPath)
        ? [
            ...['.exe', '.cmd', '.bat'].map((ext) => path.join(dir, binaryPath + ext)),
            path.join(dir, binaryPath),
          ]
        : [path.join(dir, binaryPath)];
    for (const candidate of candidates) {
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) {
          return candidate;
        }
      } catch {
        // candidate doesn't exist — keep looking
      }
    }
  }

  // Not found anywhere — fall back to the bare name and let spawn() report ENOENT
  return binaryPath;
}

export class SearchClient {
  private proc: ChildProcess;
  private pending = new Map<string, (results: SearchResult[]) => void>();
  private counter = 0;
  private ready = false;
  private readyCallbacks: Array<() => void> = [];
  private rejectCallbacks: Array<(err: Error) => void> = [];
  private buffer = '';
  private spawnError: Error | null = null;
  private stderrLines: string[] = [];
  private binaryPath: string;
  private resolvedPath: string;

  constructor(binaryPath: string, vaultPath: string) {
    this.binaryPath = binaryPath;
    this.resolvedPath = resolveBinary(binaryPath);
    const needsShell =
      process.platform === 'win32' &&
      (this.resolvedPath.endsWith('.cmd') || this.resolvedPath.endsWith('.bat'));
    this.proc = spawn(this.resolvedPath, ['serve', '--stdio'], {
      env: { ...process.env, PATH: augmentedPath(), OBSIDIAN_VAULT_PATH: vaultPath },
      shell: needsShell,
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as StdioResponse;
          if (msg.ready) {
            this.ready = true;
            this.readyCallbacks.forEach((cb) => cb());
            this.readyCallbacks = [];
            this.rejectCallbacks = [];
          } else if (msg.id !== undefined) {
            const resolve = this.pending.get(msg.id);
            if (resolve) {
              resolve(msg.error ? [] : (msg.results ?? []));
              this.pending.delete(msg.id);
            }
          }
        } catch {
          /* malformed line — ignore */
        }
      }
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Keep last 20 lines for diagnostics
      this.stderrLines.push(...text.split('\n').filter((l) => l.trim()));
      if (this.stderrLines.length > 20) this.stderrLines.splice(0, this.stderrLines.length - 20);
    });

    this.proc.on('error', (err: Error) => {
      this.spawnError = err;
      const rejects = this.rejectCallbacks;
      this.rejectCallbacks = [];
      this.readyCallbacks = [];
      for (const reject of rejects) reject(err);
    });
  }

  /** Human-readable diagnostics string, shown in error notices. */
  private diagnostics(): string {
    const parts: string[] = [`binary: "${this.binaryPath}"`, `resolved: "${this.resolvedPath}"`];

    let exists = false;
    let isFile = false;
    try {
      const st = fs.statSync(this.resolvedPath);
      exists = true;
      isFile = st.isFile();
    } catch {
      /* path does not exist */
    }
    parts.push(`exists: ${exists}, isFile: ${isFile}`);

    if (this.spawnError) parts.push(`spawn error: ${this.spawnError.message}`);
    if (this.stderrLines.length) parts.push(`stderr: ${this.stderrLines.slice(-3).join(' | ')}`);
    parts.push(`PATH: ${process.env.PATH ?? '(empty)'}`);
    return parts.join('\n');
  }

  waitReady(timeoutMs = 30_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.spawnError) return Promise.reject(this.spawnError);
    return new Promise((resolve, reject) => {
      const t = window.setTimeout(() => {
        const diag = this.diagnostics();
        reject(new Error(`Search server timed out.\n${diag}`));
      }, timeoutMs);
      this.readyCallbacks.push(() => {
        window.clearTimeout(t);
        resolve();
      });
      this.rejectCallbacks.push((err) => {
        window.clearTimeout(t);
        const diag = this.diagnostics();
        reject(new Error(`${err.message}\n${diag}`));
      });
    });
  }

  search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return new Promise((resolve) => {
      const id = String(++this.counter);
      this.pending.set(id, resolve);
      this.proc.stdin!.write(JSON.stringify({ id, query, options }) + '\n');
    });
  }

  dispose(): void {
    // Guard: proc may already have exited (e.g. binary crashed)
    if (this.proc.exitCode === null && !this.proc.killed) {
      this.proc.kill();
    }
    // Drain any pending searches so they don't leak
    for (const resolve of this.pending.values()) {
      resolve([]);
    }
    this.pending.clear();
  }
}

export class HttpSearchClient {
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
