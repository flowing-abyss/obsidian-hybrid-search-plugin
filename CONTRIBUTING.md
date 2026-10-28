# Contributing

The plugin is a separate checkout inside `obsidian-hybrid-search`. Work in this
directory when changing the Obsidian interface. Backend work and shared AI tooling
belong to the parent repository; its existing instructions and skills are inherited.

## Setup

Use Node `22.22.3+` or `24.15.0+` within those major lines; Node `26+` is also accepted.
CI checks the two declared Node 22/24 minimums. Use the pnpm version pinned in
`package.json` (`12.15.0`).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` rebuilds on changes. `pnpm build` checks types and produces `main.js` at
the plugin root. The release bundle externalizes Obsidian and Node built-ins.
Tests and their mock package never belong in that bundle.

Dependency policy lives in `pnpm-workspace.yaml`: exact direct versions, isolated
links, strict peers and engines, a one-day minimum release age, and explicit
permission for dependency build scripts. Obsidian is a development type dependency.
The linter's obsolete Obsidian peer has one documented version exception; a Moment
override repairs its older nested type package. Do not relax global policies to
resolve an individual peer problem. Review changes to the manifest and lockfile
and run the complete gate after an update.

## Verification

```sh
pnpm verify:task  # lint, Obsidian metadata, types, architecture, unit tests
pnpm verify      # also formatting, coverage, unused code, build, full dependency audit
```

CI and the pre-push hook use `pnpm verify`. `pnpm review:local` remains an alias.
Individual commands include `pnpm test:unit`, `pnpm coverage`, `pnpm typecheck`,
`pnpm check:architecture`, `pnpm knip`, and `pnpm format`.

Use strict TypeScript and explicit module owners. See [ARCHITECTURE.md](ARCHITECTURE.md)
before adding imports. Prefer behavior tests for cancellation, stale requests,
transport termination, link resolution, and unchanged rendering. Performance tests
should count work or allocations rather than assert a machine-specific duration.

Tests resolve `obsidian` to `obsidian-test-mocks/obsidian`. Create host objects with
`test/support/obsidian.ts`; use configured files instead of inventing a `TFile`
constructor. `test/setup.ts` installs the package's DOM helpers. Its small documented
adapters cover jsdom scrolling and user-controlled modal lifetime. Use Obsidian's
global `createDiv`/`createEl` factories for detached test elements, just as in the host. Settings tests dispatch DOM events; only unsupported package components
receive local spies. Keep debounce timing real or advance fake timers explicitly.
Node transport tests use a fake child process and the actual transport implementation.

Coverage floors are 75% lines, 70% statements/functions, and 60% branches. These
are global regression floors, not a substitute for tests of changed behavior.
Do not lower them to make a change pass.

## Native Obsidian smoke test

Build first. Back up the installed plugin's `main.js`, `manifest.json`, and
`styles.css`, then copy those three files to
`<vault>/.obsidian/plugins/hybrid-search/` and reload the plugin. Preserve `data.json`
and all vault notes. Keep backups outside the vault and repository. Roll back the
three files and reload if the smoke test fails.

With the Obsidian CLI enabled, read-only checks can use:

```sh
obsidian vault="Obsidian" eval code="app.vault.getFiles().length"
obsidian vault="Obsidian" dev:dom selector=".hybrid-search-panel" text
obsidian vault="Obsidian" dev:dom selector=".hybrid-search-graph-workbench" text
obsidian vault="Obsidian" dev:screenshot path=/tmp/hybrid-search-smoke.png
```

Check normal search and mode switching, Escape while a request is pending, keyboard
navigation, preview links to headings/blocks, graph refreshes, similar-note panels,
settings persistence, and disable/re-enable cleanup. An unchanged background
refresh should not replace rows or reset expansion and scroll. Test popout windows
when changing DOM ownership or positioning. Unit tests do not verify Electron
layout or every host-internal suggestion hook.

## Releases

Only release when explicitly requested. Keep the manifest ID, released command IDs,
and settings keys stable. Keep `minAppVersion` accurate for APIs used at runtime.
Required assets are `main.js`, `manifest.json`, and `styles.css`.

```sh
pnpm release patch  # or minor / major
```

This wraps `pnpm version` with an empty tag prefix. The version lifecycle updates
`manifest.json` and `versions.json`; versioning creates a commit and a plain
`x.y.z` tag. The existing postversion hook pushes the commit and tags to `origin`.
The release workflow verifies and publishes the assets when that tag is pushed.
Do not run it for a routine refactor and do not create version tags manually.

Never commit generated bundles, installed dependencies, coverage, vault settings,
or agent plans. Plans belong in ignored `docs/superpowers/`.

## Upstream references

- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [Obsidian popout windows](https://docs.obsidian.md/plugins/guides/pop-out-windows)
- [Obsidian test mocks setup](https://mnaoumov.dev/obsidian-test-mocks/guides/test-runner-setup/)
- [pnpm settings](https://pnpm.io/settings)
- [dependency-cruiser rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
