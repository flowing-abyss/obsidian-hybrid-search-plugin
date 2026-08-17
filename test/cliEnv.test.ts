import { describe, expect, it } from 'vitest';
import { buildCliEnv } from '../src/ipc';

describe('buildCliEnv', () => {
  it('points the child at the vault it is meant to serve', () => {
    const env = buildCliEnv('/vaults/notes', '');
    expect(env.OBSIDIAN_VAULT_PATH).toBe('/vaults/notes');
  });

  it('passes the api key through when one is stored', () => {
    expect(buildCliEnv('/vaults/notes', 'sk-test').OPENAI_API_KEY).toBe('sk-test');
  });

  it('omits the key entirely when none is stored, rather than blanking it', () => {
    // An empty value would look like "configured but empty" to the CLI.
    expect('OPENAI_API_KEY' in buildCliEnv('/vaults/notes', '')).toBe(false);
  });

  it('augments PATH so the binary is found when Obsidian was not started from a shell', () => {
    const env = buildCliEnv('/vaults/notes', '');
    expect(env.PATH).toContain('/opt/homebrew/bin');
    expect(env.PATH).toContain('/usr/local/bin');
  });

  it('keeps the rest of the inherited environment', () => {
    process.env.HYBRID_SEARCH_TEST_MARKER = 'kept';
    try {
      expect(buildCliEnv('/vaults/notes', '').HYBRID_SEARCH_TEST_MARKER).toBe('kept');
    } finally {
      delete process.env.HYBRID_SEARCH_TEST_MARKER;
    }
  });
});
