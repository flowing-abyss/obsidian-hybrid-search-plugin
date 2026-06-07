import { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { hookInternalLinks } from '../src/ui/linkHandler';

describe('hookInternalLinks', () => {
  function setup() {
    const app = new App();
    const el = activeDocument.createDiv();
    const link = activeDocument.createEl('a');
    link.setAttribute('data-href', 'Target');
    link.textContent = 'Target';
    el.appendChild(link);
    const callbacks = {
      onHoverPreview: vi.fn(),
      onOpenFile: vi.fn(),
    };
    hookInternalLinks(el, app, 'Source.md', callbacks);
    return { app, el, link, callbacks };
  }

  it('triggers hover preview on Mod hover', () => {
    const { link, callbacks } = setup();
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));
    expect(callbacks.onHoverPreview).toHaveBeenCalledWith(expect.any(MouseEvent), link, 'Target');
  });

  it('opens internal links on left click and closes modal', () => {
    const { link, callbacks } = setup();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(callbacks.onOpenFile).toHaveBeenCalledWith(expect.any(TFile), false, true);
  });

  it('resolves links with a dynamic source path', () => {
    const app = new App();
    const getFirstLinkpathDest = vi
      .fn()
      .mockReturnValue(
        Object.assign(new TFile(), { path: 'Folder/Target.md' }),
      ) as unknown as typeof app.metadataCache.getFirstLinkpathDest;
    app.metadataCache.getFirstLinkpathDest = getFirstLinkpathDest;
    const el = activeDocument.createDiv();
    const link = el.createEl('a', { attr: { 'data-href': 'Target' } });
    let sourcePath = 'Folder/Source.md';
    hookInternalLinks(el, app, () => sourcePath, {
      onHoverPreview: vi.fn(),
      onOpenFile: vi.fn(),
    });

    sourcePath = 'Folder/Updated.md';
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(getFirstLinkpathDest).toHaveBeenCalledWith('Target', 'Folder/Updated.md');
  });

  it('opens middle clicks in background without closing modal', () => {
    const { link, callbacks } = setup();
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(callbacks.onOpenFile).toHaveBeenCalledWith(expect.any(TFile), true, false);
  });

  it('opens Mod-clicks in background instead of triggering hover preview', () => {
    const { link, callbacks } = setup();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true }));
    expect(callbacks.onHoverPreview).not.toHaveBeenCalled();
    expect(callbacks.onOpenFile).toHaveBeenCalledWith(expect.any(TFile), true, false);
  });

  it('passes the clicked link to dynamic source path resolvers', () => {
    const app = new App();
    const getFirstLinkpathDest = vi
      .fn()
      .mockReturnValue(
        Object.assign(new TFile(), { path: 'Nested/Target.md' }),
      ) as unknown as typeof app.metadataCache.getFirstLinkpathDest;
    app.metadataCache.getFirstLinkpathDest = getFirstLinkpathDest;
    const el = activeDocument.createDiv();
    const wrapper = el.createDiv();
    wrapper.setAttribute('data-source-path', 'Nested/Source.md');
    const link = wrapper.createDiv();
    link.setAttribute('data-href', 'Target');
    hookInternalLinks(
      el,
      app,
      (targetEl) => targetEl?.closest<HTMLElement>('[data-source-path]')?.dataset.sourcePath ?? '',
      { onHoverPreview: vi.fn(), onOpenFile: vi.fn() },
    );

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(getFirstLinkpathDest).toHaveBeenCalledWith('Target', 'Nested/Source.md');
  });

  it('ignores external links', () => {
    const { link, callbacks } = setup();
    link.setAttribute('data-href', 'https://example.com');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(callbacks.onOpenFile).not.toHaveBeenCalled();
  });

  it('returns a cleanup function for registered listeners', () => {
    const app = new App();
    const el = activeDocument.createDiv();
    const link = activeDocument.createEl('a');
    link.setAttribute('data-href', 'Target');
    el.appendChild(link);
    const callbacks = {
      onHoverPreview: vi.fn(),
      onOpenFile: vi.fn(),
    };
    const cleanup = hookInternalLinks(el, app, 'Source.md', callbacks);

    cleanup();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));

    expect(callbacks.onOpenFile).not.toHaveBeenCalled();
    expect(callbacks.onHoverPreview).not.toHaveBeenCalled();
  });
});
