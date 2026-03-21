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

if (typeof HTMLElement !== 'undefined' && !('createDiv' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & { createDiv: (cls?: string) => HTMLDivElement }
  ).createDiv = function (cls?: string): HTMLDivElement {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    this.appendChild(div);
    return div;
  };
}

if (typeof HTMLElement !== 'undefined' && !('addClass' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { addClass: (...cls: string[]) => void }).addClass =
    function (...cls: string[]): void {
      this.classList.add(...cls);
    };
}

if (typeof HTMLElement !== 'undefined' && !('removeClass' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { removeClass: (...cls: string[]) => void }).removeClass =
    function (...cls: string[]): void {
      this.classList.remove(...cls);
    };
}

if (typeof HTMLElement !== 'undefined' && !('show' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { show: () => void }).show = function (): void {
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    this.style.display = '';
  };
}

if (typeof HTMLElement !== 'undefined' && !('hide' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { hide: () => void }).hide = function (): void {
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    this.style.display = 'none';
  };
}
