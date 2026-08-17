import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { findInlineSearchTrigger, InlineSearchSuggest } from '../src/ui/InlineSearchSuggest';
import { PANEL_OWNER_ATTR } from '../src/ui/strayPanels';

describe('findInlineSearchTrigger', () => {
  it('finds the last trigger before the cursor', () => {
    expect(findInlineSearchTrigger('alpha ;;project tag:work', ';;')).toEqual({
      ch: 6,
      query: 'project tag:work',
    });
  });

  it('allows empty query immediately after the trigger', () => {
    expect(findInlineSearchTrigger(';;', ';;')).toEqual({ ch: 0, query: '' });
  });

  it('ignores escaped triggers', () => {
    expect(findInlineSearchTrigger('\\;;literal', ';;')).toBeNull();
  });

  it('returns null when no trigger is present', () => {
    expect(findInlineSearchTrigger('plain text', ';;')).toBeNull();
  });

  it('supports custom triggers', () => {
    expect(findInlineSearchTrigger('note ::semantic', '::')).toEqual({
      ch: 5,
      query: 'semantic',
    });
  });
});

describe('InlineSearchSuggest @similar', () => {
  function createSuggest(activeFile: { path: string } | null, search: ReturnType<typeof vi.fn>) {
    const app = {
      workspace: { getActiveFile: () => activeFile },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
    };
    const plugin = {
      manifest: { id: 'hybrid-search' },
      settings: { ...DEFAULT_SETTINGS },
      client: { search },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never);
    return suggest as unknown as {
      runSearch: (query: string, requestId: number) => Promise<unknown[]>;
    };
  }

  it('sends notePath when the query uses @sim', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const suggest = createSuggest({ path: 'Now/Today.md' }, search);

    await suggest.runSearch('@sim #system/meta', 0);

    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ notePath: 'Now/Today.md', tag: 'system/meta' }),
    );
  });

  it('does not search when @sim has no active note', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const suggest = createSuggest(null, search);

    const suggestions = await suggest.runSearch('@sim', 0);

    expect(search).not.toHaveBeenCalled();
    expect(suggestions).toEqual([{ kind: 'status', message: 'Open a note to use @similar.' }]);
  });
});

describe('InlineSearchSuggest preview panel', () => {
  afterEach(() => {
    activeDocument.querySelectorAll('.hybrid-search-inline-preview').forEach((el) => el.remove());
  });

  it('stamps its body-level preview with the plugin id so the sweep can scope by instance', () => {
    const app = {
      workspace: { getActiveFile: () => null },
      metadataCache: { getCache: () => null, getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: () => null },
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      client: { search: vi.fn() },
      manifest: { id: 'hybrid-search-beta' },
    };
    const suggest = new InlineSearchSuggest(app as never, plugin as never) as unknown as {
      ensurePreview: () => void;
      previewWrapEl?: HTMLElement;
    };

    suggest.ensurePreview();

    expect(suggest.previewWrapEl?.getAttribute(PANEL_OWNER_ATTR)).toBe('hybrid-search-beta');
  });
});
