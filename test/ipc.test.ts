// @vitest-environment node
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
import type { RequestUrlParam } from 'obsidian';
import { requestUrl } from 'obsidian';
import { HttpSearchClient, SearchClient } from '../src/ipc';

type RequestUrlResponse = Awaited<ReturnType<typeof requestUrl>>;

function emitLine(line: string) {
  mockStdout.emit('data', Buffer.from(line + '\n', 'utf8'));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDeferredRequestUrlResponse(): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: unknown) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function healthOkResponse(): RequestUrlResponse {
  return {
    status: 200,
    headers: {},
    text: JSON.stringify({ ok: true }),
    json: { ok: true },
  } as unknown as RequestUrlResponse;
}

function initializeOkResponse(sessionId: string, id = 1): RequestUrlResponse {
  return {
    status: 200,
    headers: { 'mcp-session-id': sessionId },
    text: JSON.stringify({ jsonrpc: '2.0', id, result: {} }),
  } as unknown as RequestUrlResponse;
}

function searchOkResponse(
  results: Array<{ path: string; title: string; score: number; tags: string[]; aliases: string[] }>,
  id = 2,
): RequestUrlResponse {
  return {
    status: 200,
    headers: {},
    text: JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      },
    }),
  } as unknown as RequestUrlResponse;
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

describe('HttpSearchClient', () => {
  const requestUrlMock = vi.mocked(requestUrl);

  afterEach(() => {
    requestUrlMock.mockReset();
  });

  it('uses a short timeout for primary readiness before trying fallback', async () => {
    vi.useFakeTimers();

    const primaryHealth = deferred<RequestUrlResponse>();
    const fallbackHealth = deferred<RequestUrlResponse>();
    const fallbackInit = deferred<RequestUrlResponse>();
    const responses = [primaryHealth, fallbackHealth, fallbackInit];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
      });

      const ready = client.waitReady();
      void ready.catch(() => undefined);

      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_999);
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(2);

      fallbackHealth.resolve(healthOkResponse());
      await flushPromises();
      fallbackInit.resolve(initializeOkResponse('fallback-session'));

      await expect(ready).resolves.toBeUndefined();
      expect(requestUrlMock).toHaveBeenCalledTimes(3);
      expect((requestUrlMock.mock.calls[1]?.[0] as RequestUrlParam).url).toBe(
        'http://127.0.0.1:4949/health',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a short timeout for primary search before trying fallback search', async () => {
    vi.useFakeTimers();

    const primaryHealth = deferred<RequestUrlResponse>();
    const primaryInit = deferred<RequestUrlResponse>();
    const primarySearch = deferred<RequestUrlResponse>();
    const fallbackHealth = deferred<RequestUrlResponse>();
    const fallbackInit = deferred<RequestUrlResponse>();
    const fallbackSearch = deferred<RequestUrlResponse>();
    const responses = [
      primaryHealth,
      primaryInit,
      primarySearch,
      fallbackHealth,
      fallbackInit,
      fallbackSearch,
    ];
    primaryHealth.resolve(healthOkResponse());
    primaryInit.resolve(initializeOkResponse('primary-session'));
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
      });

      const resultsPromise = client.search('query');
      void resultsPromise.catch(() => undefined);

      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(1_999);
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(4);

      fallbackHealth.resolve(healthOkResponse());
      await flushPromises();
      fallbackInit.resolve(initializeOkResponse('fallback-session', 3));
      await flushPromises();
      fallbackSearch.resolve(
        searchOkResponse([
          { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
        ]),
      );

      await expect(resultsPromise).resolves.toEqual([
        { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
      ]);
      expect(requestUrlMock).toHaveBeenCalledTimes(6);
      expect((requestUrlMock.mock.calls[5]?.[0] as RequestUrlParam).url).toBe(
        'http://127.0.0.1:4949/mcp',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits a status event when fallback becomes active', async () => {
    const onStatusChange = vi.fn();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce(healthOkResponse())
      .mockResolvedValueOnce(initializeOkResponse('fallback-session'));

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
      onStatusChange,
    });

    await expect(client.waitReady()).resolves.toBeUndefined();

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith({
      type: 'fallback-activated',
      from: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
      to: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
      reason: 'HTTP MCP server is not healthy: 503',
    });
  });

  it('emits a status event when primary is restored', async () => {
    vi.useFakeTimers();

    const onStatusChange = vi.fn();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce(healthOkResponse())
      .mockResolvedValueOnce(initializeOkResponse('fallback-session'))
      .mockResolvedValueOnce(searchOkResponse([]))
      .mockResolvedValueOnce(healthOkResponse())
      .mockResolvedValueOnce(initializeOkResponse('primary-session', 4))
      .mockResolvedValueOnce(searchOkResponse([], 5));

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
        onStatusChange,
      });

      await client.search('fallback first');
      await vi.advanceTimersByTimeAsync(60_000);
      await client.search('primary again');

      expect(onStatusChange).toHaveBeenCalledTimes(2);
      expect(onStatusChange).toHaveBeenLastCalledWith({
        type: 'primary-restored',
        from: { host: '127.0.0.1', port: 4949, label: '127.0.0.1:4949' },
        to: { host: 'remote.example.com', port: 3939, label: 'remote.example.com:3939' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit fallback activation after dispose while failover is in flight', async () => {
    const onStatusChange = vi.fn();
    const primaryHealth = deferred<RequestUrlResponse>();
    const fallbackHealth = deferred<RequestUrlResponse>();
    const fallbackInit = deferred<RequestUrlResponse>();
    const responses = [primaryHealth, fallbackHealth, fallbackInit];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
      onStatusChange,
    });

    const ready = client.waitReady();
    void ready.catch(() => undefined);
    await flushPromises();

    client.dispose();
    primaryHealth.resolve({
      status: 503,
      headers: {},
      text: 'primary unavailable',
    } as never);
    await flushPromises();
    fallbackHealth.resolve(healthOkResponse());
    await flushPromises();
    fallbackInit.resolve(initializeOkResponse('fallback-session'));
    await expect(ready).resolves.toBeUndefined();

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('does not emit fallback failure after dispose while failover is in flight', async () => {
    const onStatusChange = vi.fn();
    const primaryHealth = deferred<RequestUrlResponse>();
    const fallbackHealth = deferred<RequestUrlResponse>();
    const responses = [primaryHealth, fallbackHealth];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
      onStatusChange,
    });

    const ready = client.waitReady();
    void ready.catch(() => undefined);
    await flushPromises();

    client.dispose();
    primaryHealth.resolve({
      status: 503,
      headers: {},
      text: 'primary unavailable',
    } as never);
    await flushPromises();
    fallbackHealth.resolve({
      status: 503,
      headers: {},
      text: 'fallback unavailable',
    } as never);
    await expect(ready).rejects.toThrow('HTTP MCP server is not healthy: 503');

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('does not emit primary restore after dispose while restore probe is in flight', async () => {
    vi.useFakeTimers();

    const onStatusChange = vi.fn();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce(healthOkResponse())
      .mockResolvedValueOnce(initializeOkResponse('fallback-session'))
      .mockResolvedValueOnce(searchOkResponse([]));

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
        onStatusChange,
      });

      await client.search('fallback first');
      onStatusChange.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);

      const primaryHealth = deferred<RequestUrlResponse>();
      const primaryInit = deferred<RequestUrlResponse>();
      const fallbackSearch = deferred<RequestUrlResponse>();
      requestUrlMock
        .mockImplementationOnce(() => primaryHealth.promise as never)
        .mockImplementationOnce(() => primaryInit.promise as never)
        .mockImplementationOnce(() => fallbackSearch.promise as never);

      const search = client.search('restore primary');
      void search.catch(() => undefined);
      await flushPromises();

      client.dispose();
      primaryHealth.resolve(healthOkResponse());
      await flushPromises();
      primaryInit.resolve(initializeOkResponse('primary-session', 4));
      await flushPromises();
      fallbackSearch.resolve(searchOkResponse([], 5));
      await expect(search).resolves.toEqual([]);

      expect(onStatusChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails over to fallback when primary readiness fails', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    await expect(client.search('query')).resolves.toEqual([
      { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
    ]);
    expect((requestUrlMock.mock.calls[0]?.[0] as RequestUrlParam).url).toBe(
      'http://remote.example.com:3939/health',
    );
    expect((requestUrlMock.mock.calls[1]?.[0] as RequestUrlParam).url).toBe(
      'http://127.0.0.1:4949/health',
    );
    expect((requestUrlMock.mock.calls[3]?.[0] as RequestUrlParam).url).toBe(
      'http://127.0.0.1:4949/mcp',
    );
  });

  it('retries primary immediately when fallback search fails after primary readiness fails', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'fallback unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'primary-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'primary.md', title: 'Primary', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    await expect(client.search('first')).rejects.toThrow('HTTP MCP request failed: 503');
    await expect(client.search('second')).resolves.toEqual([
      { path: 'primary.md', title: 'Primary', score: 1, tags: [], aliases: [] },
    ]);

    const urls = requestUrlMock.mock.calls.map((call) => (call[0] as RequestUrlParam).url);
    expect(urls).toEqual([
      'http://remote.example.com:3939/health',
      'http://127.0.0.1:4949/health',
      'http://127.0.0.1:4949/mcp',
      'http://127.0.0.1:4949/mcp',
      'http://remote.example.com:3939/health',
      'http://remote.example.com:3939/mcp',
      'http://remote.example.com:3939/mcp',
    ]);
  });

  it('fails over to fallback when primary health body is not ok', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: false }),
        json: { ok: false },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    await expect(client.search('query')).resolves.toEqual([
      { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
    ]);
    expect((requestUrlMock.mock.calls[1]?.[0] as RequestUrlParam).url).toBe(
      'http://127.0.0.1:4949/health',
    );
  });

  it('fails over to fallback when primary health JSON is malformed', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '{not json',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    await expect(client.search('query')).resolves.toEqual([
      { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
    ]);
    expect((requestUrlMock.mock.calls[1]?.[0] as RequestUrlParam).url).toBe(
      'http://127.0.0.1:4949/health',
    );
  });

  it('fails over to fallback when primary health JSON is null', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: 'null',
        json: null,
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    await expect(client.search('query')).resolves.toEqual([
      { path: 'fallback.md', title: 'Fallback', score: 1, tags: [], aliases: [] },
    ]);
    expect((requestUrlMock.mock.calls[1]?.[0] as RequestUrlParam).url).toBe(
      'http://127.0.0.1:4949/health',
    );
  });

  it('continues using fallback without probing primary before primary retry cooldown', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValue({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] },
        }),
      } as never);

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
      });

      await client.search('first');
      await vi.advanceTimersByTimeAsync(30_000);
      await client.search('second');

      const urls = requestUrlMock.mock.calls.map((call) => (call[0] as RequestUrlParam).url);
      expect(urls.filter((url) => url === 'http://remote.example.com:3939/health')).toHaveLength(1);
      expect(urls[urls.length - 1]).toBe('http://127.0.0.1:4949/mcp');
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches back to primary after fallback primary retry cooldown', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] },
        }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'primary-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          result: { content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] },
        }),
      } as never);

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
      });

      await client.search('first');
      await vi.advanceTimersByTimeAsync(60_000);
      await client.search('second');

      const urls = requestUrlMock.mock.calls.map((call) => (call[0] as RequestUrlParam).url);
      expect(urls).toContain('http://remote.example.com:3939/health');
      expect(urls[urls.length - 1]).toBe('http://remote.example.com:3939/mcp');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waitReady fails over to fallback when primary readiness fails', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'fallback-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    await expect(client.waitReady()).resolves.toBeUndefined();
    expect((requestUrlMock.mock.calls[0]?.[0] as RequestUrlParam).url).toBe(
      'http://remote.example.com:3939/health',
    );
    expect((requestUrlMock.mock.calls[1]?.[0] as RequestUrlParam).url).toBe(
      'http://127.0.0.1:4949/health',
    );
  });

  it('fails over when primary reconnect cooldown is active before fallback becomes active', async () => {
    const primaryHealth = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const primaryInit = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const firstPrimarySearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const fallbackHealth = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const fallbackInit = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const firstFallbackSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const secondFallbackSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const responses = [
      primaryHealth,
      primaryInit,
      firstPrimarySearch,
      fallbackHealth,
      fallbackInit,
      firstFallbackSearch,
      secondFallbackSearch,
    ];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    const ready = client.waitReady();
    primaryHealth.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({ ok: true }),
      json: { ok: true },
    } as never);
    await flushPromises();
    primaryInit.resolve({
      status: 200,
      headers: { 'mcp-session-id': 'primary-session' },
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
    } as never);
    await expect(ready).resolves.toBeUndefined();

    const firstSearch = client.search('first primary request');
    void firstSearch.catch(() => undefined);
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(3);

    firstPrimarySearch.resolve({
      status: 503,
      headers: {},
      text: 'primary unavailable',
    } as never);
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(4);

    const secondSearch = client.search('second primary request');
    void secondSearch.catch(() => undefined);
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(4);

    fallbackHealth.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({ ok: true }),
      json: { ok: true },
    } as never);
    await flushPromises();
    fallbackInit.resolve({
      status: 200,
      headers: { 'mcp-session-id': 'fallback-session' },
      text: JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }),
    } as never);
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(7);
    expect(requestUrlMock.mock.calls[5]?.[0]).toEqual(
      expect.objectContaining({
        url: 'http://127.0.0.1:4949/mcp',
        headers: expect.objectContaining({ 'mcp-session-id': 'fallback-session' }),
      }),
    );
    expect(requestUrlMock.mock.calls[6]?.[0]).toEqual(
      expect.objectContaining({
        url: 'http://127.0.0.1:4949/mcp',
        headers: expect.objectContaining({ 'mcp-session-id': 'fallback-session' }),
      }),
    );

    firstFallbackSearch.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [{ path: 'first.md', title: 'First', score: 1, tags: [], aliases: [] }],
              }),
            },
          ],
        },
      }),
    } as never);
    secondFallbackSearch.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [{ path: 'second.md', title: 'Second', score: 1, tags: [], aliases: [] }],
              }),
            },
          ],
        },
      }),
    } as never);

    await expect(firstSearch).resolves.toEqual([
      { path: 'first.md', title: 'First', score: 1, tags: [], aliases: [] },
    ]);
    await expect(secondSearch).resolves.toEqual([
      { path: 'second.md', title: 'Second', score: 1, tags: [], aliases: [] },
    ]);
  });

  it('does not mark an endpoint ready from a failed initialize session header', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 500,
        headers: { 'mcp-session-id': 'failed-init-session' },
        text: 'initialize failed',
      } as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      await expect(client.waitReady()).rejects.toThrow('HTTP MCP request failed: 500');
      await expect(client.waitReady()).rejects.toThrow('HTTP MCP reconnect cooling down');
      expect(requestUrlMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mark an endpoint ready when initialize returns a session header with invalid JSON', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'failed-init-session' },
        text: '{not json',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'recovered-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }),
      } as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      await expect(client.waitReady()).rejects.toThrow();
      await expect(client.waitReady()).rejects.toThrow('HTTP MCP reconnect cooling down');
      expect(requestUrlMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(client.waitReady()).resolves.toBeUndefined();
      expect(requestUrlMock).toHaveBeenCalledTimes(4);
      expect(requestUrlMock.mock.calls[2]?.[0]).toEqual(
        expect.objectContaining({ url: 'http://127.0.0.1:3939/health' }),
      );
      const recoveredInit = requestUrlMock.mock.calls[3]?.[0] as RequestUrlParam;
      expect(recoveredInit.url).toBe('http://127.0.0.1:3939/mcp');
      expect(recoveredInit.headers).not.toHaveProperty('mcp-session-id', 'failed-init-session');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mark an endpoint ready when initialize returns a JSON-RPC error with a session header', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'failed-init-session' },
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'initialize failed' },
        }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'recovered-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }),
      } as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      await expect(client.waitReady()).rejects.toThrow('initialize failed');
      await expect(client.waitReady()).rejects.toThrow('HTTP MCP reconnect cooling down');
      expect(requestUrlMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(client.waitReady()).resolves.toBeUndefined();
      expect(requestUrlMock).toHaveBeenCalledTimes(4);
      expect(requestUrlMock.mock.calls[2]?.[0]).toEqual(
        expect.objectContaining({ url: 'http://127.0.0.1:3939/health' }),
      );
      const recoveredInit = requestUrlMock.mock.calls[3]?.[0] as RequestUrlParam;
      expect(recoveredInit.url).toBe('http://127.0.0.1:3939/mcp');
      expect(recoveredInit.headers).not.toHaveProperty('mcp-session-id', 'failed-init-session');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fail over because of a late stale response from an old primary generation', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'primary-session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);

    const firstSearch = createDeferredRequestUrlResponse();
    const secondSearch = createDeferredRequestUrlResponse();
    requestUrlMock
      .mockImplementationOnce(() => firstSearch.promise as never)
      .mockImplementationOnce(() => secondSearch.promise as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'primary-session-2' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          result: { content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] },
        }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          result: { content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] },
        }),
      } as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });
    await client.waitReady();

    const oldOne = client.search('old one');
    const oldTwo = client.search('old two');

    firstSearch.resolve({
      status: 404,
      headers: {},
      text: 'session not found',
    });
    await expect(oldOne).resolves.toEqual([]);

    secondSearch.resolve({
      status: 404,
      headers: {},
      text: 'session not found',
    });
    await expect(oldTwo).rejects.toThrow('HTTP MCP request failed: 404');

    await expect(client.search('after primary recovery')).resolves.toEqual([]);
    const urls = requestUrlMock.mock.calls.map((call) => (call[0] as RequestUrlParam).url);
    expect(urls).not.toContain('http://127.0.0.1:4949/health');
    expect(urls[urls.length - 1]).toBe('http://remote.example.com:3939/mcp');
  });

  it('fails over using the originally attempted primary when active changes during in-flight search', async () => {
    const primaryHealth = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const primaryInit = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const firstPrimarySearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const secondPrimarySearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const fallbackHealth = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const fallbackInit = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const secondFallbackSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const firstFallbackSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const responses = [
      primaryHealth,
      primaryInit,
      firstPrimarySearch,
      secondPrimarySearch,
      fallbackHealth,
      fallbackInit,
      secondFallbackSearch,
      firstFallbackSearch,
    ];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    const client = new HttpSearchClient('remote.example.com', 3939, {
      fallback: { host: '127.0.0.1', port: 4949 },
    });

    const ready = client.waitReady();
    primaryHealth.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({ ok: true }),
      json: { ok: true },
    } as never);
    await flushPromises();
    primaryInit.resolve({
      status: 200,
      headers: { 'mcp-session-id': 'primary-session' },
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
    } as never);
    await expect(ready).resolves.toBeUndefined();

    const firstSearch = client.search('first primary request');
    void firstSearch.catch(() => undefined);
    const secondSearch = client.search('second primary request');
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(4);

    secondPrimarySearch.resolve({
      status: 503,
      headers: {},
      text: 'primary unavailable',
    } as never);
    await flushPromises();
    fallbackHealth.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({ ok: true }),
      json: { ok: true },
    } as never);
    await flushPromises();
    fallbackInit.resolve({
      status: 200,
      headers: { 'mcp-session-id': 'fallback-session' },
      text: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }),
    } as never);
    await flushPromises();
    secondFallbackSearch.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [{ path: 'second.md', title: 'Second', score: 1, tags: [], aliases: [] }],
              }),
            },
          ],
        },
      }),
    } as never);
    await expect(secondSearch).resolves.toEqual([
      { path: 'second.md', title: 'Second', score: 1, tags: [], aliases: [] },
    ]);

    firstPrimarySearch.resolve({
      status: 503,
      headers: {},
      text: 'primary unavailable',
    } as never);
    await flushPromises();
    await flushPromises();
    expect(requestUrlMock.mock.calls[7]?.[0]).toEqual(
      expect.objectContaining({
        url: 'http://127.0.0.1:4949/mcp',
        headers: expect.objectContaining({ 'mcp-session-id': 'fallback-session' }),
      }),
    );

    firstFallbackSearch.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [{ path: 'first.md', title: 'First', score: 1, tags: [], aliases: [] }],
              }),
            },
          ],
        },
      }),
    } as never);
    await expect(firstSearch).resolves.toEqual([
      { path: 'first.md', title: 'First', score: 1, tags: [], aliases: [] },
    ]);
  });

  it('checks health and initializes an MCP session', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    await expect(client.waitReady()).resolves.toBeUndefined();
    expect(requestUrlMock).toHaveBeenNthCalledWith(1, {
      url: 'http://127.0.0.1:3939/health',
      throw: false,
    });
    expect(requestUrlMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'http://127.0.0.1:3939/mcp',
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        }),
      }),
    );
  });

  it('retries readiness after cooldown when the HTTP server comes back', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      await expect(client.waitReady()).rejects.toThrow('HTTP MCP server is not healthy: 503');
      await expect(client.waitReady()).rejects.toThrow('HTTP MCP reconnect cooling down');
      expect(requestUrlMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(client.waitReady()).resolves.toBeUndefined();
      expect(requestUrlMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps repeated readiness retries with increasing cooldowns', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      await expect(client.waitReady()).rejects.toThrow('HTTP MCP server is not healthy: 503');
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(client.waitReady()).rejects.toThrow('HTTP MCP server is not healthy: 503');

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(client.waitReady()).rejects.toThrow('HTTP MCP reconnect cooling down');
      expect(requestUrlMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(3_000);
      await expect(client.waitReady()).resolves.toBeUndefined();
      expect(requestUrlMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records only one cooldown when concurrent readiness calls share a failed initialization', async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      const attempts = await Promise.allSettled([client.waitReady(), client.waitReady()]);
      expect(attempts).toEqual([
        expect.objectContaining({ status: 'rejected' }),
        expect.objectContaining({ status: 'rejected' }),
      ]);
      expect(requestUrlMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(client.waitReady()).resolves.toBeUndefined();
      expect(requestUrlMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries immediately when concurrent no-fallback established-session searches share an outage', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [{ path: 'back.md', title: 'Back', score: 1, tags: [], aliases: [] }],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);
    await client.waitReady();

    const attempts = await Promise.allSettled([
      client.search('while down one'),
      client.search('while down two'),
    ]);
    expect(attempts).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(4);

    await expect(client.search('after outage')).resolves.toEqual([
      { path: 'back.md', title: 'Back', score: 1, tags: [], aliases: [] },
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(5);
    expect(requestUrlMock.mock.calls[4]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );
  });

  it('throttles fallback-failed status events while primary and fallback remain down', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    requestUrlMock
      .mockResolvedValueOnce(healthOkResponse())
      .mockResolvedValueOnce(initializeOkResponse('primary-session'))
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'fallback unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'primary still unavailable',
      } as never);

    try {
      const client = new HttpSearchClient('remote.example.com', 3939, {
        fallback: { host: '127.0.0.1', port: 4949 },
        onStatusChange: (event) => events.push(event),
      });
      await client.waitReady();

      await expect(client.search('first outage')).rejects.toThrow(
        'HTTP MCP server is not healthy: 503',
      );
      await expect(client.search('second outage')).rejects.toThrow(
        'HTTP MCP reconnect cooling down',
      );

      expect(
        events.filter((event) => (event as { type?: string }).type === 'fallback-failed'),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not advance backoff when a late stale-generation outage arrives after recovery', async () => {
    vi.useFakeTimers();

    const health1 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const init1 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const oldStaleSession = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const oldLateOutage = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const health2 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const init2 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const recoveredSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const currentOutage = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const finalSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const responses = [
      health1,
      init1,
      oldStaleSession,
      oldLateOutage,
      health2,
      init2,
      recoveredSearch,
      currentOutage,
      finalSearch,
    ];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      const ready = client.waitReady();
      health1.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never);
      await flushPromises();
      init1.resolve({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);
      await expect(ready).resolves.toBeUndefined();

      const staleRetry = client.search('old stale session');
      const lateOldOutage = client.search('old late outage');
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(4);

      oldStaleSession.resolve({
        status: 404,
        headers: {},
        text: 'session not found',
      } as never);
      await flushPromises();

      health2.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never);
      await flushPromises();
      init2.resolve({
        status: 200,
        headers: { 'mcp-session-id': 'session-2' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }),
      } as never);
      await flushPromises();
      recoveredSearch.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'recovered.md', title: 'Recovered', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);
      await expect(staleRetry).resolves.toEqual([
        { path: 'recovered.md', title: 'Recovered', score: 1, tags: [], aliases: [] },
      ]);

      oldLateOutage.resolve({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never);
      await expect(lateOldOutage).rejects.toThrow('HTTP MCP request failed: 503');

      const currentFailure = client.search('current outage');
      currentOutage.resolve({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never);
      await expect(currentFailure).rejects.toThrow('HTTP MCP request failed: 503');

      const finalRecovery = client.search('after current outage recovery');
      finalSearch.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 8,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [{ path: 'final.md', title: 'Final', score: 1, tags: [], aliases: [] }],
                }),
              },
            ],
          },
        }),
      } as never);
      await expect(finalRecovery).resolves.toEqual([
        { path: 'final.md', title: 'Final', score: 1, tags: [], aliases: [] },
      ]);

      expect(requestUrlMock).toHaveBeenCalledTimes(9);
      expect(requestUrlMock.mock.calls[7]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'mcp-session-id': 'session-2' }),
        }),
      );
      expect(requestUrlMock.mock.calls[8]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'mcp-session-id': 'session-2' }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores late old-session stale 404 after stale-session recovery', async () => {
    const health1 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const init1 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const oldStaleSession = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const oldLateStaleSession = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const health2 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const init2 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const recoveredSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const currentSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const responses = [
      health1,
      init1,
      oldStaleSession,
      oldLateStaleSession,
      health2,
      init2,
      recoveredSearch,
      currentSearch,
    ];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    const ready = client.waitReady();
    health1.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({ ok: true }),
      json: { ok: true },
    } as never);
    await flushPromises();
    init1.resolve({
      status: 200,
      headers: { 'mcp-session-id': 'session-1' },
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
    } as never);
    await expect(ready).resolves.toBeUndefined();

    const staleRetry = client.search('old stale session');
    const lateOldStale = client.search('old late stale session');
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
    expect(requestUrlMock.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );
    expect(requestUrlMock.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );

    oldStaleSession.resolve({
      status: 404,
      headers: {},
      text: 'session not found',
    } as never);
    await flushPromises();

    health2.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({ ok: true }),
      json: { ok: true },
    } as never);
    await flushPromises();
    init2.resolve({
      status: 200,
      headers: { 'mcp-session-id': 'session-2' },
      text: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }),
    } as never);
    await flushPromises();
    recoveredSearch.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [
                  { path: 'recovered.md', title: 'Recovered', score: 1, tags: [], aliases: [] },
                ],
              }),
            },
          ],
        },
      }),
    } as never);
    await expect(staleRetry).resolves.toEqual([
      { path: 'recovered.md', title: 'Recovered', score: 1, tags: [], aliases: [] },
    ]);

    oldLateStaleSession.resolve({
      status: 404,
      headers: {},
      text: 'session not found',
    } as never);
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(7);
    await expect(lateOldStale).rejects.toThrow('HTTP MCP request failed: 404');

    const stillRecovered = client.search('still on recovered session');
    await flushPromises();
    expect(requestUrlMock).toHaveBeenCalledTimes(8);
    expect(requestUrlMock.mock.calls[7]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-2' }),
      }),
    );

    currentSearch.resolve({
      status: 200,
      headers: {},
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [
                  { path: 'current.md', title: 'Current', score: 1, tags: [], aliases: [] },
                ],
              }),
            },
          ],
        },
      }),
    } as never);
    await expect(stillRecovered).resolves.toEqual([
      { path: 'current.md', title: 'Current', score: 1, tags: [], aliases: [] },
    ]);
  });

  it('ignores late old-session outages while stale-session reinitialize is in progress', async () => {
    vi.useFakeTimers();

    const health1 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const init1 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const oldStaleSession = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const oldLateOutage = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const health2 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const init2 = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const recoveredSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const followerSearch = deferred<Awaited<ReturnType<typeof requestUrl>>>();
    const responses = [
      health1,
      init1,
      oldStaleSession,
      oldLateOutage,
      health2,
      init2,
      recoveredSearch,
      followerSearch,
    ];
    requestUrlMock.mockImplementation(() => responses.shift()!.promise as never);

    try {
      const client = new HttpSearchClient('127.0.0.1', 3939);

      const ready = client.waitReady();
      health1.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never);
      await flushPromises();
      init1.resolve({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never);
      await expect(ready).resolves.toBeUndefined();

      const staleRetry = client.search('old stale session');
      const lateOldOutage = client.search('old late outage');
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(4);
      expect(requestUrlMock.mock.calls[2]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
        }),
      );
      expect(requestUrlMock.mock.calls[3]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
        }),
      );

      oldStaleSession.resolve({
        status: 404,
        headers: {},
        text: 'session not found',
      } as never);
      await flushPromises();
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(5);

      oldLateOutage.resolve({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never);
      await expect(lateOldOutage).rejects.toThrow('HTTP MCP request failed: 503');

      const follower = client.search('during stale recovery');
      void follower.catch(() => undefined);
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(5);

      health2.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never);
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(6);
      init2.resolve({
        status: 200,
        headers: { 'mcp-session-id': 'session-2' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }),
      } as never);
      await flushPromises();
      await flushPromises();
      expect(requestUrlMock).toHaveBeenCalledTimes(8);
      expect(requestUrlMock.mock.calls[6]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'mcp-session-id': 'session-2' }),
        }),
      );
      expect(requestUrlMock.mock.calls[7]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'mcp-session-id': 'session-2' }),
        }),
      );

      recoveredSearch.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'recovered.md', title: 'Recovered', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);
      followerSearch.resolve({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'follower.md', title: 'Follower', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

      await expect(staleRetry).resolves.toEqual([
        { path: 'recovered.md', title: 'Recovered', score: 1, tags: [], aliases: [] },
      ]);
      await expect(follower).resolves.toEqual([
        { path: 'follower.md', title: 'Follower', score: 1, tags: [], aliases: [] },
      ]);
      expect(requestUrlMock).toHaveBeenCalledTimes(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls MCP search tool and maps plugin option names', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [{ path: 'a.md', title: 'A', score: 0.9, tags: [], aliases: [] }],
                }),
              },
            ],
          },
        }),
      } as never);
    const client = new HttpSearchClient('127.0.0.1', 3939);

    const results = await client.search('zettelkasten', {
      mode: 'hybrid',
      limit: 5,
      snippetLength: 400,
      notePath: 'source.md',
      anchors: true,
    });

    expect(results).toHaveLength(1);
    const callRequest = requestUrlMock.mock.calls[2]?.[0] as RequestUrlParam;
    const callBody = JSON.parse(callRequest.body as string) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    expect(callBody.method).toBe('tools/call');
    expect(callBody.params.name).toBe('search');
    expect(callBody.params.arguments).toMatchObject({
      query: 'zettelkasten',
      mode: 'hybrid',
      limit: 5,
      snippet_length: 400,
      path: 'source.md',
      anchors: true,
    });
    expect(requestUrlMock.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );
  });

  it('reinitializes once and retries search when the stored MCP session is stale', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'old-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 404,
        headers: {},
        text: 'session not found',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'new-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'restored.md', title: 'Restored', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    const results = await client.search('after restart');

    expect(results).toEqual([
      { path: 'restored.md', title: 'Restored', score: 1, tags: [], aliases: [] },
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(6);
    expect(requestUrlMock.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'old-session' }),
      }),
    );
    expect(requestUrlMock.mock.calls[5]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'new-session' }),
      }),
    );
  });

  it('retries immediately when a no-fallback stale-session retry hits an unavailable server', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'old-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 404,
        headers: {},
        text: 'session not found',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'new-session' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    { path: 'restored.md', title: 'Restored', score: 1, tags: [], aliases: [] },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    await expect(client.search('stale then down')).rejects.toThrow('HTTP MCP request failed: 503');
    expect(requestUrlMock).toHaveBeenCalledTimes(6);

    await expect(client.search('after outage')).resolves.toEqual([
      { path: 'restored.md', title: 'Restored', score: 1, tags: [], aliases: [] },
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(7);
    expect(requestUrlMock.mock.calls[6]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'new-session' }),
      }),
    );
  });

  it('does not store a replacement session from a failed search response', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: { 'mcp-session-id': 'failed-search-session' },
        text: 'temporarily unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [{ path: 'back.md', title: 'Back', score: 1, tags: [], aliases: [] }],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    await expect(client.search('while down')).rejects.toThrow('HTTP MCP request failed: 503');
    await expect(client.search('after outage')).resolves.toEqual([
      { path: 'back.md', title: 'Back', score: 1, tags: [], aliases: [] },
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
    expect(requestUrlMock.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );
  });

  it('retries immediately when a no-fallback established HTTP MCP server becomes unavailable', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
        text: 'temporarily unavailable',
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [{ path: 'back.md', title: 'Back', score: 1, tags: [], aliases: [] }],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    await expect(client.search('while down')).rejects.toThrow('HTTP MCP request failed: 503');
    await expect(client.search('after outage')).resolves.toEqual([
      { path: 'back.md', title: 'Back', score: 1, tags: [], aliases: [] },
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
    expect(requestUrlMock.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );
  });

  it('retries immediately when a no-fallback established HTTP MCP server cannot be reached', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({ ok: true }),
        json: { ok: true },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
        text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      } as never)
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:3939'))
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    {
                      path: 'network-back.md',
                      title: 'Network Back',
                      score: 1,
                      tags: [],
                      aliases: [],
                    },
                  ],
                }),
              },
            ],
          },
        }),
      } as never);

    const client = new HttpSearchClient('127.0.0.1', 3939);

    await expect(client.search('while unreachable')).rejects.toThrow('connect ECONNREFUSED');
    await expect(client.search('after network recovery')).resolves.toEqual([
      {
        path: 'network-back.md',
        title: 'Network Back',
        score: 1,
        tags: [],
        aliases: [],
      },
    ]);
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
    expect(requestUrlMock.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'mcp-session-id': 'session-1' }),
      }),
    );
  });
});
