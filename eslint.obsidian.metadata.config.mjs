import json from '@eslint/json';
import depend from 'eslint-plugin-depend';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { PlainTextParser } from 'eslint-plugin-obsidianmd/dist/lib/plainTextParser.js';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'main.js', 'package-lock.json'],
    plugins: {
      depend,
      json,
      obsidianmd,
    },
  },
  {
    files: ['manifest.json'],
    language: 'json/json',
    rules: {
      ...json.configs.recommended.rules,
      'obsidianmd/validate-manifest': 'error',
    },
  },
  {
    files: ['package.json'],
    language: 'json/json',
    rules: {
      ...json.configs.recommended.rules,
      'depend/ban-dependencies': [
        'error',
        {
          presets: ['native', 'microutilities', 'preferred'],
        },
      ],
    },
  },
  {
    files: ['**/en.json', '**/en*.json', '**/en/*.json', '**/en/**/*.json'],
    language: 'json/json',
    rules: {
      ...json.configs.recommended.rules,
      'obsidianmd/ui/sentence-case-json': 'warn',
    },
  },
  {
    files: ['LICENSE'],
    languageOptions: {
      parser: PlainTextParser,
    },
    rules: {
      'obsidianmd/validate-license': 'error',
    },
  },
];
