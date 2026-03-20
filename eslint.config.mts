import eslint from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
// eslint-plugin-obsidianmd targets eslint v9; @eslint/js v9 is pinned to match

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      // Obsidian plugins run in Electron — both browser and Node.js globals available
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', '*.mts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',
      'sonarjs/cognitive-complexity': ['error', 30],
      // Redundant with @typescript-eslint/no-unused-vars
      'sonarjs/no-unused-vars': 'off',
      // MCP/Obsidian deprecations are out of scope to address
      'sonarjs/deprecation': 'off',
    },
  },
  {
    // Relax type-unsafe rules in test files — vi matchers (expect.objectContaining etc.) return any
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'main.js', 'esbuild.config.mjs', 'version-bump.mjs'],
  },
);
