# Hover Preview Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline snippet in search results with a fixed preview panel to the right of the modal that renders the full note using `MarkdownRenderer.render()`.

**Architecture:** On hover or keyboard navigation, `SearchModal` renders the selected note into a lazily-created `div.hybrid-search-preview` appended to `this.modalEl`. The modal widens via CSS class `hybrid-search-expanded`. Race conditions are prevented by a monotonic call counter; the previous `MarkdownRenderChild` is unloaded synchronously before each render.

**Tech Stack:** TypeScript, Obsidian API (`MarkdownRenderer`, `MarkdownRenderChild`, `debounce`, `TFile`), Vitest (unit tests), jsdom

---

## File Map

| File | Role |
|------|------|
| `src/ui/SearchModal.ts` | Add preview state, `updatePreview()`, `onSelectedChange()`, `debouncedPreview`; remove snippet from `renderSuggestion()`; update `onClose()` and `getSuggestions()` |
| `styles.css` | Add flex layout for `.hybrid-search-expanded.modal`, fixed-width `.prompt`, `.hybrid-search-preview` panel; remove `.hybrid-search-snippet` |
| `test/modal.test.ts` | Add tests for new behavior; update existing tests affected by `snippetLength: 0` and snippet removal |
| `__mocks__/obsidian.ts` | Add `MarkdownRenderer`, `MarkdownRenderChild`, `TFile`, `debounce` stubs; add `modalEl` to `Modal` |
| `test/setup.ts` | Add `createDiv`, `addClass`, `removeClass`, `show`, `hide` polyfills to `HTMLElement.prototype` |

---

## Task 1: Extend mocks and test setup

**Files:**
- Modify: `__mocks__/obsidian.ts`
- Modify: `test/setup.ts`

The `updatePreview` method calls Obsidian-specific HTML methods (`createDiv`, `addClass`, `removeClass`, `show`, `hide`) and needs `modalEl` on the modal. These are not in jsdom by default and not in the current mock.

- [ ] **Step 1: Add missing stubs to `__mocks__/obsidian.ts`**

Open `__mocks__/obsidian.ts` and add the following exports at the bottom:

```typescript
export class TFile {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
}

export class MarkdownRenderChild {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
  }
  load(): void {}
  unload(): void {}
}

export const MarkdownRenderer = {
  render: vi.fn().mockResolvedValue(undefined),
};

// Passthrough debounce — returns a plain function that calls cb immediately.
// resetTimer param is accepted and ignored.
export const debounce = <T extends unknown[]>(
  cb: (...args: T) => void,
  _wait?: number,
  _resetTimer?: boolean,
): ((...args: T) => void) & { cancel: () => void } => {
  const fn = (...args: T) => cb(...args);
  fn.cancel = () => {};
  return fn;
};
```

Also add `modalEl` to the `Modal` class (so `this.modalEl` is accessible in tests):

```typescript
// Inside the existing Modal class, add:
modalEl: HTMLElement = document.createElement('div');
```

- [ ] **Step 2: Add HTMLElement polyfills to `test/setup.ts`**

Open `test/setup.ts`. Following the same pattern used for `empty` and `createEl`, add polyfills for the five Obsidian-specific methods that `updatePreview` calls:

```typescript
// Add after existing HTMLElement polyfills:

HTMLElement.prototype.createDiv = function (cls?: string): HTMLDivElement {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  this.appendChild(div);
  return div as HTMLDivElement;
};

HTMLElement.prototype.addClass = function (...cls: string[]): void {
  this.classList.add(...cls);
};

HTMLElement.prototype.removeClass = function (...cls: string[]): void {
  this.classList.remove(...cls);
};

HTMLElement.prototype.show = function (): void {
  this.style.display = '';
};

HTMLElement.prototype.hide = function (): void {
  this.style.display = 'none';
};
```

- [ ] **Step 3: Run existing tests to confirm mock compiles and tests still pass**

```bash
cd obsidian-plugin && npm test
```

Expected: all existing tests pass (≥ 13 tests, 0 failures).

- [ ] **Step 4: Commit**

```bash
git add __mocks__/obsidian.ts test/setup.ts
git commit -m "test(mock): add MarkdownRenderer, MarkdownRenderChild, TFile, debounce stubs and HTMLElement polyfills"
```

---

## Task 2: Write failing tests for new SearchModal behavior

**Files:**
- Modify: `test/modal.test.ts`

Write all new tests first (TDD). They will fail until Task 3 implements the code. Also update two existing tests that are directly affected by the changes in Task 3.

- [ ] **Step 1: Add imports at the top of the test file**

The file already imports from `'vitest'` and `'../src/ipc'`. Add:

```typescript
import { MarkdownRenderer, TFile } from 'obsidian';
```

- [ ] **Step 2: Add vault mocks to the shared setup**

In `test/modal.test.ts`, extend the shared `mockApp` definition and `beforeEach` to add vault methods:

```typescript
// Near the top, alongside mockGetCache:
const mockCachedRead = vi.fn().mockResolvedValue('# Note Content\n\nSome body text.');
const mockGetAbstractFileByPath = vi.fn();
const mockRender = vi.mocked(MarkdownRenderer.render);

// Update mockApp to add vault:
const mockApp = {
  workspace: { openLinkText: vi.fn() },
  vault: {
    adapter: { getBasePath: () => '/vault' },
    cachedRead: mockCachedRead,
    getAbstractFileByPath: mockGetAbstractFileByPath,
  },
  metadataCache: { getCache: mockGetCache },
};

// In the shared beforeEach, add:
mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
mockGetAbstractFileByPath.mockReturnValue(new TFile(sampleResult.path));
mockRender.mockClear();
```

- [ ] **Step 3: Update existing test that asserts snippetLength**

Find the test `'getSuggestions calls client.search with settings options'`. It currently asserts `snippetLength: DEFAULT_SETTINGS.snippetLength`. After Task 3, `getSuggestions` will pass `snippetLength: 0`. Update the assertion now so the test passes after Task 3 without a surprise failure:

```typescript
// Change:
expect(mockSearch).toHaveBeenCalledWith('zettel', {
  mode: DEFAULT_SETTINGS.defaultMode,
  limit: DEFAULT_SETTINGS.limit,
  snippetLength: DEFAULT_SETTINGS.snippetLength,
});

// To:
expect(mockSearch).toHaveBeenCalledWith('zettel', {
  mode: DEFAULT_SETTINGS.defaultMode,
  limit: DEFAULT_SETTINGS.limit,
  snippetLength: 0,
});
```

- [ ] **Step 4: Delete the old snippet test**

Find and delete the test `'renderSuggestion shows snippet when present'` — it asserts `.hybrid-search-snippet` exists, which will be false after Task 3.

- [ ] **Step 5: Add the new test cases**

Add a new `describe` block at the bottom of the file:

```typescript
describe('SearchModal — hover preview', () => {
  let modal: SearchModal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([sampleResult]);
    mockCachedRead.mockResolvedValue('# Note Content\n\nSome body text.');
    mockGetAbstractFileByPath.mockReturnValue(new TFile(sampleResult.path));
    modal = new SearchModal(mockApp as never, mockClient as never, DEFAULT_SETTINGS);
  });

  it('renderSuggestion does not render snippet element', () => {
    const el = document.createElement('div');
    modal.renderSuggestion(sampleResult, el);
    expect(el.querySelector('.hybrid-search-snippet')).toBeNull();
  });

  it('updatePreview creates previewEl and adds hybrid-search-expanded to modalEl on first call', async () => {
    await (modal as any).updatePreview(sampleResult.path);
    expect((modal as any).previewEl).toBeDefined();
    expect((modal as any).modalEl?.classList.contains('hybrid-search-expanded')).toBe(true);
  });

  it('updatePreview calls MarkdownRenderer.render with correct arguments', async () => {
    await (modal as any).updatePreview(sampleResult.path);
    expect(mockRender).toHaveBeenCalledWith(
      mockApp,
      '# Note Content\n\nSome body text.',
      expect.any(HTMLElement),
      sampleResult.path,
      expect.any(Object),
    );
  });

  it('updatePreview skips re-render for the same path', async () => {
    await (modal as any).updatePreview(sampleResult.path);
    await (modal as any).updatePreview(sampleResult.path);
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it('updatePreview hides panel on cachedRead error', async () => {
    mockCachedRead.mockRejectedValue(new Error('read error'));
    await (modal as any).updatePreview(sampleResult.path);
    const previewEl = (modal as any).previewEl as HTMLElement | undefined;
    expect(previewEl?.style.display).toBe('none');
  });

  it('onClose unloads previewChild and removes hybrid-search-expanded', async () => {
    await (modal as any).updatePreview(sampleResult.path);
    const child = (modal as any).previewChild;
    const unloadSpy = vi.spyOn(child, 'unload');
    modal.onClose();
    expect(unloadSpy).toHaveBeenCalled();
    expect((modal as any).modalEl?.classList.contains('hybrid-search-expanded')).toBe(false);
  });
});
```

- [ ] **Step 6: Run tests — confirm new tests fail, existing pass**

```bash
cd obsidian-plugin && npm test
```

Expected: the 6 new tests FAIL (methods not yet implemented). All pre-existing tests (minus the deleted snippet one) pass.

- [ ] **Step 7: Commit failing tests**

```bash
git add test/modal.test.ts
git commit -m "test(modal): add failing tests for hover preview panel"
```

---

## Task 3: Implement hover preview in SearchModal

**Files:**
- Modify: `src/ui/SearchModal.ts`

- [ ] **Step 1: Update the import line**

At the top of `SearchModal.ts`, extend the `obsidian` import:

```typescript
import { App, debounce, MarkdownRenderChild, MarkdownRenderer, SuggestModal, TFile } from 'obsidian';
```

(`debounce` is from `'obsidian'` — not lodash or any other library.)

- [ ] **Step 2: Add private state fields to the class**

Inside the class body, after `private debounce?: ReturnType<typeof setTimeout>;`:

```typescript
private previewEl?: HTMLDivElement;
private previewChild?: MarkdownRenderChild;
private currentPreviewPath?: string;
private previewCallId = 0;

private readonly debouncedPreview = debounce(
  (path: string) => { void this.updatePreview(path); },
  100,
  true, // resetTimer: true — resets on each call, fires after the last one
);
```

- [ ] **Step 3: Add onSelectedChange override**

Add this method to the class (after `onClose`):

```typescript
// @ts-ignore — internal SuggestModal API, fires on arrow-key navigation
onSelectedChange(result: SearchResult | null): void {
  if (result) this.debouncedPreview(result.path);
}
```

- [ ] **Step 4: Add updatePreview method**

Add this async method to the class:

```typescript
private async updatePreview(path: string): Promise<void> {
  if (path === this.currentPreviewPath) return;

  const callId = ++this.previewCallId;

  // Synchronous DOM setup — must happen before any await
  if (!this.previewEl) {
    this.previewEl = this.modalEl.createDiv('hybrid-search-preview');
    this.modalEl.addClass('hybrid-search-expanded');
  }
  this.previewEl.show();
  this.previewChild?.unload();
  this.previewChild = undefined;
  this.previewEl.empty();

  const abstract = this.app.vault.getAbstractFileByPath(path);
  if (!abstract || !(abstract instanceof TFile)) return;

  let content: string;
  try {
    content = await this.app.vault.cachedRead(abstract);
  } catch {
    this.previewEl.hide();
    return;
  }

  if (callId !== this.previewCallId) return;

  this.previewChild = new MarkdownRenderChild(this.previewEl);
  this.previewChild.load();
  await MarkdownRenderer.render(this.app, content, this.previewEl, path, this.previewChild);
  this.currentPreviewPath = path;
}
```

- [ ] **Step 5: Update renderSuggestion — remove snippet, add mouseenter**

In `renderSuggestion`, delete the entire snippet block:

```typescript
// DELETE this block:
if (result.snippet) {
  container.createEl('div', { text: result.snippet.trim(), cls: 'hybrid-search-snippet' });
}
```

At the end of `renderSuggestion` (after the tags block), add:

```typescript
el.addEventListener('mouseenter', () => void this.updatePreview(result.path));
```

- [ ] **Step 6: Update onClose**

Replace the existing `onClose` method entirely:

```typescript
onClose(): void {
  this.unhookSuperchargedLinks();
  this.previewChild?.unload();
  this.modalEl.removeClass('hybrid-search-expanded');
  this.previewEl = undefined;
  this.currentPreviewPath = undefined;
}
```

- [ ] **Step 7: Update getSuggestions — pass snippetLength: 0**

In `getSuggestions`, change the options object in `this.client.search(query, {...})`:

```typescript
this.client.search(query, {
  mode: this.settings.defaultMode,
  limit: this.settings.limit,
  snippetLength: 0,   // snippets no longer displayed; skip server computation
})
```

- [ ] **Step 8: Run tests — all must pass**

```bash
cd obsidian-plugin && npm test
```

Expected: all tests pass (≥ 18 tests). Zero failures.

- [ ] **Step 9: Run full quality check**

```bash
npm run format && npm run build && npm test && npm run lint && npm run knip
```

Expected: 0 TypeScript errors, 0 lint errors, 0 knip issues.

- [ ] **Step 10: Commit**

```bash
git add src/ui/SearchModal.ts
git commit -m "feat(modal): add hover preview panel with MarkdownRenderer"
```

---

## Task 4: Add CSS for the expanded modal layout

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Remove the snippet CSS rule**

In `styles.css`, delete the `.hybrid-search-snippet` block:

```css
/* DELETE this entire block: */
.hybrid-search-snippet {
  font-size: 0.85em;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 2: Add preview panel and expanded modal styles**

Append to `styles.css`:

```css
/* Expanded modal: flex row when preview panel is open */
.hybrid-search-expanded.modal {
  display: flex;
  flex-direction: row;
  width: min(90vw, 1100px);
  max-width: 90vw;
}

/* Search list: fixed width inside the expanded modal */
.hybrid-search-expanded .prompt {
  flex: 0 0 480px;
}

/* Preview panel: fills remaining space */
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

- [ ] **Step 3: Run format + build**

```bash
cd obsidian-plugin && npm run format && npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "style(modal): add expanded layout and hover preview panel CSS"
```

---

## Task 5: Update main repo submodule pointer

**Files:**
- Modify: `obsidian-plugin` submodule reference (in main repo)

- [ ] **Step 1: Stage and commit submodule update from main repo root**

```bash
cd /Users/flowing-abyss/Main/obsidian-hybrid-search
git add obsidian-plugin
git commit -m "chore(obsidian-plugin): update submodule to hover preview panel"
```

---

## Verification

After all tasks are complete, run the full check:

```bash
cd obsidian-hybrid-search/obsidian-plugin
npm run format && npm run build && npm test && npm run lint && npm run knip
```

Expected:
- Build: 0 TypeScript errors
- Tests: all pass (≥ 18 tests)
- Lint: 0 errors
- Knip: 0 issues

Then reload the plugin in Obsidian (Settings → Community plugins → disable/enable Hybrid Search) and verify:
1. Search results show title + score + tags — no snippet
2. Hover over any result → preview panel appears to the right
3. Arrow keys navigate results → preview updates
4. Close modal → panel gone, class removed
