import type { App, SecretStorage } from 'obsidian';

/** Keychain entry id. Must be lowercase alphanumeric with optional dashes. */
const API_KEY_SECRET_ID = 'obsidian-hybrid-search-openai-api-key';

/** `app.secretStorage` exists from Obsidian 1.11.4 onwards, which is what `minAppVersion`
 *  now requires. The runtime check stays anyway: it costs nothing and keeps the accessor
 *  honest if the field is ever missing on a build that claims to support it. */
function secretStorage(app: App): SecretStorage | null {
  const storage = app.secretStorage as SecretStorage | undefined;
  return typeof storage?.getSecret === 'function' ? storage : null;
}

export function isSecretStorageAvailable(app: App): boolean {
  return secretStorage(app) !== null;
}

/** Embedding provider API key, or an empty string when unset or unsupported. */
export function getApiKey(app: App): string {
  try {
    return secretStorage(app)?.getSecret(API_KEY_SECRET_ID) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(app: App, value: string): void {
  secretStorage(app)?.setSecret(API_KEY_SECRET_ID, value.trim());
}
