import eslint from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
// eslint-plugin-obsidianmd requires @eslint/js ^9.30.1, so eslint v10 is blocked

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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    // test/setup.ts bootstraps Obsidian DOM globals — it must use raw document.createElement
    // before those globals exist. Disable the rules that auto-replace it with Obsidian helpers.
    files: ['test/setup.ts'],
    rules: {
      'obsidianmd/prefer-active-doc': 'off',
      'obsidianmd/prefer-create-el': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'main.js', 'esbuild.config.mjs', 'version-bump.mjs'],
  },
);
