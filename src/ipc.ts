import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet?: string;
  tags: string[];
  aliases: string[];
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
}

interface StdioResponse {
  ready?: boolean;
  id?: string;
  results?: SearchResult[];
  error?: string;
}

export class SearchClient {
  private proc: ChildProcess;
  private pending = new Map<string, (results: SearchResult[]) => void>();
  private counter = 0;
  private ready = false;
  private readyCallbacks: Array<() => void> = [];
  private buffer = '';

  constructor(binaryPath: string, vaultPath: string) {
    this.proc = spawn(binaryPath, ['serve', '--stdio'], {
      env: { ...process.env, OBSIDIAN_VAULT_PATH: vaultPath },
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

    this.proc.on('error', () => {
      /* binary not found — surfaces via waitReady timeout */
    });
  }

  waitReady(timeoutMs = 30_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Search server timed out')), timeoutMs);
      this.readyCallbacks.push(() => {
        clearTimeout(t);
        resolve();
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
