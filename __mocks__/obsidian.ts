/**
 * Minimal Obsidian API mock for unit tests.
 * Only stubs what the plugin actually uses — extend as needed.
 * The real `obsidian` package is provided by the Obsidian runtime, not Node.js.
 */

export class Workspace {
  openLinkText(_path: string, _sourcePath: string, _newLeaf: boolean): Promise<void> {
    return Promise.resolve();
  }
}

export class App {
  workspace: Workspace = new Workspace();
  vault = {
    adapter: {
      getBasePath: () => '/test-vault',
    },
  };
}

export class Plugin {
  app: App = new App();
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
  containerEl: HTMLElement = document.createElement('div');
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
  hide() {}
}

export class Modal {
  app: App;
  contentEl: HTMLElement = document.createElement('div');
  constructor(app: App) {
    this.app = app;
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

export class SuggestModal<T> extends Modal {
  setPlaceholder(_placeholder: string): void {}
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(_item: T, _el: HTMLElement) {}
  onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent) {}
}

export class TextComponent {
  setValue(_value: string): this {
    return this;
  }
  setPlaceholder(_placeholder: string): this {
    return this;
  }
  onChange(_cb: (value: string) => void): this {
    return this;
  }
}

export class ToggleComponent {
  setValue(_value: boolean): this {
    return this;
  }
  onChange(_cb: (value: boolean) => void): this {
    return this;
  }
}

export class DropdownComponent {
  addOption(_value: string, _display: string): this {
    return this;
  }
  setValue(_value: string): this {
    return this;
  }
  getValue(): string {
    return '';
  }
  onChange(_cb: (value: string) => void): this {
    return this;
  }
}

export class SliderComponent {
  setLimits(_min: number, _max: number, _step: number): this {
    return this;
  }
  setValue(_value: number): this {
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  onChange(_cb: (value: number) => void): this {
    return this;
  }
}

export class ButtonComponent {
  setButtonText(_text: string): this {
    return this;
  }
  setCta(): this {
    return this;
  }
  onClick(_cb: (evt: MouseEvent) => void): this {
    return this;
  }
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  addText(_cb: (text: TextComponent) => void): this {
    _cb(new TextComponent());
    return this;
  }
  addToggle(_cb: (toggle: ToggleComponent) => void): this {
    _cb(new ToggleComponent());
    return this;
  }
  addDropdown(_cb: (dropdown: DropdownComponent) => void): this {
    _cb(new DropdownComponent());
    return this;
  }
  addSlider(_cb: (slider: SliderComponent) => void): this {
    _cb(new SliderComponent());
    return this;
  }
  addButton(_cb: (btn: ButtonComponent) => void): this {
    _cb(new ButtonComponent());
    return this;
  }
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}
