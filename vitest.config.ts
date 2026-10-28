import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    // Preserve optional fields required by upstream mocks that proxy subclass instances.
    typescript: { removeClassFieldsWithoutInitializer: false },
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    passWithNoTests: false,
    environment: 'jsdom',
    alias: {
      obsidian: 'obsidian-test-mocks/obsidian',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Measured baseline: 76% lines, 73% functions, 61% branches, 72% statements.
      thresholds: {
        lines: 75,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
