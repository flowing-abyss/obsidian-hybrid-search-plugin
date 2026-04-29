/**
 * Minimal Obsidian API mock for unit tests.
 * Only stubs what the plugin actually uses — extend as needed.
 * The real `obsidian` package is provided by the Obsidian runtime, not Node.js.
 */
import { vi } from 'vitest';

export class Workspace {
  trigger = vi.fn();
  getLeaf = vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) });
  activeEditor?: {
    editor: { replaceRange: ReturnType<typeof vi.fn>; getCursor: ReturnType<typeof vi.fn> };
  };

  openLinkText(_path: string, _sourcePath: string, _newLeaf: boolean): Promise<void> {
    return Promise.resolve();
  }
}

export class MetadataCache {
  resolvedLinks: Record<string, Record<string, number>> = {};

  getCache(_path: string): { frontmatter?: Record<string, unknown> } | null {
    return null;
  }

  getFirstLinkpathDest(path: string, _sourcePath: string): TFile | null {
    return new TFile(path.endsWith('.md') ? path : `${path}.md`);
  }
}

export class App {
  workspace: Workspace = new Workspace();
  metadataCache: MetadataCache = new MetadataCache();
  vault = {
    adapter: {
      getBasePath: () => '/test-vault',
    },
  };
}

export class Plugin {
  app: App;
  constructor(app?: App) {
    this.app = app ?? new App();
  }
  addRibbonIcon(_icon: string, _title: string, _cb: (evt: MouseEvent) => void) {}
  addCommand(_cmd: {
    id: string;
    name: string;
    callback?: () => void;
    hotkeys?: Array<{ modifiers: string[]; key: string }>;
  }) {}
  loadData(): Promise<unknown> {
    return Promise.resolve({});
  }
  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
  addSettingTab(_tab: PluginSettingTab) {}
  registerDomEvent(
    _el: EventTarget,
    _type: string,
    _listener: EventListenerOrEventListenerObject,
  ) {}
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement = activeDocument.createDiv();
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
  hide() {}
}

export class Modal {
  app: App;
  contentEl: HTMLElement = activeDocument.createDiv();
  modalEl: HTMLElement = activeDocument.createDiv();
  constructor(app: App) {
    this.app = app;
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

export class SuggestModal<T> extends Modal {
  scope = { register: vi.fn() };
  setPlaceholder(_placeholder: string): void {}
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(_item: T, _el: HTMLElement) {}
  onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent) {}
}

export class TextComponent {
  private cb?: (value: string) => void;
  setValue(_value: string): this {
    return this;
  }
  setPlaceholder(_placeholder: string): this {
    return this;
  }
  onChange(cb: (value: string) => void): this {
    this.cb = cb;
    return this;
  }
  triggerChange(value: string): void {
    this.cb?.(value);
  }
}

export class ToggleComponent {
  private cb?: (value: boolean) => void;
  setValue(_value: boolean): this {
    return this;
  }
  onChange(cb: (value: boolean) => void): this {
    this.cb = cb;
    return this;
  }
  triggerChange(value: boolean): void {
    this.cb?.(value);
  }
}

export class DropdownComponent {
  private cb?: (value: string) => void;
  addOption(_value: string, _display: string): this {
    return this;
  }
  setValue(_value: string): this {
    return this;
  }
  getValue(): string {
    return '';
  }
  onChange(cb: (value: string) => void): this {
    this.cb = cb;
    return this;
  }
  triggerChange(value: string): void {
    this.cb?.(value);
  }
}

export class SliderComponent {
  private cb?: (value: number) => void;
  setLimits(_min: number, _max: number, _step: number): this {
    return this;
  }
  setValue(_value: number): this {
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  onChange(cb: (value: number) => void): this {
    this.cb = cb;
    return this;
  }
  triggerChange(value: number): void {
    this.cb?.(value);
  }
}

export class ButtonComponent {
  private cb?: (evt: MouseEvent) => void;
  setButtonText(_text: string): this {
    return this;
  }
  setCta(): this {
    return this;
  }
  onClick(cb: (evt: MouseEvent) => void): this {
    this.cb = cb;
    return this;
  }
  triggerClick(evt?: MouseEvent): void {
    this.cb?.(evt ?? new MouseEvent('click'));
  }
}

export class Setting {
  static readonly instances: Setting[] = [];
  static clearInstances(): void {
    Setting.instances.length = 0;
  }
  private nameEl: HTMLElement;
  textComponents: TextComponent[] = [];
  toggleComponents: ToggleComponent[] = [];
  dropdownComponents: DropdownComponent[] = [];
  buttonComponents: ButtonComponent[] = [];
  constructor(containerEl: HTMLElement) {
    Setting.instances.push(this);
    const item = activeDocument.createDiv();
    item.className = 'setting-item';
    containerEl.appendChild(item);
    const nameEl = activeDocument.createDiv();
    nameEl.className = 'setting-item-name';
    item.appendChild(nameEl);
    this.nameEl = nameEl;
  }
  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }
  getName(): string {
    return this.nameEl.textContent ?? '';
  }
  setDesc(_desc: string): this {
    return this;
  }
  addText(cb: (text: TextComponent) => void): this {
    const t = new TextComponent();
    this.textComponents.push(t);
    cb(t);
    return this;
  }
  addToggle(cb: (toggle: ToggleComponent) => void): this {
    const t = new ToggleComponent();
    this.toggleComponents.push(t);
    cb(t);
    return this;
  }
  addDropdown(cb: (dropdown: DropdownComponent) => void): this {
    const d = new DropdownComponent();
    this.dropdownComponents.push(d);
    cb(d);
    return this;
  }
  addSlider(_cb: (slider: SliderComponent) => void): this {
    return this;
  }
  addButton(cb: (btn: ButtonComponent) => void): this {
    const b = new ButtonComponent();
    this.buttonComponents.push(b);
    cb(b);
    return this;
  }
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

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
