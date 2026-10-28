# Plugin architecture

Hybrid Search is a desktop Obsidian client for the `obsidian-hybrid-search` CLI.
Obsidian loads the esbuild bundle from `src/main.ts`. The plugin reads vault notes
for previews and graph context; indexing, retrieval, embeddings, and provider
configuration are implemented by the CLI in the parent repository.

## Module ownership

| Location                  | Responsibility                                                                                         | Dependencies                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `src/main.ts`             | Compose clients, views, managers, and host lifecycle                                                   | All application adapters                             |
| `src/commands.ts`         | Register stable command IDs                                                                            | UI capabilities and host command API                 |
| `src/search/`             | Search contracts, query parsing, similar-note fallback, anchors, note statistics, status normalization | Host-independent TypeScript                          |
| `src/settings/model.ts`   | Persisted settings, defaults, normalization                                                            | Search contracts and parsing                         |
| `src/settings/secrets.ts` | SecretStorage access and legacy secret lookup                                                          | Obsidian                                             |
| `src/transport/`          | STDIO process, HTTP MCP connection, CLI environment, transport errors                                  | Search contracts, Obsidian HTTP or Node process APIs |
| `src/graph/`              | Graph indexes, traversal, predictions, and statistics                                                  | Cached Obsidian metadata; no views or transports     |
| `src/ui/search/`          | Modal, persistent panel, inline suggestions, key handling                                              | Search port and settings model                       |
| `src/ui/graph/`           | Graph panel and graph workbench                                                                        | Graph algorithms and search port                     |
| `src/ui/similar/`         | Similar notes in Markdown views and native page previews                                               | Search policy and shared presentation                |
| `src/ui/preview/`         | Markdown preview rendering and placement                                                               | Obsidian rendering and shared presentation           |
| `src/ui/settings/`        | Settings controls and connection diagnostics                                                           | Settings model, secrets, and search port             |
| `src/ui/shared/`          | Links, panel ownership, cleanup, optional Supercharged Links integration                               | Obsidian host APIs                                   |

`SearchService` is the transport port. Its result and option shapes remain the
existing wire contract. Optional endpoint labels let the settings tab describe
HTTP failover without importing the HTTP client. `PluginContext` exposes only the
app, manifest ID, settings, current search service, and settings persistence.
Views cannot call plugin lifecycle methods through that interface.

`dependency-cruiser.config.cjs` checks inward imports, unresolved and undeclared
dependencies, and cycles, including dependencies erased by TypeScript. Executable
fixtures verify both allowed imports and rejected crossings. The `obsidian`
runtime is supplied by the host; its npm package contains declarations only.

## Lifetime and asynchronous work

The plugin owns one current client. Replacing or unloading it invalidates the
client generation before disposal, so old readiness failures and HTTP status
callbacks cannot notify the next instance.

The STDIO adapter owns pending responses and readiness timers. Process errors,
exit, close, and disposal settle that work once. Search errors retain the existing
empty-result behavior; readiness and status errors carry diagnostics. Writes after
termination are suppressed. HTTP retains its readiness, retry, session recovery,
and fallback behavior. The plugin never starts a second CLI for status queries.

Views and preview renderers use request generations and capture their search client.
Client replacement refreshes persistent views after readiness and closes old search
modals and page-preview attachments. Markdown renders into a detached request-owned
tree; stale completions unload their render child without touching the live preview. A completed read or request
may publish only while it still belongs to the current view and note. Graph
refreshes stage data before publication and compare a snapshot of results,
statistics, links, labels, and modification times. An unchanged snapshot retains
DOM nodes, expansion, and scroll. Changed background data replaces content without
showing another loading screen. Similar-note polling retains the last successful
view during a transient failure.

Body-level preview panels carry the plugin's manifest ID and use their owning
window's document. Cleanup removes only panels belonging to that instance.
Listeners and timers are released with their component. Optional integration with
Supercharged Links is isolated in shared UI helpers.

## Performance and remaining costs

Graph statistics count connections among neighbors by visiting their outgoing
edges, avoiding a copy of adjacency sets for every pair. Incoming and outgoing
traversals have separate visited state and share deduplicated edges. Keyboard
selection updates row classes without rebuilding results. Connection text fields
save immediately but defer restarting the client until typing pauses.

A forced graph refresh still rebuilds an index from cached vault metadata and
checks the graph snapshot. This is CPU and memory work, not a disk scan. A future
incremental graph index should be justified by measurements on larger vaults.
The graph workbench remains the largest view; its note statistics and graph
algorithms have separate owners, while its presentation stays together.

## What came from Task Calendar

The sibling `obsidian-task-calendar` provided useful patterns: a concise agent
entry document, separate architecture/contribution guides, pnpm's isolated
dependency layout and strict peers, upstream Obsidian mocks, executable module
boundaries, and common verification commands. These are adapted to this plugin's
smaller client architecture. Its task/calendar domain and AI tooling are not
copied. Shared AI instructions and skills continue to come from the parent.

## Compatibility and privacy

The manifest remains desktop-only with minimum Obsidian `1.11.4`. Current API types
also cover newer hosts; using them does not by itself raise the supported minimum.
The classic dynamic settings tab remains compatible with that minimum. Some
suggestion/hover integrations use guarded host internals and need native smoke
checks in addition to unit tests.

There is no telemetry. STDIO starts a configured local CLI; HTTP contacts the
configured primary and optional fallback server. The CLI may contact an embedding
provider according to its own configuration. Plugin settings store a secret ID,
not the secret value. No new network endpoints or data formats are introduced by
these structural changes.
