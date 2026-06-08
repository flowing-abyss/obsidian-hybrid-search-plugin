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
    const el = activeDocument.createEl(tag);
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

if (typeof HTMLElement !== 'undefined' && !('createSvg' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & {
      createSvg: <K extends keyof SVGElementTagNameMap>(tag: K) => SVGElementTagNameMap[K];
    }
  ).createSvg = function <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    this.appendChild(el);
    return el;
  };
}

if (typeof SVGElement !== 'undefined' && !('createSvg' in SVGElement.prototype)) {
  (
    SVGElement.prototype as SVGElement & {
      createSvg: <K extends keyof SVGElementTagNameMap>(tag: K) => SVGElementTagNameMap[K];
    }
  ).createSvg = function <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    this.appendChild(el);
    return el;
  };
}

if (typeof HTMLElement !== 'undefined' && !('createDiv' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & {
      createDiv: (cls?: string | { cls?: string }) => HTMLDivElement;
    }
  ).createDiv = function (cls?: string | { cls?: string }): HTMLDivElement {
    const div = activeDocument.createDiv();
    if (typeof cls === 'string') {
      div.className = cls;
    } else if (cls?.cls) {
      div.className = cls.cls;
    }
    this.appendChild(div);
    return div;
  };
}

if (typeof HTMLElement !== 'undefined' && !('createSpan' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & {
      createSpan: (opts?: { text?: string; cls?: string }) => HTMLSpanElement;
    }
  ).createSpan = function (opts?: { text?: string; cls?: string }): HTMLSpanElement {
    const span = activeDocument.createSpan();
    if (opts?.text) span.textContent = opts.text;
    if (opts?.cls) span.className = opts.cls;
    this.appendChild(span);
    return span;
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

if (typeof HTMLElement !== 'undefined' && !('toggleClass' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & {
      toggleClass: (cls: string, enabled: boolean) => void;
    }
  ).toggleClass = function (cls: string, enabled: boolean): void {
    this.classList.toggle(cls, enabled);
  };
}

if (typeof HTMLElement !== 'undefined' && !('setCssProps' in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as HTMLElement & {
      setCssProps: (props: Record<string, string>) => void;
    }
  ).setCssProps = function (props: Record<string, string>): void {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
}

if (typeof HTMLElement !== 'undefined' && !('show' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { show: () => void }).show = function (): void {
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- polyfill show() for jsdom test environment
    this.style.display = '';
  };
}

if (typeof HTMLElement !== 'undefined' && !('isShown' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { isShown: () => boolean }).isShown = function () {
    return this.style.display !== 'none';
  };
}

if (typeof HTMLElement !== 'undefined' && !('hide' in HTMLElement.prototype)) {
  (HTMLElement.prototype as HTMLElement & { hide: () => void }).hide = function (): void {
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- polyfill hide() for jsdom test environment
    this.style.display = 'none';
  };
}

// Polyfill Obsidian's activeWindow / activeDocument globals for tests

if (typeof globalThis !== 'undefined') {
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  }
  if (!('activeWindow' in globalThis)) {
    const win =
      typeof window !== 'undefined'
        ? window
        : {
            setTimeout: (handler: TimerHandler, timeout?: number, ...rest: unknown[]): number =>
              globalThis.setTimeout(handler as VoidFunction, timeout, ...rest),
            clearTimeout: (id?: number): void => {
              globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
            },
          };
    (globalThis as Record<string, unknown>).activeWindow = win;
  }
  if (!('activeDocument' in globalThis) && typeof document !== 'undefined') {
    (globalThis as Record<string, unknown>).activeDocument = document;
  }
}

// Polyfill Obsidian's DOM helper methods on Document.
// Obsidian adds createEl/createDiv/createSpan to both HTMLElement and Document.
// jsdom's Document does not extend HTMLElement, so the HTMLElement.prototype
// polyfills above don't cover activeDocument.createDiv() etc.
type ObsidianCreateElOpts = { text?: string; cls?: string; attr?: Record<string, string> };

if (typeof Document !== 'undefined') {
  if (!('createEl' in Document.prototype)) {
    (
      Document.prototype as Document & {
        createEl: <K extends keyof HTMLElementTagNameMap>(
          tag: K,
          opts?: ObsidianCreateElOpts,
        ) => HTMLElementTagNameMap[K];
      }
    ).createEl = function <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      opts?: ObsidianCreateElOpts,
    ): HTMLElementTagNameMap[K] {
      const el = document.createElement(tag);
      if (opts?.text) el.textContent = opts.text;
      if (opts?.cls) el.className = opts.cls;
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          el.setAttribute(k, v);
        }
      }
      return el;
    };
  }
  if (!('createDiv' in Document.prototype)) {
    (
      Document.prototype as Document & {
        createDiv: (opts?: string | { cls?: string }) => HTMLDivElement;
      }
    ).createDiv = function (opts?: string | { cls?: string }): HTMLDivElement {
      const div = document.createElement('div');
      if (typeof opts === 'string') {
        div.className = opts;
      } else if (opts?.cls) {
        div.className = opts.cls;
      }
      return div;
    };
  }
  if (!('createSpan' in Document.prototype)) {
    (
      Document.prototype as Document & {
        createSpan: (opts?: { text?: string; cls?: string }) => HTMLSpanElement;
      }
    ).createSpan = function (opts?: { text?: string; cls?: string }): HTMLSpanElement {
      const span = document.createElement('span');
      if (opts?.text) span.textContent = opts.text;
      if (opts?.cls) span.className = opts.cls;
      return span;
    };
  }
}
