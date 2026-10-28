import type { App, SecretStorage } from 'obsidian';

/** Fixed SecretStorage entry used by the broken 0.9.0–0.9.1 implementation. */
const LEGACY_API_KEY_SECRET_ID = 'obsidian-hybrid-search-openai-api-key';

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

/** Resolve an embedding provider secret, or return an empty string when unavailable. */
export function getApiKey(app: App, secretId: string): string {
  if (!secretId) return '';
  try {
    return secretStorage(app)?.getSecret(secretId)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function getLegacyApiKeySecretId(app: App): string {
  try {
    const storage = secretStorage(app);
    const secretId = storage?.getSecret(LEGACY_API_KEY_SECRET_ID)?.trim() ?? '';
    return secretId &&
      secretId !== LEGACY_API_KEY_SECRET_ID &&
      storage?.listSecrets().includes(secretId)
      ? secretId
      : '';
  } catch {
    return '';
  }
}
