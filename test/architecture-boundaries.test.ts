// @vitest-environment node
import type { ICruiseResult } from 'dependency-cruiser';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = join(import.meta.dirname, '..');
async function violations(baseDir: string) {
  const result = spawnSync(
    process.execPath,
    [
      join(projectRoot, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
      '--config',
      join(projectRoot, 'dependency-cruiser.config.cjs'),
      '--output-type',
      'json',
      'src',
    ],
    { cwd: baseDir, encoding: 'utf8' },
  );
  if (!result.stdout) throw new Error(result.stderr || String(result.error));
  const report: ICruiseResult = JSON.parse(result.stdout);
  return report.summary.violations;
}

async function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'hybrid-boundaries-'));
  try {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    for (const [path, contents] of Object.entries(files)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, contents);
    }
    return await violations(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('module boundaries', () => {
  it('keeps production imports inside their owners', async () => {
    expect(await violations(process.cwd())).toEqual([]);
  });

  it.each([
    ['ui/panel.ts', 'transport/client.ts', 'ui-uses-ports'],
    ['ui/panel.ts', 'main.ts', 'ui-uses-ports'],
    ['search/contracts.ts', 'ui/panel.ts', 'search-and-settings-model-are-pure'],
    ['settings/model.ts', 'settings/secrets.ts', 'search-and-settings-model-are-pure'],
    ['transport/client.ts', 'ui/panel.ts', 'transport-has-no-presentation'],
    ['graph/analysis.ts', 'transport/client.ts', 'graph-has-no-presentation'],
  ])('rejects type-only %s → %s', async (from, to, rule) => {
    const relative = from.includes('/') ? '../' + to : './' + to;
    const result = await fixture({
      [`src/${from}`]: `import type { Contract } from '${relative.replace(/\.ts$/, '')}'; export type Consumer = Contract;`,
      [`src/${to}`]: 'export interface Contract { value: string }',
    });
    expect(result.map((violation) => violation.rule.name)).toContain(rule);
  });

  it('permits UI and transport to share a neutral contract', async () => {
    expect(
      await fixture({
        'src/search/contracts.ts': 'export interface Contract { value: string }',
        'src/ui/panel.ts':
          "import type { Contract } from '../search/contracts'; export type Panel = Contract;",
        'src/transport/client.ts':
          "import type { Contract } from '../search/contracts'; export type Client = Contract;",
      }),
    ).toEqual([]);
  });

  it('rejects cycles including type-only edges', async () => {
    const result = await fixture({
      'src/search/a.ts': "import type { B } from './b'; export interface A { b: B }",
      'src/search/b.ts': "import type { A } from './a'; export interface B { a: A }",
    });
    expect(result.map((violation) => violation.rule.name)).toContain('no-cycles');
  });
});
