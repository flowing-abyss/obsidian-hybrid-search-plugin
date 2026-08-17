import { App, Notice, PluginSettingTab, SecretComponent, Setting, setIcon } from 'obsidian';
import type { HttpSearchClient, SearchClient } from './ipc';
import { getApiKey, isSecretStorageAvailable, setApiKey } from './secrets';
import type { CustomPostfix } from './ui/queryParser';
import { isReservedPostfixName, normalizePostfixName } from './ui/queryParser';
import { StatusSection } from './ui/statusSection';

export interface HybridSearchSettings {
  binaryPath: string;
  transport: 'stdio' | 'http';
  httpHost: string;
  httpPort: number;
  httpFallbackEnabled: boolean;
  httpFallbackHost: string;
  httpFallbackPort: number;
  defaultMode: 'hybrid' | 'semantic' | 'fulltext' | 'title';
  defaultSearchFilters: string;
  customPostfixes: CustomPostfix[];
  showMeta: boolean;
  showPreviewMeta: boolean;
  centerPanels: boolean;
  showPreview: boolean;
  showGraphPanel: boolean;
  scrollToSnippet: boolean;
  rememberLastQuery: boolean;
  lastQuery: string;
  showSimilarNotesAtBottom: boolean;
  similarNotesBottomLimit: number;
  similarNotesThreshold: number;
  searchPanelLimit: number;
  searchPanelThreshold: number;
  inlineSearchEnabled: boolean;
  inlineSearchTrigger: string;
  inlineSearchLimit: number;
  inlineSearchThreshold: number;
  inlineSearchShowPreview: boolean;
}

export const DEFAULT_SETTINGS: HybridSearchSettings = {
  binaryPath: '',
  transport: 'stdio',
  httpHost: '127.0.0.1',
  httpPort: 3939,
  httpFallbackEnabled: false,
  httpFallbackHost: '127.0.0.1',
  httpFallbackPort: 3939,
  defaultMode: 'hybrid',
  defaultSearchFilters: '',
  customPostfixes: [],
  showMeta: false,
  showPreviewMeta: true,
  centerPanels: false,
  showPreview: true,
  showGraphPanel: false,
  scrollToSnippet: false,
  rememberLastQuery: true,
  lastQuery: '',
  showSimilarNotesAtBottom: false,
  similarNotesBottomLimit: 5,
  similarNotesThreshold: 0,
  searchPanelLimit: 20,
  searchPanelThreshold: 0,
  inlineSearchEnabled: true,
  inlineSearchTrigger: ';;',
  inlineSearchLimit: 10,
  inlineSearchThreshold: 0,
  inlineSearchShowPreview: true,
};

function normalizeCustomPostfixes(value: unknown): CustomPostfix[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CustomPostfix[] = [];
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { name?: unknown }).name !== 'string' ||
      typeof (entry as { filters?: unknown }).filters !== 'string'
    ) {
      continue;
    }
    const { name, filters } = entry as CustomPostfix;
    const normalizedName = normalizePostfixName(name);
    if (!normalizedName || isReservedPostfixName(normalizedName) || seen.has(normalizedName)) {
      continue;
    }
    seen.add(normalizedName);
    result.push({ name, filters });
  }
  return result;
}

export function normalizeSettings(settings: HybridSearchSettings): HybridSearchSettings {
  return {
    ...settings,
    defaultSearchFilters:
      typeof settings.defaultSearchFilters === 'string'
        ? settings.defaultSearchFilters
        : DEFAULT_SETTINGS.defaultSearchFilters,
    customPostfixes: normalizeCustomPostfixes(settings.customPostfixes),
    inlineSearchEnabled:
      typeof settings.inlineSearchEnabled === 'boolean'
        ? settings.inlineSearchEnabled
        : DEFAULT_SETTINGS.inlineSearchEnabled,
    inlineSearchTrigger:
      typeof settings.inlineSearchTrigger === 'string' &&
      settings.inlineSearchTrigger.trim() &&
      !settings.inlineSearchTrigger.trim().startsWith('[')
        ? settings.inlineSearchTrigger.trim()
        : DEFAULT_SETTINGS.inlineSearchTrigger,
    inlineSearchLimit: clampInteger(
      settings.inlineSearchLimit,
      1,
      50,
      DEFAULT_SETTINGS.inlineSearchLimit,
    ),
    inlineSearchThreshold: clampNumber(
      settings.inlineSearchThreshold,
      0,
      1,
      DEFAULT_SETTINGS.inlineSearchThreshold,
    ),
    inlineSearchShowPreview:
      typeof settings.inlineSearchShowPreview === 'boolean'
        ? settings.inlineSearchShowPreview
        : DEFAULT_SETTINGS.inlineSearchShowPreview,
  };
}

const HTTP_START_COMMAND =
  'OBSIDIAN' + '_VAULT_PATH="/path/to/your/vault" obsidian-hybrid-search serve';

/** Narrow interface — only what the SettingTab needs from the plugin */
interface PluginRef {
  settings: HybridSearchSettings;
  saveSettings(): Promise<void>;
  restartClient?(): void | Promise<void>;
  onSimilarNotesSettingsChanged?(): void;
  client?: SearchClient | HttpSearchClient;
}

const API_KEY_DESC =
  'Optional. Needed only if your embedding provider requires authentication. ' +
  'Stored in the Obsidian keychain, never in the vault.';

const API_KEY_UNSUPPORTED_DESC =
  'Optional. Storing a key requires Obsidian 1.11.4 or newer. On older versions, set OPENAI_API_KEY ' +
  'in the environment and use the HTTP connection mode with a server you start yourself.';

const API_KEY_APPLY_DELAY_MS = 600;

export class HybridSearchSettingTab extends PluginSettingTab {
  private statusSection: StatusSection | null = null;
  private apiKeyApplyTimer = 0;
  /** Runs the pending key edit if the tab closes before the debounce lands. */
  private pendingApiKey: (() => void) | null = null;

  constructor(
    app: App,
    private plugin: PluginRef,
  ) {
    super(app, plugin as never);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('hybrid-search-settings');

    this.statusSection?.dispose();
    const statusSection = new StatusSection({
      settings: this.plugin.settings,
      getApiKey: () => getApiKey(this.app),
      getClient: () => this.plugin.client,
      getEndpointLabel: () => this.endpointLabel(),
    });
    this.statusSection = statusSection;
    statusSection.renderSummary(this.addSection(containerEl, 'Index', 'database', { open: true }));

    const connectionEl = this.addSection(containerEl, 'Connection', 'plug-zap');

    new Setting(connectionEl)
      .setName('Connection mode')
      .setDesc(
        'Use stdio to let the plugin start the local CLI process, or HTTP to connect to a shared mcp server.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('stdio', 'STDIO')
          .addOption('http', 'HTTP')
          .setValue(this.plugin.settings.transport)
          .onChange(async (value) => {
            this.plugin.settings.transport = value as HybridSearchSettings['transport'];
            await this.plugin.saveSettings();
            await this.plugin.restartClient?.();
            httpSettingsEl.hidden = value !== 'http';
            stdioSettingsEl.hidden = value !== 'stdio';
            fallbackSettingsEl.hidden = !(
              value === 'http' && this.plugin.settings.httpFallbackEnabled
            );
          }),
      );

    const httpSettingsEl = connectionEl.createDiv();
    const fallbackSettingsEl = connectionEl.createDiv();
    const stdioSettingsEl = connectionEl.createDiv();

    new Setting(httpSettingsEl).setName('Start server').setDesc(HTTP_START_COMMAND);

    new Setting(httpSettingsEl)
      .setName('HTTP host')
      .setDesc('Host of the shared mcp HTTP server.')
      .addText((text) =>
        text
          .setPlaceholder('127.0.0.1')
          .setValue(this.plugin.settings.httpHost)
          .onChange(async (value) => {
            this.plugin.settings.httpHost = value.trim() || DEFAULT_SETTINGS.httpHost;
            await this.plugin.saveSettings();
            await this.plugin.restartClient?.();
          }),
      );

    new Setting(httpSettingsEl)
      .setName('HTTP port')
      .setDesc('Port of the shared mcp HTTP server.')
      .addText((text) =>
        text
          .setPlaceholder('3939')
          .setValue(String(this.plugin.settings.httpPort))
          .onChange(async (value) => {
            const port = Number(value);
            if (Number.isInteger(port) && port > 0 && port <= 65_535) {
              this.plugin.settings.httpPort = port;
              await this.plugin.saveSettings();
              await this.plugin.restartClient?.();
            }
          }),
      );

    new Setting(httpSettingsEl)
      .setName('Enable fallback server')
      .setDesc(
        'Use a secondary mcp HTTP server when the primary server is unavailable. The fallback should serve the same vault/index.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.httpFallbackEnabled).onChange(async (value) => {
          this.plugin.settings.httpFallbackEnabled = value;
          await this.plugin.saveSettings();
          await this.plugin.restartClient?.();
          fallbackSettingsEl.hidden = !value;
        }),
      );

    new Setting(fallbackSettingsEl)
      .setName('Fallback HTTP host')
      .setDesc('Host of the fallback mcp HTTP server.')
      .addText((text) =>
        text
          .setPlaceholder('127.0.0.1')
          .setValue(this.plugin.settings.httpFallbackHost)
          .onChange(async (value) => {
            this.plugin.settings.httpFallbackHost =
              value.trim() || DEFAULT_SETTINGS.httpFallbackHost;
            await this.plugin.saveSettings();
            await this.plugin.restartClient?.();
          }),
      );

    new Setting(fallbackSettingsEl)
      .setName('Fallback HTTP port')
      .setDesc('Port of the fallback mcp HTTP server.')
      .addText((text) =>
        text
          .setPlaceholder('3939')
          .setValue(String(this.plugin.settings.httpFallbackPort))
          .onChange(async (value) => {
            const port = Number(value);
            if (Number.isInteger(port) && port > 0 && port <= 65_535) {
              this.plugin.settings.httpFallbackPort = port;
              await this.plugin.saveSettings();
              await this.plugin.restartClient?.();
            }
          }),
      );

    new Setting(stdioSettingsEl)
      .setName('Binary path')
      .setDesc(
        'Absolute path to the Obsidian-hybrid-search binary. Leave empty to search in path. Common locations: /opt/homebrew/bin/Obsidian-hybrid-search, /usr/local/bin/Obsidian-hybrid-search, ~/.npm/bin/Obsidian-hybrid-search.',
      )
      .addText((text) =>
        text
          .setPlaceholder('Obsidian-hybrid-search')
          .setValue(this.plugin.settings.binaryPath)
          .onChange(async (value) => {
            this.plugin.settings.binaryPath = value;
            await this.plugin.saveSettings();
            await this.plugin.restartClient?.();
          }),
      );

    this.renderApiKeySetting(stdioSettingsEl);

    httpSettingsEl.hidden = this.plugin.settings.transport !== 'http';
    stdioSettingsEl.hidden = this.plugin.settings.transport !== 'stdio';
    fallbackSettingsEl.hidden = !(
      this.plugin.settings.transport === 'http' && this.plugin.settings.httpFallbackEnabled
    );

    new Setting(connectionEl)
      .setName('Test connection')
      .setDesc('Send a test query to verify the server is running.')
      .addButton((btn) =>
        btn
          .setButtonText('Test')
          .setCta()
          .onClick(async () => {
            if (!this.plugin.client) {
              new Notice('Search client not initialised.');
              return;
            }
            try {
              await this.plugin.client.search('test', { limit: 1 });
              new Notice('Connected. Server running.');
            } catch (err) {
              new Notice(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }),
      );

    const searchEl = this.addSection(containerEl, 'Search behavior', 'search');

    new Setting(searchEl)
      .setName('Default mode')
      .setDesc('Search mode used when opening the modal.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('hybrid', 'Hybrid (bm25 + trigram + semantic)')
          .addOption('fulltext', 'Fulltext (bm25 only)')
          .addOption('semantic', 'Semantic (vector only)')
          .addOption('title', 'Title (fuzzy)')
          .setValue(this.plugin.settings.defaultMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultMode = value as HybridSearchSettings['defaultMode'];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(searchEl)
      .setName('Default search filters')
      .setDesc(
        'Always applied to every search, in addition to what you type. Use the same operators as inline search: tag:value, -tag:value to exclude, folder:value (or path:value), -folder:value to exclude. Mode prefixes (hybrid:, title:, ...) are not supported here. Example: -tag:archive -folder:templates',
      )
      .addText((text) =>
        text
          .setPlaceholder('-tag:archive -folder:templates')
          .setValue(this.plugin.settings.defaultSearchFilters)
          .onChange(async (value) => {
            this.plugin.settings.defaultSearchFilters = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(searchEl)
      .setName('Custom search postfixes')
      .setDesc(
        'Define your own @name shortcuts that expand to a filter string when typed in search, e.g. @work expands to -tag:personal folder:work.',
      );

    const postfixListEl = searchEl.createDiv();
    const renderPostfixList = (): void => {
      postfixListEl.empty();
      this.plugin.settings.customPostfixes.forEach((postfix, index) => {
        renderCustomPostfixRow(postfixListEl, this.plugin, index, renderPostfixList);
      });
    };
    renderPostfixList();

    new Setting(searchEl).addButton((btn) =>
      btn.setButtonText('Add postfix').onClick(async () => {
        this.plugin.settings.customPostfixes.push({ name: '', filters: '' });
        await this.plugin.saveSettings();
        renderPostfixList();
      }),
    );

    new Setting(searchEl)
      .setName('Remember last search query')
      .setDesc('Restore the previous search query when reopening the search modal.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rememberLastQuery).onChange(async (value) => {
          this.plugin.settings.rememberLastQuery = value;
          await this.plugin.saveSettings();
        }),
      );

    const displayEl = this.addSection(containerEl, 'Display', 'layout-list');

    new Setting(displayEl)
      .setName('Show path and tags')
      .setDesc('Display folder path and tags below the note title in search results.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showMeta).onChange(async (value) => {
          this.plugin.settings.showMeta = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(displayEl)
      .setName('Show preview')
      .setDesc('Show a live preview panel next to search results when hovering or navigating.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showPreview).onChange(async (value) => {
          this.plugin.settings.showPreview = value;
          await this.plugin.saveSettings();
          previewSettingsEl.hidden = !value;
        }),
      );

    const previewSettingsEl = displayEl.createDiv();

    new Setting(displayEl)
      .setName('Show graph panel')
      .setDesc(
        'Show an interactive local graph panel to the right of the preview when hovering or navigating search results.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showGraphPanel).onChange(async (value) => {
          this.plugin.settings.showGraphPanel = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(previewSettingsEl)
      .setName('Show note metadata in preview')
      .setDesc('Display folder, aliases, tags, links, and backlinks below the preview panel.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showPreviewMeta).onChange(async (value) => {
          this.plugin.settings.showPreviewMeta = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(previewSettingsEl)
      .setName('Center search and preview')
      .setDesc(
        'Shift the search panel so that the search list and preview panel together appear centered on screen. Disable if your theme positions the modal itself (e.g., left-aligned).',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.centerPanels).onChange(async (value) => {
          this.plugin.settings.centerPanels = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(previewSettingsEl)
      .setName('Scroll preview to relevant snippet')
      .setDesc(
        'Automatically scroll the preview panel to the matching passage when navigating search results.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.scrollToSnippet).onChange(async (value) => {
          this.plugin.settings.scrollToSnippet = value;
          await this.plugin.saveSettings();
        }),
      );

    previewSettingsEl.hidden = !this.plugin.settings.showPreview;

    const inlineEl = this.addSection(containerEl, 'Inline search', 'text-cursor-input');

    new Setting(inlineEl)
      .setName('Enable inline search')
      .setDesc('Open a compact search menu in the editor after typing this trigger.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.inlineSearchEnabled).onChange(async (value) => {
          this.plugin.settings.inlineSearchEnabled = value;
          await this.plugin.saveSettings();
          inlineSearchSettingsEl.hidden = !value;
        }),
      );

    const inlineSearchSettingsEl = inlineEl.createDiv();

    new Setting(inlineSearchSettingsEl)
      .setName('Trigger text')
      .setDesc('Text that opens inline search while editing.')
      .addText((text) =>
        text
          .setPlaceholder(';;')
          .setValue(this.plugin.settings.inlineSearchTrigger)
          .onChange(async (value) => {
            const trigger = value.trim();
            if (trigger.startsWith('[')) return;
            this.plugin.settings.inlineSearchTrigger =
              trigger || DEFAULT_SETTINGS.inlineSearchTrigger;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(inlineSearchSettingsEl)
      .setName('Inline result limit')
      .setDesc('Maximum number of notes shown in the inline search menu.')
      .addText((text) =>
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.inlineSearchLimit))
          .onChange(async (value) => {
            const limit = Number(value);
            if (Number.isInteger(limit) && limit >= 1 && limit <= 50) {
              this.plugin.settings.inlineSearchLimit = limit;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(inlineSearchSettingsEl)
      .setName('Inline minimum relevance')
      .setDesc('Hide inline results below this score. Use 0 to keep every result.')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.inlineSearchThreshold))
          .onChange(async (value) => {
            const threshold = Number(value);
            if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
              this.plugin.settings.inlineSearchThreshold = threshold;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(inlineSearchSettingsEl)
      .setName('Show inline preview')
      .setDesc('Show a compact note preview next to the inline search menu.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.inlineSearchShowPreview).onChange(async (value) => {
          this.plugin.settings.inlineSearchShowPreview = value;
          await this.plugin.saveSettings();
        }),
      );

    inlineSearchSettingsEl.hidden = !this.plugin.settings.inlineSearchEnabled;

    const similarEl = this.addSection(containerEl, 'Similar notes', 'git-compare');

    new Setting(similarEl)
      .setName('Show similar notes at bottom')
      .setDesc('Display similar notes above embedded backlinks in rendered notes.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showSimilarNotesAtBottom).onChange(async (value) => {
          this.plugin.settings.showSimilarNotesAtBottom = value;
          await this.plugin.saveSettings();
          this.plugin.onSimilarNotesSettingsChanged?.();
          similarNotesSettingsEl.hidden = !value;
        }),
      );

    const similarNotesSettingsEl = similarEl.createDiv();

    new Setting(similarNotesSettingsEl)
      .setName('Similar notes limit')
      .setDesc('Maximum number of similar notes shown at the bottom of a note.')
      .addText((text) =>
        text
          .setPlaceholder('5')
          .setValue(String(this.plugin.settings.similarNotesBottomLimit))
          .onChange(async (value) => {
            const limit = Number(value);
            if (Number.isInteger(limit) && limit >= 1 && limit <= 20) {
              this.plugin.settings.similarNotesBottomLimit = limit;
              await this.plugin.saveSettings();
              this.plugin.onSimilarNotesSettingsChanged?.();
            }
          }),
      );

    new Setting(similarNotesSettingsEl)
      .setName('Minimum similarity')
      .setDesc('Hide semantic results below this score. Use 0 to keep every result.')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.similarNotesThreshold))
          .onChange(async (value) => {
            const threshold = Number(value);
            if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
              this.plugin.settings.similarNotesThreshold = threshold;
              await this.plugin.saveSettings();
              this.plugin.onSimilarNotesSettingsChanged?.();
            }
          }),
      );

    similarNotesSettingsEl.hidden = !this.plugin.settings.showSimilarNotesAtBottom;

    statusSection.renderDiagnostics(this.addSection(containerEl, 'Diagnostics', 'stethoscope'));
    void statusSection.refresh();
  }

  /** Settings tabs are re-rendered on every open, so a pending status request from a
   *  previous open must not paint into the detached tree it captured. */
  hide(): void {
    // Flush rather than clear: the key is only written inside applyApiKey, so
    // cancelling a pending edit would silently discard what the user just typed.
    if (this.apiKeyApplyTimer !== 0) {
      window.clearTimeout(this.apiKeyApplyTimer);
      this.apiKeyApplyTimer = 0;
      this.pendingApiKey?.();
      this.pendingApiKey = null;
    }
    this.statusSection?.dispose();
    this.statusSection = null;
  }

  /**
   * A collapsible card holding one group of settings, collapsed by default so the
   * whole tab can be scanned at a glance. Returns the body to render into.
   */
  private addSection(
    containerEl: HTMLElement,
    title: string,
    icon: string,
    opts: { hidden?: boolean; open?: boolean } = {},
  ): HTMLElement {
    const section = containerEl.createDiv({ cls: 'hybrid-search-section' });
    section.hidden = opts.hidden ?? false;
    if (opts.open) section.addClass('is-open');

    const header = section.createDiv({ cls: 'hybrid-search-section__header' });
    setIcon(header.createDiv({ cls: 'hybrid-search-section__icon' }), icon);
    header.createSpan({ cls: 'hybrid-search-section__label', text: title });
    setIcon(header.createDiv({ cls: 'hybrid-search-section__chevron' }), 'chevron-right');

    // One inner wrapper, because the collapse animates a single grid row.
    const body = section.createDiv({ cls: 'hybrid-search-section__body' });
    const inner = body.createDiv({ cls: 'hybrid-search-section__inner' });
    header.addEventListener('click', () => {
      section.classList.toggle('is-open');
    });
    return inner;
  }

  /** Where the last report came from, which under HTTP may be the fallback server. */
  private endpointLabel(): string {
    const { settings, client } = this.plugin;
    if (settings.transport !== 'http') {
      return settings.binaryPath || 'obsidian-hybrid-search';
    }
    if (client && 'activeEndpointLabel' in client) {
      return client.activeEndpointLabel();
    }
    return `${settings.httpHost}:${String(settings.httpPort)}`;
  }

  /** Key field backed by the Obsidian keychain. Nothing about it reaches `data.json`. */
  private renderApiKeySetting(container: HTMLElement): void {
    const setting = new Setting(container).setName('Embedding API key');

    if (!isSecretStorageAvailable(this.app)) {
      setting.setDesc(API_KEY_UNSUPPORTED_DESC);
      return;
    }

    setting.setDesc(API_KEY_DESC);

    // Shown only once the key actually changes, so the row stays quiet until it matters.
    const appliedHint = setting.descEl.createDiv({
      cls: 'hybrid-search-setting-alert',
      text: 'Search server restarted with the new key.',
    });
    appliedHint.hidden = true;

    // eslint-disable-next-line obsidianmd/no-unsupported-api -- guarded by isSecretStorageAvailable
    const secret = new SecretComponent(this.app, setting.controlEl);
    // eslint-disable-next-line obsidianmd/no-unsupported-api -- guarded by isSecretStorageAvailable
    secret.setValue(getApiKey(this.app)).onChange((value) => {
      // onChange fires per keystroke, and applying the key restarts the server
      // process. Without this delay, pasting a key would restart it once per character.
      window.clearTimeout(this.apiKeyApplyTimer);
      this.pendingApiKey = () => {
        this.applyApiKey(value, appliedHint);
      };
      this.apiKeyApplyTimer = window.setTimeout(() => {
        this.apiKeyApplyTimer = 0;
        this.pendingApiKey = null;
        this.applyApiKey(value, appliedHint);
      }, API_KEY_APPLY_DELAY_MS);
    });
  }

  private applyApiKey(value: string, appliedHint: HTMLElement): void {
    try {
      setApiKey(this.app, value);
    } catch (err) {
      new Notice(`Could not save the API key: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // The cli reads its environment once at spawn, so a running process would
    // otherwise keep using the previous key.
    void Promise.resolve(this.plugin.restartClient?.()).then(() => {
      // The settings tab may already be gone when a flush on hide() lands here.
      if (!appliedHint.isConnected) return;
      appliedHint.hidden = false;
      return this.statusSection?.refresh();
    });
  }
}

function renderCustomPostfixRow(
  container: HTMLElement,
  plugin: PluginRef,
  index: number,
  rerender: () => void,
): void {
  const postfix = plugin.settings.customPostfixes[index]!;

  const handleNameChange = async (value: string): Promise<void> => {
    const normalized = normalizePostfixName(value);
    if (normalized && isReservedPostfixName(normalized)) {
      new Notice(`"@${normalized}" is a built-in postfix and can't be reused.`);
      return;
    }
    if (
      normalized &&
      plugin.settings.customPostfixes.some(
        (p, i) => i !== index && normalizePostfixName(p.name) === normalized,
      )
    ) {
      new Notice(`"@${normalized}" is already used by another postfix.`);
      return;
    }
    plugin.settings.customPostfixes[index]!.name = value;
    await plugin.saveSettings();
  };

  const handleFiltersChange = async (value: string): Promise<void> => {
    plugin.settings.customPostfixes[index]!.filters = value;
    await plugin.saveSettings();
  };

  const handleRemove = async (): Promise<void> => {
    plugin.settings.customPostfixes.splice(index, 1);
    await plugin.saveSettings();
    rerender();
  };

  new Setting(container)
    .addText((text) =>
      text.setPlaceholder('Work').setValue(postfix.name).onChange(handleNameChange),
    )
    .addText((text) =>
      text
        .setPlaceholder('-tag:personal folder:work')
        .setValue(postfix.filters)
        .onChange(handleFiltersChange),
    )
    .addExtraButton((btn) => btn.setIcon('trash').setTooltip('Remove').onClick(handleRemove));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
