import { MarkdownRenderer } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { SearchPreviewRenderer } from '../src/ui/preview/SearchPreviewRenderer';
import { createApp } from './support/obsidian';

it('resolves links from the previewed note and preserves heading navigation', async () => {
  const app = createApp({
    'Preview/Source.md': '[[Target#Heading]]',
    'Preview/Target.md': '# Heading',
  });
  const resolve = vi.spyOn(app.metadataCache, 'getFirstLinkpathDest');
  const open = vi.spyOn(app.workspace, 'openLinkText').mockResolvedValue(undefined);
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, container) => {
    container.createEl('a', { text: 'Target', attr: { 'data-href': 'Target#Heading' } });
  });
  const containerEl = createDiv();
  const renderer = new SearchPreviewRenderer({
    app,
    containerEl,
    getSourcePath: () => 'Editor/Note.md',
  });
  await renderer.render('Preview/Source.md');
  containerEl.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(resolve).toHaveBeenCalledWith('Target', 'Preview/Source.md');
  expect(open).toHaveBeenCalledWith('Preview/Target.md#Heading', '', false, { active: true });
  renderer.unload();
});

type RendererInternals = {
  cleanupInternalLinks?: () => void;
  previewChild?: { unload: () => void };
  currentPath?: string;
  currentAnchorKey?: string;
  requestId: number;
};

describe('SearchPreviewRenderer cleanup', () => {
  it('unloads Markdown when teardown runs between publication and ownership', async () => {
    const app = createApp({ 'A.md': 'note' });
    const containerEl = createDiv();
    const renderer = new SearchPreviewRenderer({ app, containerEl, getSourcePath: () => '' });
    const cleanup = vi.fn();
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app, text, el, _path, child) => {
        child.register(cleanup);
        el.createEl('p', { text });
      },
    );
    const observer = new MutationObserver(() => {
      if (containerEl.childElementCount) renderer.unload();
    });
    observer.observe(containerEl, { childList: true });
    try {
      await renderer.render('A.md');
      expect(cleanup).toHaveBeenCalledOnce();
      expect((renderer as unknown as RendererInternals).currentPath).toBeUndefined();
      expect((renderer as unknown as RendererInternals).previewChild).toBeUndefined();
      expect(containerEl.childElementCount).toBe(0);
    } finally {
      observer.disconnect();
      renderer.unload();
    }
  });

  it('clears every owned resource when internal-link cleanup throws', () => {
    const containerEl = createDiv();
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

it('discards an old Markdown render that finishes after a newer preview', async () => {
  const app = createApp({ 'A.md': 'old note', 'B.md': 'new note' });
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, container) => {
    if (markdown === 'old note') await pending;
    container.createDiv({ text: markdown });
  });
  const containerEl = createDiv();
  const renderer = new SearchPreviewRenderer({ app, containerEl, getSourcePath: () => '' });
  const old = renderer.render('A.md');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await renderer.render('B.md');
  finish();
  await old;
  expect(containerEl.textContent).toBe('new note');
  renderer.unload();
});
