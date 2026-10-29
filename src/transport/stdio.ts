import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import type { SearchOptions, SearchResult, SearchService } from '../search/contracts';
import { buildCliEnv, resolveBinary } from './cliEnvironment';
import { OUTDATED_CLI_MESSAGE, isUnsupportedStatusError } from './errors';

interface StdioResponse {
  ready?: boolean;
  id?: string;
  results?: SearchResult[];
  status?: Record<string, unknown>;
  error?: string;
}

export class SearchClient implements SearchService {
  private proc: ChildProcess;
  private pending = new Map<string, (msg: StdioResponse) => void>();
  private counter = 0;
  private ready = false;
  private readyWaiters = new Set<(error?: Error) => void>();
  private terminalError: Error | null = null;
  private disposed = false;
  private buffer = '';
  private spawnError: Error | null = null;
  private stderrLines: string[] = [];
  private binaryPath: string;
  private resolvedPath: string;

  constructor(binaryPath: string, vaultPath: string, apiKey = '') {
    this.binaryPath = binaryPath;
    this.resolvedPath = resolveBinary(binaryPath);
    const needsShell =
      process.platform === 'win32' &&
      (this.resolvedPath.endsWith('.cmd') || this.resolvedPath.endsWith('.bat'));
    this.proc = spawn(this.resolvedPath, ['serve', '--stdio'], {
      env: buildCliEnv(vaultPath, apiKey),
      shell: needsShell,
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      if (this.terminalError) return;
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as StdioResponse;
          if (msg.ready) {
            this.ready = true;
            for (const settle of this.readyWaiters) settle();
          } else if (msg.id !== undefined) {
            const resolve = this.pending.get(msg.id);
            if (resolve) {
              resolve(msg);
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

    this.proc.on('error', (error: Error) => {
      this.spawnError = error;
      this.terminate(error);
    });
    this.proc.on('exit', (code, signal) =>
      this.terminate(new Error(`Search server exited (${signal ?? code ?? 'unknown'}).`)),
    );
    this.proc.on('close', (code, signal) =>
      this.terminate(new Error(`Search server closed (${signal ?? code ?? 'unknown'}).`)),
    );
    this.proc.stdin?.on?.('error', (error: Error) => this.terminate(error));
  }

  private terminate(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = new Error(`${error.message}\n${this.diagnostics()}`);
    this.ready = false;
    this.buffer = '';
    for (const settle of this.readyWaiters) settle(this.terminalError);
    for (const settle of this.pending.values()) settle({ error: this.terminalError.message });
    this.pending.clear();
  }

  private write(message: object): void {
    if (this.terminalError) return;
    try {
      if (!this.proc.stdin || this.proc.stdin.destroyed)
        throw new Error('Search server input closed.');
      this.proc.stdin.write(JSON.stringify(message) + '\n');
    } catch (error) {
      this.terminate(error instanceof Error ? error : new Error(String(error)));
    }
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
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const settle = (error?: Error) => {
        window.clearTimeout(timer);
        this.readyWaiters.delete(settle);
        if (error) reject(error);
        else resolve();
      };
      const timer = window.setTimeout(() => {
        settle(new Error(`Search server timed out.\n${this.diagnostics()}`));
      }, timeoutMs);
      this.readyWaiters.add(settle);
    });
  }

  search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (this.terminalError) return Promise.resolve([]);
    return new Promise((resolve) => {
      const id = String(++this.counter);
      this.pending.set(id, (msg) => {
        resolve(msg.error ? [] : (msg.results ?? []));
      });
      this.write({ id, query, options });
    });
  }

  /** Index and provider report from the already-running server.
   *  Uses the live connection rather than a second process, so it costs one
   *  round-trip and never touches the database on its own. */
  statusReport(timeoutMs = 15_000): Promise<Record<string, unknown>> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    return new Promise((resolve, reject) => {
      const id = String(++this.counter);
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Status request timed out.'));
      }, timeoutMs);

      this.pending.set(id, (msg) => {
        window.clearTimeout(timer);
        if (msg.error) {
          reject(new Error(isUnsupportedStatusError(msg.error) ? OUTDATED_CLI_MESSAGE : msg.error));
          return;
        }
        if (!msg.status) {
          reject(new Error(OUTDATED_CLI_MESSAGE));
          return;
        }
        resolve(msg.status);
      });

      this.waitReady(timeoutMs).then(
        () => {
          if (this.pending.has(id)) this.write({ id, action: 'status' });
        },
        (err: unknown) => {
          window.clearTimeout(timer);
          this.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminate(new Error('Search server was stopped.'));
    if (this.proc.exitCode === null && !this.proc.killed) this.proc.kill();
  }
}
