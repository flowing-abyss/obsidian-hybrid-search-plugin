// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe.each(['eslint.config.mts', 'eslint.obsidian.config.mjs'])('%s timer checks', (config) => {
  const eslint = new ESLint({ overrideConfigFile: config });

  it.each(['src/transport/stdio.ts', 'src/ui/preview/SearchPreviewRenderer.ts'])(
    'rejects unqualified timers in %s and accepts window timers',
    async (filePath) => {
      const bare = await eslint.lintText(
        'const timer = setTimeout(() => {}, 10); clearTimeout(timer);',
        { filePath },
      );
      expect(
        bare[0]!.messages.filter((m) => m.ruleId === 'obsidianmd/prefer-window-timers'),
      ).toEqual([
        expect.objectContaining({ severity: 2, messageId: 'preferWindowTimer' }),
        expect.objectContaining({ severity: 2, messageId: 'preferWindowTimer' }),
      ]);

      const qualified = await eslint.lintText(
        'const timer = window.setTimeout(() => {}, 10); window.clearTimeout(timer);',
        { filePath },
      );
      expect(qualified[0]!.messages).toEqual([]);
    },
    // Loading the typed lint configuration can exceed 5s under coverage or on CI.
    15_000,
  );
});
