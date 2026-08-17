import type { App, SecretStorage } from 'obsidian';

/** Keychain entry id. Must be lowercase alphanumeric with optional dashes. */
const API_KEY_SECRET_ID = 'obsidian-hybrid-search-openai-api-key';

/** `app.secretStorage` exists from Obsidian 1.11.4 onwards. `minAppVersion` stays at 1.4.0
 *  so the rest of the plugin keeps working on older builds, and every caller below goes
 *  through this check first. That runtime guard is what the disabled lint rule asks for,
 *  but the rule only compares against `minAppVersion` and cannot see it. */
function secretStorage(app: App): SecretStorage | null {
  const storage = (app as unknown as { secretStorage?: SecretStorage }).secretStorage;
  // eslint-disable-next-line obsidianmd/no-unsupported-api -- guarded by this very check
  return storage && typeof storage.getSecret === 'function' ? storage : null;
}

export function isSecretStorageAvailable(app: App): boolean {
  return secretStorage(app) !== null;
}

/** Embedding provider API key, or an empty string when unset or unsupported. */
export function getApiKey(app: App): string {
  try {
    // eslint-disable-next-line obsidianmd/no-unsupported-api -- guarded by isSecretStorageAvailable
    return secretStorage(app)?.getSecret(API_KEY_SECRET_ID) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(app: App, value: string): void {
  // eslint-disable-next-line obsidianmd/no-unsupported-api -- guarded by isSecretStorageAvailable
  secretStorage(app)?.setSecret(API_KEY_SECRET_ID, value.trim());
}
