// Polyfill Obsidian's HTMLElement extensions for jsdom tests
// Obsidian adds .empty() to HTMLElement — remove all children
if (typeof HTMLElement !== 'undefined' && !('empty' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { empty: () => void }).empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}

if (typeof HTMLElement !== 'undefined' && !('createEl' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & {
      createEl: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        opts?: { text?: string; cls?: string; attr?: Record<string, string> },
      ) => HTMLElementTagNameMap[K];
    }
  ).createEl = function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: { text?: string; cls?: string; attr?: Record<string, string> },
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (opts?.text) el.textContent = opts.text;
    if (opts?.cls) el.className = opts.cls;
    if (opts?.attr) {
      for (const [k, v] of Object.entries(opts.attr)) {
        el.setAttribute(k, v);
      }
    }
    this.appendChild(el);
    return el;
  };
}
