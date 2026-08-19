import { describe, expect, it, vi } from 'vitest';
import { SearchPreviewRenderer } from '../src/ui/SearchPreviewRenderer';

type RendererInternals = {
  cleanupInternalLinks?: () => void;
  previewChild?: { unload: () => void };
  currentPath?: string;
  currentAnchorKey?: string;
  requestId: number;
};

describe('SearchPreviewRenderer cleanup', () => {
  it('clears every owned resource when internal-link cleanup throws', () => {
    const containerEl = activeDocument.createDiv();
    containerEl.createDiv({ text: 'rendered preview' });
    const renderer = new SearchPreviewRenderer({
      app: {} as never,
      containerEl,
      getSourcePath: () => '',
    });
    const internals = renderer as unknown as RendererInternals;
    const failure = new Error('link cleanup failed');
    const childUnload = vi.fn();
    internals.cleanupInternalLinks = vi.fn(() => {
      throw failure;
    });
    internals.previewChild = { unload: childUnload };
    internals.currentPath = 'note.md';
    internals.currentAnchorKey = 'anchor';
    internals.requestId = 7;

    expect(() => renderer.unload()).toThrow(failure);

    expect(childUnload).toHaveBeenCalledOnce();
    expect(containerEl.childElementCount).toBe(0);
    expect(internals.cleanupInternalLinks).toBeUndefined();
    expect(internals.previewChild).toBeUndefined();
    expect(internals.currentPath).toBeUndefined();
    expect(internals.currentAnchorKey).toBeUndefined();
    expect(internals.requestId).toBe(8);
  });
});
