import { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphPanel } from '../src/ui/GraphPanel';

describe('GraphPanel', () => {
  beforeEach(() => {
    activeDocument.body.empty();
  });

  function appWithLinks() {
    const app = new App();
    app.metadataCache.resolvedLinks = {
      'A.md': { 'B.md': 1 },
      'C.md': { 'A.md': 1 },
    };
    app.metadataCache.getCache = (path: string) => ({
      frontmatter: { title: path.replace('.md', ''), type: 'note' },
    });
    return app;
  }

  it('renders center, outgoing, incoming nodes and footer stats', () => {
    const panel = new GraphPanel(appWithLinks(), {
      onCloseModal: vi.fn(),
      ownerId: 'hybrid-search',
    });
    panel.show('A.md');
    const el = panel.getElement();
    expect(el.isShown()).toBe(true);
    expect(
      Array.from(el.querySelectorAll('.ohs-graph-node')).map((node) => node.textContent),
    ).toEqual(['C', 'A', 'B']);
    expect(el.querySelector('.ohs-graph-stats')?.textContent).toBe('in: 1  out: 1  edges: 2');
  });

  it('adds Supercharged Links fallback classes and frontmatter attributes', () => {
    const panel = new GraphPanel(appWithLinks(), {
      onCloseModal: vi.fn(),
      ownerId: 'hybrid-search',
    });
    panel.show('A.md');
    const link = panel.getElement().querySelector<HTMLAnchorElement>('[data-path="B.md"]')!;
    expect(link.classList.contains('internal-link')).toBe(true);
    expect(link.classList.contains('data-link-icon')).toBe(true);
    expect(link.classList.contains('data-link-icon-after')).toBe(true);
    expect(link.classList.contains('data-link-text')).toBe(true);
    expect(link.getAttribute('data-link-type')).toBe('note');
    expect(link.style.getPropertyValue('--data-link-type')).toBe('note');
  });

  it('registers and unloads a Supercharged Links dynamic watcher', () => {
    const app = appWithLinks();
    const observer = { disconnect: vi.fn() };
    const watch = vi.fn(
      (id: string, _container: HTMLElement, _plugin: unknown, selector: string, parent: string) => {
        (
          app as unknown as {
            plugins: { plugins: { 'supercharged-links-obsidian': { observers: unknown[] } } };
          }
        ).plugins.plugins['supercharged-links-obsidian'].observers.push([observer, id, selector]);
        expect(parent).toBe('ohs-graph-node-item');
      },
    );
    (
      app as unknown as {
        plugins: {
          plugins: {
            'supercharged-links-obsidian': {
              observers: unknown[];
              _watchContainerDynamic: typeof watch;
            };
          };
        };
      }
    ).plugins = {
      plugins: {
        'supercharged-links-obsidian': {
          observers: [],
          _watchContainerDynamic: watch,
        },
      },
    };

    const panel = new GraphPanel(app, { onCloseModal: vi.fn(), ownerId: 'hybrid-search' });
    panel.show('A.md');
    expect(watch).toHaveBeenCalledWith(
      'hybrid-search:hybrid-search-graph-panel',
      expect.any(HTMLElement),
      expect.anything(),
      'a.ohs-graph-node-link',
      'ohs-graph-node-item',
    );
    panel.unload();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it('updates depth from footer controls', () => {
    const app = appWithLinks();
    app.metadataCache.resolvedLinks['B.md'] = { 'D.md': 1 };
    const panel = new GraphPanel(app, { onCloseModal: vi.fn(), ownerId: 'hybrid-search' });
    panel.show('A.md');
    const plus = panel.getElement().querySelectorAll<HTMLButtonElement>('.ohs-graph-btn')[1]!;
    plus.click();
    expect(
      Array.from(panel.getElement().querySelectorAll('.ohs-graph-node')).map(
        (node) => node.textContent,
      ),
    ).toContain('D');
  });

  it('expands and collapses one-hop links relative to a node', () => {
    const app = appWithLinks();
    app.metadataCache.resolvedLinks['B.md'] = { 'D.md': 1 };
    const panel = new GraphPanel(app, { onCloseModal: vi.fn(), ownerId: 'hybrid-search' });
    panel.show('A.md');

    expect(panel.getElement().querySelector('[data-path="D.md"]')).toBeNull();
    const expandB = panel
      .getElement()
      .querySelector<HTMLButtonElement>(
        '.ohs-graph-node-item [data-path="B.md"].ohs-graph-expand-btn',
      )!;
    expandB.click();
    expect(panel.getElement().querySelector('[data-path="D.md"]')).not.toBeNull();
    expect(
      panel
        .getElement()
        .querySelector<HTMLButtonElement>(
          '.ohs-graph-node-item [data-path="B.md"].ohs-graph-expand-btn',
        )?.textContent,
    ).toBe('-');

    panel
      .getElement()
      .querySelector<HTMLButtonElement>(
        '.ohs-graph-node-item [data-path="B.md"].ohs-graph-expand-btn',
      )!
      .click();
    expect(panel.getElement().querySelector('[data-path="D.md"]')).toBeNull();
  });

  it('expands only outgoing links so local drill-down grows downward', () => {
    const app = appWithLinks();
    app.metadataCache.resolvedLinks['B.md'] = { 'D.md': 1 };
    app.metadataCache.resolvedLinks['Backlink.md'] = { 'B.md': 1 };
    const panel = new GraphPanel(app, { onCloseModal: vi.fn(), ownerId: 'hybrid-search' });
    panel.show('A.md');

    panel
      .getElement()
      .querySelector<HTMLButtonElement>(
        '.ohs-graph-node-item [data-path="B.md"].ohs-graph-expand-btn',
      )!
      .click();

    expect(panel.getElement().querySelector('[data-path="D.md"]')).not.toBeNull();
    expect(panel.getElement().querySelector('[data-path="Backlink.md"]')).toBeNull();
    expect(panel.getElement().querySelector('[data-depth="2"] [data-path="D.md"]')).not.toBeNull();
  });

  it('unloads its element', () => {
    const panel = new GraphPanel(appWithLinks(), {
      onCloseModal: vi.fn(),
      ownerId: 'hybrid-search',
    });
    panel.show('A.md');
    const el = panel.getElement();
    expect(activeDocument.body.contains(el)).toBe(true);
    panel.unload();
    expect(activeDocument.body.contains(el)).toBe(false);
  });
});
