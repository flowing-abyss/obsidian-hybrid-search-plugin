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
      // Obsidian plugins run in a browser context (Electron)
      globals: globals.browser,
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
    ignores: ['dist/', 'node_modules/', 'main.js', 'esbuild.config.mjs', 'version-bump.mjs'],
  },
);
