import obsidianmd from 'eslint-plugin-obsidianmd';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'main.js', 'package-lock.json'],
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
];
