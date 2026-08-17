import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type HybridSearchSettings } from '../src/settings';
import { StatusSection, type StatusSectionDeps } from '../src/ui/statusSection';

const HEALTHY: Record<string, unknown> = {
  total: 100,
  indexed: 100,
  notes_without_chunks: 0,
  pending: 0,
  chunks: 400,
  failed_chunks: 0,
  links: 10,
  last_indexed: '2026-08-17T11:20:11.782Z',
  db_size_mb: 4.2,
  api_base_url: 'http://127.0.0.1:1234/v1',
  model: 'text-embedding-bge-m3',
  active_model: 'text-embedding-bge-m3',
  embedding_dim: 1024,
  context_length: 512,
  version: '0.15.0',
  ignore_patterns: ['.obsidian/**'],
};

function mount(
  report: Record<string, unknown>,
  overrides: Partial<StatusSectionDeps> = {},
): { section: StatusSection; summary: HTMLElement; diagnostics: HTMLElement } {
  const section = new StatusSection({
    settings: { ...DEFAULT_SETTINGS } as HybridSearchSettings,
    getApiKey: () => 'sk-test',
    getClient: () => ({ statusReport: () => Promise.resolve(report) }),
    getEndpointLabel: () => 'obsidian-hybrid-search',
    ...overrides,
  });
  const summary = document.createElement('div');
  const diagnostics = document.createElement('div');
  document.body.append(summary, diagnostics);
  section.renderSummary(summary);
  section.renderDiagnostics(diagnostics);
  return { section, summary, diagnostics };
}

describe('StatusSection', () => {
  beforeEach(() => {
    document.body.empty();
  });

  it('says nothing alarming about a healthy index', async () => {
    const { section, summary } = mount(HEALTHY);
    await section.refresh();
    expect(summary.querySelector('.hybrid-search-status__warning')).toBeNull();
    expect(summary.textContent).toContain('text-embedding-bge-m3');
  });

  it('warns when the running model differs from the one the index was built with', async () => {
    const { section, summary } = mount({
      ...HEALTHY,
      model: 'local:Xenova/multilingual-e5-small',
      active_model: 'text-embedding-3-small',
    });
    await section.refresh();
    const warning = summary.querySelector('.hybrid-search-status__warning')?.textContent ?? '';
    expect(warning).toContain('local:Xenova/multilingual-e5-small');
    expect(warning).toContain('text-embedding-3-small');
  });

  it('explains notes with nothing to embed once indexing has settled', async () => {
    const { section, summary } = mount({ ...HEALTHY, notes_without_chunks: 28 });
    await section.refresh();
    expect(summary.querySelector('.hybrid-search-status__note')?.textContent).toContain('28');
  });

  it('stays quiet about them while the first index is still running', async () => {
    // Mid-index those notes are merely unreached, not empty.
    const { section, summary } = mount({
      ...HEALTHY,
      notes_without_chunks: 28,
      pending: 12,
    });
    await section.refresh();
    expect(summary.querySelector('.hybrid-search-status__note')).toBeNull();
  });

  it('surfaces a failed-chunk count with the command that repairs it', async () => {
    const { section, summary } = mount({ ...HEALTHY, failed_chunks: 3 });
    await section.refresh();
    const warning = summary.querySelector('.hybrid-search-status__warning')?.textContent ?? '';
    expect(warning).toContain('3 chunks');
    expect(warning).toContain('reindex --errors');
  });

  it('shows the server error instead of a blank panel', async () => {
    const { section, summary } = mount(HEALTHY, {
      getClient: () => ({ statusReport: () => Promise.reject(new Error('401 Unauthorized')) }),
    });
    await section.refresh();
    expect(summary.querySelector('.hybrid-search-status__warning')?.textContent).toContain(
      '401 Unauthorized',
    );
  });

  it('never puts the api key into the copied report', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { section } = mount(HEALTHY, { getApiKey: () => 'sk-super-secret' });
    await section.refresh();
    await section.copyReport();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).not.toContain('sk-super-secret');
  });

  it('ignores a result that lands after the tab was closed', async () => {
    const { section, summary } = mount(HEALTHY);
    const pending = section.refresh();
    section.dispose();
    await pending;
    // dispose() dropped the element references, so nothing was repainted into them.
    expect(summary.textContent).toContain('Loading');
  });
});
