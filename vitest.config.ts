import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    alias: {
      obsidian: new URL('./__mocks__/obsidian.ts', import.meta.url).pathname,
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Start at 0; raise thresholds as tests are added
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
      },
    },
  },
});
