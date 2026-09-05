import { readFileSync } from 'node:fs';
import { App, type HoverParent } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { SimilarNotesResults } from '../src/ui/SimilarNotesResults';

const related: SearchResult = {
  path: 'related.md',
  title: 'Related',
  score: 0.8,
  snippet: 'Relevant context from the related note.',
  tags: [],
  aliases: [],
};

function createView() {
  const app = new App();
  const containerEl = activeDocument.createDiv();
  const hoverParent: HoverParent = { hoverPopover: null };
  const onToggle = vi.fn();
  const onContentChanged = vi.fn();
  const openFile = vi.fn();
  const view = new SimilarNotesResults({
    app,
    containerEl,
    ownerId: 'hybrid-search',
    watchId: 'test-results',
    getSourcePath: () => 'source.md',
    hoverParent,
    onToggle,
    onContentChanged,
    onOpenFile: (file, background) => openFile(file.path, background),
  });
  view.load();
  return { app, containerEl, hoverParent, onToggle, onContentChanged, openFile, view };
}

describe('SimilarNotesResults', () => {
  it('renders compact result rows with a score and collapsed snippet', () => {
    const { containerEl, onContentChanged, view } = createView();

    view.render([related], 'similarity', new Set());

    expect(containerEl.querySelector('.hybrid-search-similar-note-link')?.textContent).toBe(
      'Related',
    );
    expect(containerEl.querySelector('.tree-item-flair')?.textContent).toBe('0.80');
    expect(containerEl.querySelector('.collapse-icon')?.getAttribute('data-icon')).toBe(
      'right-triangle',
    );
    expect(containerEl.querySelector('.search-result-file-match')).toBeNull();
    expect(onContentChanged).toHaveBeenCalledOnce();
  });

  it('renders the snippet for an expanded result', () => {
    const { containerEl, view } = createView();

    view.render([related], 'similarity', new Set(['related.md']));

    expect(containerEl.querySelector('.search-result-file-match')?.textContent).toBe(
      related.snippet,
    );
  });

  it('reports the path when the expansion arrow is selected', () => {
    const { containerEl, onToggle, view } = createView();
    view.render([related], 'similarity', new Set());

    containerEl
      .querySelector<HTMLElement>('.collapse-icon')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onToggle).toHaveBeenCalledWith('related.md');
  });

  it('keeps the expansion arrow in the compact page preview row layout', () => {
    const obsidianStyles = activeDocument.head.createEl('style', {
      text: '.tree-item-icon.collapse-icon { position: absolute; }',
    });
    const pluginStyles = activeDocument.head.createEl('style', {
      text: readFileSync('styles.css', 'utf8'),
    });
    const { containerEl, view } = createView();
    containerEl.addClass('hybrid-search-page-preview-similar');

    try {
      view.render([related], 'similarity', new Set());
      const collapseIcon = containerEl.querySelector<HTMLElement>('.collapse-icon')!;

      expect(getComputedStyle(collapseIcon).position).toBe('static');
    } finally {
      view.unload();
      obsidianStyles.remove();
      pluginStyles.remove();
    }
  });

  it('uses one stable hover parent for repeated nested page previews', () => {
    const { app, containerEl, hoverParent, view } = createView();
    view.render([related], 'similarity', new Set());
    const link = containerEl.querySelector<HTMLElement>('.hybrid-search-similar-note-link')!;

    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));

    expect(app.workspace.trigger).toHaveBeenCalledTimes(2);
    expect(app.workspace.trigger).toHaveBeenNthCalledWith(
      1,
      'hover-link',
      expect.objectContaining({ hoverParent, linktext: 'related', sourcePath: 'source.md' }),
    );
    expect(app.workspace.trigger).toHaveBeenNthCalledWith(
      2,
      'hover-link',
      expect.objectContaining({ hoverParent }),
    );
  });

  it('opens normal clicks in front and modifier clicks in the background', () => {
    const { containerEl, openFile, view } = createView();
    view.render([related], 'similarity', new Set());
    const link = containerEl.querySelector<HTMLElement>('.hybrid-search-similar-note-link')!;

    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));

    expect(openFile).toHaveBeenNthCalledWith(1, 'related.md', false);
    expect(openFile).toHaveBeenNthCalledWith(2, 'related.md', true);
  });

  it('registers and removes its namespaced Supercharged Links observer', () => {
    const disconnect = vi.fn();
    const observer = { disconnect } as unknown as MutationObserver;
    const watch = vi.fn((id: string) => {
      supercharged.observers.push([observer, id, 'search-result-file-title']);
    });
    const supercharged = { _watchContainerDynamic: watch, observers: [] as unknown[][] };
    const app = new App() as App & { plugins: { plugins: Record<string, unknown> } };
    app.plugins = { plugins: { 'supercharged-links-obsidian': supercharged } };
    const containerEl = activeDocument.createDiv();
    const view = new SimilarNotesResults({
      app,
      containerEl,
      ownerId: 'hybrid-search',
      watchId: 'page-preview-1',
      getSourcePath: () => 'source.md',
      hoverParent: { hoverPopover: null },
      onToggle: vi.fn(),
    });

    expect(watch).toHaveBeenCalledWith(
      'hybrid-search:page-preview-1',
      containerEl,
      supercharged,
      '.hybrid-search-similar-note-link',
      'search-result-file-title',
    );

    view.unload();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(supercharged.observers).toHaveLength(0);
  });

  it('removes rendered rows and link handlers on unload', () => {
    const { app, containerEl, view } = createView();
    view.render([related], 'similarity', new Set());
    const link = containerEl.querySelector<HTMLElement>('.hybrid-search-similar-note-link')!;

    view.unload();
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));

    expect(containerEl.childElementCount).toBe(0);
    expect(app.workspace.trigger).not.toHaveBeenCalled();
  });
});
