import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
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
}

interface StdioResponse {
  ready?: boolean;
  id?: string;
  results?: SearchResult[];
  error?: string;
}

/** Extra directories added to PATH on spawn so the binary is found regardless
 *  of how Obsidian was launched (autostart, .desktop file, etc.).
 *  On macOS these paths are already present when launched from Terminal;
 *  when launched from Finder they often aren't. */
function augmentedPath(): string {
  const home = process.env.HOME ?? '';

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
  return existing ? `${existing}:${extras.join(':')}` : extras.join(':');
}

/** Try to turn a bare command name into an absolute path by scanning the
 *  augmented PATH.  If the caller already supplied an absolute/relative path
 *  we leave it untouched so that any ENOENT is reported on the exact path
 *  they configured. */
function resolveBinary(binaryPath: string): string {
  // Absolute or relative path — trust the user
  if (path.isAbsolute(binaryPath) || binaryPath.includes(path.sep)) {
    return binaryPath;
  }

  const searchDirs = augmentedPath()
    .split(':')
    .map((d) => d.trim())
    .filter(Boolean);

  for (const dir of searchDirs) {
    const candidate = path.join(dir, binaryPath);
    try {
      const st = fs.statSync(candidate);
      if (st.isFile()) {
        return candidate;
      }
    } catch {
      // candidate doesn't exist — keep looking
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
    this.proc = spawn(this.resolvedPath, ['serve', '--stdio'], {
      env: { ...process.env, PATH: augmentedPath(), OBSIDIAN_VAULT_PATH: vaultPath },
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
      const t = setTimeout(() => {
        const diag = this.diagnostics();
        reject(new Error(`Search server timed out.\n${diag}`));
      }, timeoutMs);
      this.readyCallbacks.push(() => {
        clearTimeout(t);
        resolve();
      });
      this.rejectCallbacks.push((err) => {
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
