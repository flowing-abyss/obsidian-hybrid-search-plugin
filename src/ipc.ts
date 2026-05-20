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
      // eslint-disable-next-line obsidianmd/prefer-active-window-timers
      const t = setTimeout(() => {
        const diag = this.diagnostics();
        reject(new Error(`Search server timed out.\n${diag}`));
      }, timeoutMs);
      this.readyCallbacks.push(() => {
        // eslint-disable-next-line obsidianmd/prefer-active-window-timers
        clearTimeout(t);
        resolve();
      });
      this.rejectCallbacks.push((err) => {
        // eslint-disable-next-line obsidianmd/prefer-active-window-timers
        clearTimeout(t);
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
  private readonly url: string;
  private readonly healthUrl: string;
  private sessionId: string | null = null;
  private counter = 0;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    this.url = `http://${host}:${port}/mcp`;
    this.healthUrl = `http://${host}:${port}/health`;
  }

  async waitReady(timeoutMs = 30_000): Promise<void> {
    if (this.sessionId) return;
    this.readyPromise ??= this.initialize(timeoutMs);
    await this.readyPromise;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.waitReady();
    const response = await this.postMcp({
      jsonrpc: '2.0',
      id: ++this.counter,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: this.buildSearchArguments(query, options),
      },
    });
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

  dispose(): void {
    this.sessionId = null;
    this.readyPromise = null;
  }

  private async initialize(timeoutMs: number): Promise<void> {
    const health = await requestWithTimeout({ url: this.healthUrl }, timeoutMs);
    if (health.status < 200 || health.status >= 300) {
      throw new Error(`HTTP MCP server is not healthy: ${health.status}`);
    }
    const healthBody =
      health.json !== undefined
        ? (health.json as { ok?: unknown })
        : (JSON.parse(health.text) as { ok?: unknown });
    if (healthBody.ok !== true) {
      throw new Error('HTTP MCP server health check failed');
    }

    await this.postMcp(
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
    );
  }

  private async postMcp(body: unknown, timeoutMs = 30_000): Promise<McpResponse> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const res = await requestWithTimeout(
      {
        url: this.url,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    const sessionId = getHeader(res.headers, 'mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP MCP request failed: ${res.status} ${res.text}`);
    }
    return parseMcpResponse(res.text);
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
}

function requestWithTimeout(request: RequestUrlParam, timeoutMs: number): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line obsidianmd/prefer-active-window-timers
    const timer = setTimeout(() => reject(new Error('HTTP MCP request timed out')), timeoutMs);
    void requestUrl({ ...request, throw: false })
      .then((response) => resolve(response as HttpResponse))
      .catch(reject)
      .finally(() => {
        // eslint-disable-next-line obsidianmd/prefer-active-window-timers
        clearTimeout(timer);
      });
  });
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
