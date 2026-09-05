import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { SecretStorage } from '../__mocks__/obsidian';
import * as secrets from '../src/secrets';

/** Obsidian 1.11.4 and newer. */
function appWithKeychain(): App {
  return { secretStorage: new SecretStorage() } as unknown as App;
}

/** Anything older, where `app.secretStorage` simply does not exist. */
function appWithoutKeychain(): App {
  return {} as unknown as App;
}

describe('secrets', () => {
  it('resolves the selected secret identifier to its stored api key', () => {
    const app = appWithKeychain();
    app.secretStorage.setSecret('ohs', 'sk-test');
    expect(secrets.getApiKey(app, 'ohs')).toBe('sk-test');
  });

  it('trims surrounding whitespace from the resolved key', () => {
    const app = appWithKeychain();
    app.secretStorage.setSecret('ohs', '  sk-test\n');
    expect(secrets.getApiKey(app, 'ohs')).toBe('sk-test');
  });

  it('returns an empty key when no secret is selected', () => {
    const app = appWithKeychain();
    expect(secrets.getApiKey(app, '')).toBe('');
  });

  it('returns an empty key when the selected secret does not exist', () => {
    const app = appWithKeychain();
    expect(secrets.getApiKey(app, 'missing')).toBe('');
  });

  it('detects whether the keychain is available', () => {
    expect(secrets.isSecretStorageAvailable(appWithKeychain())).toBe(true);
    expect(secrets.isSecretStorageAvailable(appWithoutKeychain())).toBe(false);
  });

  it('degrades to an empty key instead of throwing without a keychain', () => {
    const app = appWithoutKeychain();
    expect(secrets.getApiKey(app, 'ohs')).toBe('');
  });

  it('recognizes a legacy value only when it names an existing secret', () => {
    const app = appWithKeychain();
    app.secretStorage.setSecret('obsidian-hybrid-search-openai-api-key', 'ohs');
    app.secretStorage.setSecret('ohs', 'sk-test');

    expect(secrets.getLegacyApiKeySecretId(app)).toBe('ohs');
  });

  it('ignores a dangling legacy secret reference', () => {
    const app = appWithKeychain();
    app.secretStorage.setSecret('obsidian-hybrid-search-openai-api-key', 'missing');

    expect(secrets.getLegacyApiKeySecretId(app)).toBe('');
  });

  it('ignores a self-referencing legacy entry', () => {
    const app = appWithKeychain();
    app.secretStorage.setSecret(
      'obsidian-hybrid-search-openai-api-key',
      'obsidian-hybrid-search-openai-api-key',
    );

    expect(secrets.getLegacyApiKeySecretId(app)).toBe('');
  });

  it('does not migrate a legacy reference without secret storage', () => {
    expect(secrets.getLegacyApiKeySecretId(appWithoutKeychain())).toBe('');
  });

  it('degrades to empty values when secret reads fail', () => {
    const app = {
      secretStorage: {
        getSecret: () => {
          throw new Error('storage unavailable');
        },
        listSecrets: () => [],
      },
    } as unknown as App;

    expect(secrets.getApiKey(app, 'ohs')).toBe('');
    expect(secrets.getLegacyApiKeySecretId(app)).toBe('');
  });

  it('does not migrate when listing stored secret identifiers fails', () => {
    const app = {
      secretStorage: {
        getSecret: () => 'ohs',
        listSecrets: () => {
          throw new Error('storage unavailable');
        },
      },
    } as unknown as App;

    expect(secrets.getLegacyApiKeySecretId(app)).toBe('');
  });
});
