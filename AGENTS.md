# Hybrid Search Obsidian plugin

This checkout contains the desktop Obsidian plugin. The CLI, index, embedding
providers, and shared AI infrastructure belong to the parent repository.

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for module ownership and lifetime rules.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, native testing, and releases.
- Use the inherited parent instructions and existing `.agents`, `.claude`, and
  `.codex` links. Do not copy or rebuild that infrastructure here.
- Use the pnpm version pinned in `package.json`. Commit `pnpm-lock.yaml`; do not
  create npm or Yarn lockfiles. Supported Node versions are in `engines`.
- Run `pnpm verify:task` while working and `pnpm verify` before handoff or push.
- Keep `src/main.ts` focused on composition and lifecycle. UI depends on search
  contracts, never on concrete transports or the plugin entry point. Architecture
  checks include type-only imports.
- Use Obsidian APIs and lifecycle cleanup. Guard asynchronous publication after
  close, cancellation, note changes, and client replacement. Keep unchanged UI
  intact during background refreshes.
- Preserve released command IDs, settings keys, search payloads, manifest ID,
  and minimum host compatibility unless a change is explicitly requested.
- Use `obsidian-test-mocks` and the narrow adapters in `test/support` and
  `test/setup.ts`. Add behavioral regressions for fixes; do not recreate a host
  framework mock.
- Keep network use explicit and documented. Never log secrets or note contents,
  add telemetry, or execute downloaded code. Scope note access to the vault.
- Do not commit `main.js`, dependencies, coverage, vault data, or local plans.
  Keep plans in ignored `docs/superpowers/`; never force-add that directory.
- A development task does not authorize a release. Versioning creates a commit
  and tag and pushes them; follow CONTRIBUTING only when release is requested.
