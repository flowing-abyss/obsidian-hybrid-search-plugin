/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-unlisted-dependencies',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg'] },
    },
    {
      name: 'no-unresolved-imports',
      severity: 'error',
      from: {}, // Obsidian supplies its runtime module; npm publishes declarations only.
      to: { couldNotResolve: true, pathNot: '^obsidian$' },
    },
    {
      name: 'search-and-settings-model-are-pure',
      severity: 'error',
      from: { path: '^src/(?:search/|settings/model[.]ts$)' },
      to: { pathNot: '^src/(?:search/|settings/model[.]ts$)' },
    },
    {
      name: 'ui-uses-ports',
      severity: 'error',
      from: { path: '^src/ui/' },
      to: { path: '^src/(?:transport/|ipc[.]ts$|main[.]ts$|commands[.]ts$)' },
    },
    {
      name: 'transport-has-no-presentation',
      severity: 'error',
      from: { path: '^src/transport/' },
      to: { path: '^src/(?:ui/|settings/|main[.]ts$|commands[.]ts$)' },
    },
    {
      name: 'graph-has-no-presentation',
      severity: 'error',
      from: { path: '^src/graph/' },
      to: { path: '^src/(?:ui/|transport/|main[.]ts$|commands[.]ts$)' },
    },
    {
      name: 'host-settings-only-use-model',
      severity: 'error',
      from: { path: '^src/settings/' },
      to: { path: '^src/(?:ui/|transport/|main[.]ts$|commands[.]ts$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
    enhancedResolveOptions: { conditionNames: ['types', 'import', 'node', 'default'] },
  },
};
