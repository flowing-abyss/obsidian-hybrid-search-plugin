import obsidianmd from 'eslint-plugin-obsidianmd';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'main.js', 'pnpm-lock.yaml'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    plugins: {
      sonarjs,
    },
  },
  ...obsidianmd.configs.recommendedWithLocalesEn,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This pass runs host rules only; Sonar suppressions are checked by the full lint pass.
    linterOptions: { reportUnusedDisableDirectives: false },
  },
  {
    rules: { 'obsidianmd/prefer-window-timers': 'error' },
  },
];
