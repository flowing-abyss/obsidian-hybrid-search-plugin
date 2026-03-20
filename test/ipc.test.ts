import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We mock child_process before importing SearchClient
const mockStdin = { write: vi.fn() };
const mockStdout = new EventEmitter();
const mockProc = new EventEmitter() as EventEmitter & {
  stdin: typeof mockStdin;
  stdout: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  killed: boolean;
};
mockProc.stdin = mockStdin;
mockProc.stdout = mockStdout;
mockProc.kill = vi.fn();
mockProc.exitCode = null;
mockProc.killed = false;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

import { spawn } from 'child_process';
import { SearchClient } from '../src/ipc';

function emitLine(line: string) {
  mockStdout.emit('data', Buffer.from(line + '\n', 'utf8'));
}

describe('SearchClient', () => {
  let client: SearchClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStdin.write.mockReset();
    mockProc.kill = vi.fn();
    mockProc.exitCode = null;
    mockProc.killed = false;
    // Reset EventEmitter listeners
    mockStdout.removeAllListeners();
    mockProc.removeAllListeners();
    client = new SearchClient('/usr/bin/ohs', '/vault');
  });

  afterEach(() => {
    // Avoid killing an already-disposed client
    try {
      client.dispose();
    } catch {
      // ignore
    }
  });

  it('spawns with serve --stdio and correct env', () => {
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/ohs',
      ['serve', '--stdio'],
      expect.objectContaining({
        env: expect.objectContaining({ OBSIDIAN_VAULT_PATH: '/vault' }),
      }),
    );
  });

  it('waitReady resolves when ready:true received', async () => {
    const ready = client.waitReady(1000);
    emitLine(JSON.stringify({ ready: true }));
    await expect(ready).resolves.toBeUndefined();
  });

  it('waitReady resolves immediately if already ready', async () => {
    emitLine(JSON.stringify({ ready: true }));
    await client.waitReady(1000);
    await expect(client.waitReady(100)).resolves.toBeUndefined();
  });

  it('waitReady rejects on timeout', async () => {
    await expect(client.waitReady(10)).rejects.toThrow('timed out');
  });

  it('search sends JSON line to stdin', async () => {
    emitLine(JSON.stringify({ ready: true }));
    await client.waitReady(100);

    const searchPromise = client.search('zettelkasten', { mode: 'hybrid', limit: 5 });
    expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"query":"zettelkasten"'));

    const writeCalls = mockStdin.write.mock.calls as [string][];
    const callArg = writeCalls[0]?.[0] ?? '';
    const req = JSON.parse(callArg.trim()) as { id: string; query: string };
    emitLine(
      JSON.stringify({
        id: req.id,
        results: [{ path: 'a.md', title: 'A', score: 0.9, tags: [], aliases: [] }],
      }),
    );

    const results = await searchPromise;
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('A');
  });

  it('search resolves with empty array on error response', async () => {
    emitLine(JSON.stringify({ ready: true }));
    await client.waitReady(100);

    const searchPromise = client.search('fail');
    const writeCalls = mockStdin.write.mock.calls as [string][];
    const callArg = writeCalls[0]?.[0] ?? '';
    const req = JSON.parse(callArg.trim()) as { id: string };
    emitLine(JSON.stringify({ id: req.id, error: 'something failed' }));

    await expect(searchPromise).resolves.toEqual([]);
  });

  it('handles multi-chunk buffering (line split across chunks)', async () => {
    const msg = JSON.stringify({ ready: true });
    // Emit in two parts — no newline in first chunk
    mockStdout.emit('data', Buffer.from(msg.slice(0, 5), 'utf8'));
    mockStdout.emit('data', Buffer.from(msg.slice(5) + '\n', 'utf8'));
    await expect(client.waitReady(100)).resolves.toBeUndefined();
  });

  it('ignores malformed JSON lines', async () => {
    emitLine('not json');
    emitLine(JSON.stringify({ ready: true }));
    await expect(client.waitReady(100)).resolves.toBeUndefined();
  });

  it('dispose kills the process', () => {
    client.dispose();
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('dispose does not throw if process already exited', () => {
    mockProc.exitCode = 0;
    expect(() => client.dispose()).not.toThrow();
  });

  it('dispose resolves all pending searches with empty array', async () => {
    emitLine(JSON.stringify({ ready: true }));
    await client.waitReady(100);

    // Start a search but don't emit a response
    const searchPromise = client.search('orphan');
    client.dispose();
    await expect(searchPromise).resolves.toEqual([]);
  });

  it('proc error event does not throw (graceful — surfaces via waitReady timeout)', () => {
    expect(() => mockProc.emit('error', new Error('ENOENT'))).not.toThrow();
  });
});
