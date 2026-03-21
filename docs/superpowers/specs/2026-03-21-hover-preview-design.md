# Hover Preview Panel — Design Spec

**Date:** 2026-03-21
**Status:** Approved

---

## Overview

Replace the inline snippet in search results with a fixed preview panel that appears to the right of the modal when the user hovers over a result or navigates with keyboard arrows. The panel renders the full note using Obsidian's native `MarkdownRenderer.render()` API.

---

## Goals

- Remove visual clutter: snippets take up space and duplicate what the preview panel will show
- Let the user quickly scan note content without opening it
- Use native Obsidian rendering — callouts, images, wikilinks, code highlighting all work out of the box
- Keep implementation simple: no monkey-patching, no WorkspaceLeaf management

---

## UI Changes

### Result row (after)

Each row shows: **[SL icon] title · score · tags**
Snippet is removed entirely.

### Preview panel

- Rendered as `div.hybrid-search-preview` inserted as a sibling to `.prompt` inside `this.modalEl`
- Created lazily on first hover/selection (only once — guarded with `if (!this.previewEl)`)
- `this.modalEl` gets class `hybrid-search-expanded` when panel is visible
- Panel is hidden (`previewEl.hide()`) when empty due to error; shown (`previewEl.show()`) at the start of each render attempt

DOM hierarchy (Obsidian SuggestModal) — confirmed by existing `querySelector('.prompt-results')` in the codebase:
```
div.modal-container  ← this.containerEl
  div.modal          ← this.modalEl   ← flex container when expanded
    div.prompt       ← stays fixed width (confirmed class name)
      div.prompt-input-container
      div.prompt-results
    div.hybrid-search-preview  ← added here once, flex: 1
```

**Note:** Each `SearchModal` instance is constructed fresh (`new SearchModal(...).open()`), so `previewEl` and `previewCallId` always start clean. No modal recycling occurs.

---

## Architecture

### Files changed

| File | Change |
|------|--------|
| `src/ui/SearchModal.ts` | Add preview panel logic, remove snippet rendering |
| `styles.css` | Flex layout for expanded modal, preview panel styles |

### SearchModal changes

**Imports to add** (`Component` is NOT imported — only `MarkdownRenderChild` is needed):
```typescript
import { debounce, MarkdownRenderChild, MarkdownRenderer, TFile } from 'obsidian';
// debounce is from 'obsidian' — do NOT use lodash or any other debounce
```

**New private state:**
```typescript
private previewEl?: HTMLDivElement;
private previewChild?: MarkdownRenderChild;
private currentPreviewPath?: string;
private previewCallId = 0;
```

**`renderSuggestion()`** — remove snippet block; add `mouseenter` listener on `el`:
```typescript
el.addEventListener('mouseenter', () => void this.updatePreview(result.path));
```

**`onSelectedChange()`** — regular method override with `@ts-ignore` (internal SuggestModal API). Uses separate debounced private handler with `resetTimer: true` so rapid keyboard navigation always waits for the last keypress, not fires on the first:

```typescript
private readonly debouncedPreview = debounce(
  (path: string) => { void this.updatePreview(path); },
  100,
  true,   // resetTimer: true — debounce resets on each call, fires after last one
);

// @ts-ignore — internal SuggestModal API, fires on arrow-key navigation
onSelectedChange(result: SearchResult | null): void {
  if (result) this.debouncedPreview(result.path);
}
```

**`updatePreview(path: string)`** — async method. Previous child is unloaded **synchronously before any await** to avoid resource leaks on stale calls:

```
1. If path === this.currentPreviewPath → return early (no re-render)
2. Increment this.previewCallId; capture as local `callId`
3. [ALL SYNCHRONOUS — before any await]:
   a. If !this.previewEl:
      - this.previewEl = this.modalEl.createDiv('hybrid-search-preview')
      - this.modalEl.addClass('hybrid-search-expanded')
   b. this.previewEl.show()
   c. this.previewChild?.unload()
      this.previewChild = undefined
      this.previewEl.empty()
4. const abstract = this.app.vault.getAbstractFileByPath(path)
   - If null → return silently (file deleted or invalid path)
   - If !(abstract instanceof TFile) → return (path is a folder)
5. let content: string
   try { content = await this.app.vault.cachedRead(abstract) }
   catch { this.previewEl.hide(); return }
6. If callId !== this.previewCallId → return (stale — a newer call has already taken over)
7. this.previewChild = new MarkdownRenderChild(this.previewEl)
   this.previewChild.load()
8. await MarkdownRenderer.render(this.app, content, this.previewEl, path, this.previewChild)
9. this.currentPreviewPath = path
```

**`onClose()`** — clean up all preview state:
```typescript
onClose(): void {
  this.unhookSuperchargedLinks();    // existing
  this.previewChild?.unload();
  this.modalEl.removeClass('hybrid-search-expanded');
  this.previewEl = undefined;
  this.currentPreviewPath = undefined;
}
```
Note: `super.onClose()` is intentionally not called — `Modal.onClose()` is a no-op in current Obsidian versions, consistent with the existing code.

**`getSuggestions()`** — pass `snippetLength: 0` to avoid the server computing and serializing snippets that are no longer displayed.

### CSS changes

```css
/* Modal becomes flex row when preview panel is open */
.hybrid-search-expanded.modal {
  display: flex;
  flex-direction: row;
  width: min(90vw, 1100px);
  max-width: 90vw;
}

/* Search list keeps its original width */
.hybrid-search-expanded .prompt {
  flex: 0 0 480px;
}

/* Preview panel fills the rest */
.hybrid-search-preview {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
  max-height: 70vh;
  border-left: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  border-radius: 0 8px 8px 0;
}
```

---

## Trigger Logic

| Event | Action |
|-------|--------|
| `mouseenter` on suggestion `el` | `void this.updatePreview(result.path)` |
| `onSelectedChange(result)` | `this.debouncedPreview(result.path)` (100 ms, resets on each call) |
| Modal closes (`onClose`) | unload child, remove class, reset state |

---

## Error Handling

| Situation | Behavior |
|-----------|----------|
| `getAbstractFileByPath` returns null | silently return, panel unchanged |
| path is a folder (not TFile) | silently return, panel unchanged |
| `cachedRead` throws | `previewEl.hide()`, return |
| Stale async call | `previewCallId` guard returns early at step 6 |
| Old child on new render | unloaded synchronously at step 3c (before any await) |

---

## Testing

New unit tests in `test/modal.test.ts`.
`MarkdownRenderer.render` and `MarkdownRenderChild` must be mocked in the `vi.mock('obsidian', ...)` block — they call into Obsidian's internal rendering pipeline unavailable in jsdom.

Tests to add:
- `renderSuggestion does not render snippet element`
- `updatePreview creates previewEl on first call and adds hybrid-search-expanded to modalEl`
- `updatePreview calls MarkdownRenderer.render with correct arguments`
- `updatePreview skips re-render for same path`
- `updatePreview hides panel on cachedRead error`
- `onClose unloads previewChild and removes hybrid-search-expanded`

Existing tests must continue to pass unchanged.

---

## Out of Scope

- Dataview live query execution (static render is sufficient for navigation preview)
- Edit mode in preview panel
- Pinning / detaching the preview panel
