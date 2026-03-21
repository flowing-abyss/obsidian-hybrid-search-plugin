import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SearchModal } from '../src/ui/SearchModal';

const mockSearch = vi.fn();
const mockClient = { search: mockSearch };

const mockGetCache = vi.fn().mockReturnValue(null);
const mockApp = {
  workspace: { openLinkText: vi.fn() },
  vault: { adapter: { getBasePath: () => '/vault' } },
  metadataCache: { getCache: mockGetCache },
};

const sampleResult: SearchResult = {
  path: 'notes/zettelkasten.md',
  title: 'Zettelkasten',
  score: 0.87,
  snippet: 'A method for note-taking...',
  tags: ['pkm', 'notes'],
  aliases: [],
};

describe('SearchModal', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS);
  });

  it('constructs without throwing', () => {
    expect(modal).toBeDefined();
  });

  it('getSuggestions returns empty for blank query', async () => {
    const results = await modal.getSuggestions('');
    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('getSuggestions calls client.search with settings options', async () => {
    vi.useFakeTimers();
    const promise = modal.getSuggestions('zettel');
    vi.runAllTimers();
    const results = await promise;
    expect(mockSearch).toHaveBeenCalledWith('zettel', {
      mode: DEFAULT_SETTINGS.defaultMode,
      limit: DEFAULT_SETTINGS.limit,
      snippetLength: DEFAULT_SETTINGS.snippetLength,
    });
    expect(results).toHaveLength(1);
    vi.useRealTimers();
  });

  it('getSuggestions returns empty array on client error', async () => {
    mockSearch.mockRejectedValue(new Error('connection failed'));
    vi.useFakeTimers();
    const promise = modal.getSuggestions('broken');
    vi.runAllTimers();
    const results = await promise;
    expect(results).toEqual([]);
    vi.useRealTimers();
  });

  it('renderSuggestion creates title element with note name', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-name')?.textContent).toBe('Zettelkasten');
  });

  it('renderSuggestion renders title as internal-link anchor with data-href', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link.hybrid-search-name');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('data-href')).toBe('notes/zettelkasten');
  });

  it('renderSuggestion sets data-link-* attributes from frontmatter', () => {
    mockGetCache.mockReturnValue({ frontmatter: { status: 'done', priority: 1 } });
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link');
    expect(link?.getAttribute('data-link-status')).toBe('done');
    expect(link?.getAttribute('data-link-priority')).toBe('1');
  });

  it('renderSuggestion skips frontmatter arrays and position key', () => {
    mockGetCache.mockReturnValue({
      frontmatter: { position: {}, tags: ['a', 'b'], status: 'active' },
    });
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const link = el.querySelector('a.internal-link');
    expect(link?.hasAttribute('data-link-position')).toBe(false);
    expect(link?.hasAttribute('data-link-tags')).toBe(false);
    expect(link?.getAttribute('data-link-status')).toBe('active');
  });

  it('renderSuggestion shows score', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-score')?.textContent).toBe('0.87');
  });

  it('renderSuggestion shows snippet when present', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-snippet')?.textContent).toBe(sampleResult.snippet);
  });

  it('renderSuggestion shows tags', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    const tags = el.querySelectorAll('.hybrid-search-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]?.textContent).toBe('#pkm');
  });

  it('renderSuggestion falls back to path when title is empty', () => {
    const el = document.createElement('div');
    modal.renderSuggestion({ ...sampleResult, title: '' }, el);
    expect(el.querySelector('.hybrid-search-name')?.textContent).toBe(sampleResult.path);
  });

  it('onChooseSuggestion opens note in workspace', () => {
    modal.onChooseSuggestion(sampleResult, new MouseEvent('click'));
    expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(sampleResult.path, '', false);
  });
});
