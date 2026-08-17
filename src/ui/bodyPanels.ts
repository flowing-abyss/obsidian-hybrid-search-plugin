/**
 * Preview, metadata and graph panels are attached to `document.body` rather than to the modal,
 * so they escape the modal's CSS constraints. That also puts them outside Obsidian's own
 * teardown, so the plugin sweeps them by class name on load and unload.
 *
 * Every panel is stamped with the id of the plugin instance that created it, and the sweep is
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
 *
 * Scope note: this covers body-level panels only. `SimilarNotesBottom` also injects DOM outside
 * the component tree, into the markdown view rather than into the body, and is not swept here.
 */

export const BODY_PANEL_OWNER_ATTR = 'data-ohs-owner';

export const BODY_PANEL_CLASSES = [
  'hybrid-search-preview',
  'hybrid-search-preview-meta-panel',
  'hybrid-search-inline-preview',
  'ohs-graph-panel',
] as const;

export type BodyPanelClass = (typeof BODY_PANEL_CLASSES)[number];

export interface BodyPanelSweepScope {
  /** Only panels stamped with this id are removed. */
  ownerId: string;
  /** Also remove panels carrying no stamp at all. Load sweep only, see the note above. */
  includeUnstamped: boolean;
}

/** Creates a body-level panel stamped with its owner, so the sweep can tell copies apart. */
export function createBodyPanel(cls: BodyPanelClass, ownerId: string | undefined): HTMLDivElement {
  const el = activeDocument.body.createDiv(cls);
  if (ownerId) el.setAttribute(BODY_PANEL_OWNER_ATTR, ownerId);
  return el;
}

/**
 * Removes the panels this instance is allowed to remove, across every open window.
 * Matching is done on the parsed attribute rather than through a selector, so an unusual
 * character in a hand-edited manifest id cannot turn into a selector syntax error.
 */
export function sweepBodyPanels(documents: Iterable<Document>, scope: BodyPanelSweepScope): void {
  const selector = BODY_PANEL_CLASSES.map((cls) => `.${cls}`).join(', ');
  for (const ownerDocument of documents) {
    for (const element of ownerDocument.querySelectorAll(selector)) {
      const owner = element.getAttribute(BODY_PANEL_OWNER_ATTR);
      if (owner === scope.ownerId || (owner === null && scope.includeUnstamped)) element.remove();
    }
  }
}
