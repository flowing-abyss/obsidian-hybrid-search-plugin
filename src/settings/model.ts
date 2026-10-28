import {
  isReservedPostfixName,
  normalizePostfixName,
  type CustomPostfix,
} from '../search/queryParser';

export interface HybridSearchSettings {
  binaryPath: string;
  apiKeySecretId: string;
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
  showSimilarNotesInPagePreview: boolean;
  similarNotesPagePreviewLimit: number;
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
  apiKeySecretId: '',
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
  showSimilarNotesInPagePreview: false,
  similarNotesPagePreviewLimit: 5,
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
    apiKeySecretId:
      typeof settings.apiKeySecretId === 'string' ? settings.apiKeySecretId.trim() : '',
    defaultSearchFilters:
      typeof settings.defaultSearchFilters === 'string'
        ? settings.defaultSearchFilters
        : DEFAULT_SETTINGS.defaultSearchFilters,
    customPostfixes: normalizeCustomPostfixes(settings.customPostfixes),
    showSimilarNotesInPagePreview:
      typeof settings.showSimilarNotesInPagePreview === 'boolean'
        ? settings.showSimilarNotesInPagePreview
        : DEFAULT_SETTINGS.showSimilarNotesInPagePreview,
    similarNotesPagePreviewLimit: clampInteger(
      settings.similarNotesPagePreviewLimit,
      1,
      20,
      DEFAULT_SETTINGS.similarNotesPagePreviewLimit,
    ),
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
