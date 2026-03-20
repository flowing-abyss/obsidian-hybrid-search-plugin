/**
 * Minimal Obsidian API mock for unit tests.
 * Only stubs what the plugin actually uses — extend as needed.
 * The real `obsidian` package is provided by the Obsidian runtime, not Node.js.
 */

export class Plugin {
  app: App = new App();
  addRibbonIcon(_icon: string, _title: string, _cb: (evt: MouseEvent) => void) {}
  addCommand(_cmd: { id: string; name: string; callback: () => void }) {}
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

export class App {}

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
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(_item: T, _el: HTMLElement) {}
  onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent) {}
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

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}
