import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

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
 *  On macOS these paths are already present; on Linux they often aren't. */
function augmentedPath(): string {
  const extra = [
    '/usr/local/bin',
    '/usr/bin',
    `${process.env.HOME ?? ''}/.local/bin`,
    `${process.env.HOME ?? ''}/.npm/bin`,
    `${process.env.HOME ?? ''}/.npm-global/bin`,
    `${process.env.HOME ?? ''}/.yarn/bin`,
    `${process.env.HOME ?? ''}/.pnpm`,
  ]
    .filter(Boolean)
    .join(':');
  const existing = process.env.PATH ?? '';
  return existing ? `${existing}:${extra}` : extra;
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

  constructor(binaryPath: string, vaultPath: string) {
    this.proc = spawn(binaryPath, ['serve', '--stdio'], {
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
  private diagnostics(binaryPath: string): string {
    const parts: string[] = [`binary: "${binaryPath}"`];
    if (this.spawnError) parts.push(`spawn error: ${this.spawnError.message}`);
    if (this.stderrLines.length) parts.push(`stderr: ${this.stderrLines.slice(-3).join(' | ')}`);
    parts.push(`PATH: ${process.env.PATH ?? '(empty)'}`);
    return parts.join('\n');
  }

  waitReady(timeoutMs = 30_000, binaryPath = 'obsidian-hybrid-search'): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.spawnError) return Promise.reject(this.spawnError);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const diag = this.diagnostics(binaryPath);
        reject(new Error(`Search server timed out.\n${diag}`));
      }, timeoutMs);
      this.readyCallbacks.push(() => {
        clearTimeout(t);
        resolve();
      });
      this.rejectCallbacks.push((err) => {
        clearTimeout(t);
        const diag = this.diagnostics(binaryPath);
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
