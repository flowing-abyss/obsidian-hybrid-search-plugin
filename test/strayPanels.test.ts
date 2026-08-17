import { afterEach, describe, expect, it } from 'vitest';

import {
  BODY_PANEL_CLASSES,
  PANEL_OWNER_ATTR,
  STRAY_PANEL_CLASSES,
  createBodyPanel,
  stampPanelOwner,
  sweepStrayPanels,
} from '../src/ui/strayPanels';

const ALL_BODY_PANELS = STRAY_PANEL_CLASSES.map((cls) => `.${cls}`).join(', ');

function remaining(): string[] {
  return [...activeDocument.querySelectorAll(ALL_BODY_PANELS)].map(
    (el) => el.getAttribute(PANEL_OWNER_ATTR) ?? '(unstamped)',
  );
}

afterEach(() => {
  activeDocument.querySelectorAll(ALL_BODY_PANELS).forEach((el) => el.remove());
});

describe('createBodyPanel', () => {
  it('attaches the panel to the body with its class', () => {
    const el = createBodyPanel('hybrid-search-preview', 'hybrid-search');

    expect(el.parentElement).toBe(activeDocument.body);
    expect(el.classList.contains('hybrid-search-preview')).toBe(true);
  });

  it('stamps the owner id', () => {
    const el = createBodyPanel('ohs-graph-panel', 'hybrid-search-beta');

    expect(el.getAttribute(PANEL_OWNER_ATTR)).toBe('hybrid-search-beta');
  });

  it('leaves the panel unstamped when no owner is known', () => {
    const el = createBodyPanel('ohs-graph-panel', undefined);

    expect(el.hasAttribute(PANEL_OWNER_ATTR)).toBe(false);
  });
});

describe('sweepStrayPanels', () => {
  it('removes every panel class owned by the instance', () => {
    for (const cls of BODY_PANEL_CLASSES) createBodyPanel(cls, 'hybrid-search');

    sweepStrayPanels([activeDocument], { ownerId: 'hybrid-search', includeUnstamped: false });

    expect(remaining()).toEqual([]);
  });

  it('leaves panels owned by another copy of the plugin alone', () => {
    createBodyPanel('hybrid-search-preview', 'hybrid-search-beta');
    createBodyPanel('ohs-graph-panel', 'hybrid-search');

    sweepStrayPanels([activeDocument], { ownerId: 'hybrid-search', includeUnstamped: true });

    expect(remaining()).toEqual(['hybrid-search-beta']);
  });

  it('removes unstamped panels when asked, for leftovers of a pre-attribute build', () => {
    createBodyPanel('hybrid-search-preview', undefined);

    sweepStrayPanels([activeDocument], { ownerId: 'hybrid-search', includeUnstamped: true });

    expect(remaining()).toEqual([]);
  });

  it('keeps unstamped panels when not asked, so the unload sweep spares a live foreign copy', () => {
    createBodyPanel('hybrid-search-preview', undefined);

    sweepStrayPanels([activeDocument], { ownerId: 'hybrid-search', includeUnstamped: false });

    expect(remaining()).toEqual(['(unstamped)']);
  });

  it('removes an embedded panel that is not attached to the body', () => {
    const host = activeDocument.body.createDiv('markdown-preview-sizer');
    stampPanelOwner(host.createDiv('hybrid-search-similar-bottom'), 'hybrid-search');

    sweepStrayPanels([activeDocument], { ownerId: 'hybrid-search', includeUnstamped: false });

    expect(host.querySelectorAll('.hybrid-search-similar-bottom')).toHaveLength(0);
    host.remove();
  });

  it('leaves an embedded panel owned by another copy alone', () => {
    const host = activeDocument.body.createDiv('markdown-preview-sizer');
    stampPanelOwner(host.createDiv('hybrid-search-similar-bottom'), 'hybrid-search-beta');

    sweepStrayPanels([activeDocument], { ownerId: 'hybrid-search', includeUnstamped: true });

    expect(host.querySelectorAll('.hybrid-search-similar-bottom')).toHaveLength(1);
    host.remove();
  });

  it('tolerates an owner id that would be invalid inside a selector', () => {
    const odd = 'weird"id\\';
    createBodyPanel('hybrid-search-preview', odd);
    createBodyPanel('ohs-graph-panel', 'hybrid-search');

    expect(() =>
      sweepStrayPanels([activeDocument], { ownerId: odd, includeUnstamped: false }),
    ).not.toThrow();
    expect(remaining()).toEqual(['hybrid-search']);
  });

  it('sweeps every document it is given', () => {
    const other = activeDocument.implementation.createHTMLDocument('popout');
    const inOther = other.body.appendChild(other.createElement('div'));
    inOther.className = 'ohs-graph-panel';
    inOther.setAttribute(PANEL_OWNER_ATTR, 'hybrid-search');
    createBodyPanel('ohs-graph-panel', 'hybrid-search');

    sweepStrayPanels([activeDocument, other], {
      ownerId: 'hybrid-search',
      includeUnstamped: false,
    });

    expect(remaining()).toEqual([]);
    expect(other.querySelectorAll('.ohs-graph-panel')).toHaveLength(0);
  });
});
