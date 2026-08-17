import { describe, expect, it, vi } from 'vitest';
import { isUnsupportedStatusError } from '../src/ipc';
import { fetchStatus, isStatusCapable, normaliseStatus } from '../src/status';

const REPORT: Record<string, unknown> = {
  total: 3315,
  indexed: 3287,
  notes_without_chunks: 28,
  pending: 0,
  chunks: 12000,
  failed_chunks: 1,
  links: 900,
  last_indexed: '2026-08-17T11:20:11.782Z',
  db_size_mb: 4.2,
  api_base_url: 'http://127.0.0.1:1234/v1',
  model: 'text-embedding-bge-m3',
  active_model: 'text-embedding-bge-m3',
  embedding_dim: 1024,
  context_length: 512,
  version: '0.14.2',
  ignore_patterns: ['.obsidian/**', '*.canvas'],
};

describe('normaliseStatus', () => {
  it('maps the server report onto the panel shape', () => {
    const status = normaliseStatus(REPORT);
    expect(status.total).toBe(3315);
    expect(status.indexed).toBe(3287);
    expect(status.notesWithoutChunks).toBe(28);
    expect(status.failedChunks).toBe(1);
    expect(status.model).toBe('text-embedding-bge-m3');
    expect(status.activeModel).toBe('text-embedding-bge-m3');
    expect(status.embeddingDim).toBe(1024);
    expect(status.ignorePatterns).toEqual(['.obsidian/**', '*.canvas']);
  });

  it('keeps the built-with and in-use models apart when the environment drifted', () => {
    const status = normaliseStatus({
      ...REPORT,
      model: 'local:Xenova/multilingual-e5-small',
      active_model: 'text-embedding-3-small',
    });
    expect(status.model).toBe('local:Xenova/multilingual-e5-small');
    expect(status.activeModel).toBe('text-embedding-3-small');
  });

  it('reports missing counters as unknown rather than as zero', () => {
    const status = normaliseStatus({});
    expect(status.total).toBeNull();
    expect(status.notesWithoutChunks).toBeNull();
    expect(status.model).toBeNull();
    expect(status.ignorePatterns).toEqual([]);
  });

  it('treats a missing failed count as none, so no false alarm is raised', () => {
    expect(normaliseStatus({}).failedChunks).toBe(0);
  });

  it('ignores values of the wrong type', () => {
    const status = normaliseStatus({ total: '12', model: 42, ignore_patterns: 'nope' });
    expect(status.total).toBeNull();
    expect(status.model).toBeNull();
    expect(status.ignorePatterns).toEqual([]);
  });
});

describe('isStatusCapable', () => {
  it('accepts a client that can report', () => {
    expect(isStatusCapable({ statusReport: () => Promise.resolve({}) })).toBe(true);
  });

  it('rejects a client that cannot, and anything that is not a client', () => {
    expect(isStatusCapable({ search: () => [] })).toBe(false);
    expect(isStatusCapable(undefined)).toBe(false);
    expect(isStatusCapable(null)).toBe(false);
  });
});

describe('fetchStatus', () => {
  it('asks the connected client and normalises the answer', async () => {
    const statusReport = vi.fn().mockResolvedValue(REPORT);
    const status = await fetchStatus({ statusReport });
    expect(statusReport).toHaveBeenCalledTimes(1);
    expect(status.total).toBe(3315);
  });

  it('explains that nothing is connected instead of failing obscurely', async () => {
    await expect(fetchStatus(undefined)).rejects.toThrow(/not connected/);
  });

  it('propagates the server error so the panel can show it', async () => {
    const statusReport = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    await expect(fetchStatus({ statusReport })).rejects.toThrow('401 Unauthorized');
  });
});

describe('isUnsupportedStatusError', () => {
  it('recognises the validation error an older CLI answers a status request with', () => {
    expect(
      isUnsupportedStatusError('Invalid stdio request: query Invalid input: expected string'),
    ).toBe(true);
  });

  it('leaves real server errors alone so they stay visible', () => {
    expect(isUnsupportedStatusError('401 Unauthorized')).toBe(false);
    expect(isUnsupportedStatusError('no such table: vec_chunks')).toBe(false);
  });
});
