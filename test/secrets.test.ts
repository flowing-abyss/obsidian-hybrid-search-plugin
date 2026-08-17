import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { SecretStorage } from '../__mocks__/obsidian';
import { getApiKey, isSecretStorageAvailable, setApiKey } from '../src/secrets';

/** Obsidian 1.11.4 and newer. */
function appWithKeychain(): App {
  return { secretStorage: new SecretStorage() } as unknown as App;
}

/** Anything older, where `app.secretStorage` simply does not exist. */
function appWithoutKeychain(): App {
  return {} as unknown as App;
}

describe('secrets', () => {
  it('round-trips the key through the keychain', () => {
    const app = appWithKeychain();
    expect(getApiKey(app)).toBe('');
    setApiKey(app, 'sk-test');
    expect(getApiKey(app)).toBe('sk-test');
  });

  it('trims surrounding whitespace so a pasted key still authenticates', () => {
    const app = appWithKeychain();
    setApiKey(app, '  sk-test\n');
    expect(getApiKey(app)).toBe('sk-test');
  });

  it('detects whether the keychain is available', () => {
    expect(isSecretStorageAvailable(appWithKeychain())).toBe(true);
    expect(isSecretStorageAvailable(appWithoutKeychain())).toBe(false);
  });

  it('degrades to an empty key instead of throwing without a keychain', () => {
    const app = appWithoutKeychain();
    expect(getApiKey(app)).toBe('');
    expect(() => {
      setApiKey(app, 'sk-test');
    }).not.toThrow();
  });
});
