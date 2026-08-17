/**
 * Some of the plugin's panels are attached outside its own component tree, either to
 * `document.body` so they escape the modal's CSS constraints, or into a markdown view so they sit
 * next to the note. Obsidian's teardown does not reach any of them, so if an instance goes away
 * without unloading cleanly, they are stranded. The plugin sweeps them by class name on load and
 * unload.
 *
 * Every such panel is stamped with the id of the plugin instance that created it, and the sweep is
 * scoped to that id. Without the stamp a second copy of the plugin installed side by side (a
 * community build plus a BRAT beta, say) would delete the other copy's live panels.
 *
 * `manifest.id` is exactly the right identity here, not merely a convenient one: Obsidian keys
 * `app.plugins.manifests` by it, so two copies can be live at the same time if and only if their
 * ids differ. Nothing finer grained is needed.
 *
 * Only the load sweep also removes unstamped panels. At load an unstamped panel is almost always
 * a leftover from a build that predates the attribute, so removing it is worth the risk of
 * catching a live panel of an older sibling copy. At unload that reading is gone: anything
 * unstamped by then must belong to a live foreign copy, so the unload sweep touches its own
 * panels only.
 */

export const PANEL_OWNER_ATTR = 'data-ohs-owner';

/** Panels attached to `document.body`, created through `createBodyPanel`. */
export const BODY_PANEL_CLASSES = [
  'hybrid-search-preview',
  'hybrid-search-preview-meta-panel',
  'hybrid-search-inline-preview',
  'ohs-graph-panel',
] as const;

/** Panels attached elsewhere outside the component tree, stamped through `stampPanelOwner`. */
const EMBEDDED_PANEL_CLASSES = ['hybrid-search-similar-bottom'] as const;

export const STRAY_PANEL_CLASSES = [...BODY_PANEL_CLASSES, ...EMBEDDED_PANEL_CLASSES];

export type BodyPanelClass = (typeof BODY_PANEL_CLASSES)[number];

export interface StrayPanelSweepScope {
  /** Only panels stamped with this id are removed. */
  ownerId: string;
  /** Also remove panels carrying no stamp at all. Load sweep only, see the note above. */
  includeUnstamped: boolean;
}

/** Marks a panel as belonging to one plugin instance, so the sweep can tell copies apart. */
export function stampPanelOwner<T extends HTMLElement>(el: T, ownerId: string | undefined): T {
  if (ownerId) el.setAttribute(PANEL_OWNER_ATTR, ownerId);
  return el;
}

/** Creates a body-level panel already stamped with its owner. */
export function createBodyPanel(cls: BodyPanelClass, ownerId: string | undefined): HTMLDivElement {
  return stampPanelOwner(activeDocument.body.createDiv(cls), ownerId);
}

/**
 * Removes the panels this instance is allowed to remove, across every open window.
 * Matching is done on the parsed attribute rather than through a selector, so an unusual
 * character in a hand-edited manifest id cannot turn into a selector syntax error.
 */
export function sweepStrayPanels(documents: Iterable<Document>, scope: StrayPanelSweepScope): void {
  const selector = STRAY_PANEL_CLASSES.map((cls) => `.${cls}`).join(', ');
  for (const ownerDocument of documents) {
    for (const element of ownerDocument.querySelectorAll(selector)) {
      const owner = element.getAttribute(PANEL_OWNER_ATTR);
      if (owner === scope.ownerId || (owner === null && scope.includeUnstamped)) element.remove();
    }
  }
}
