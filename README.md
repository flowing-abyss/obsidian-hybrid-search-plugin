# Hybrid Search

[![Available in Obsidian](https://img.shields.io/badge/Available%20in%20Obsidian-7C3AED?logo=obsidian&logoColor=white&style=flat-square)](https://obsidian.md/plugins?id=hybrid-search)
[![Release](https://github.com/flowing-abyss/obsidian-hybrid-search-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/flowing-abyss/obsidian-hybrid-search-plugin/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/flowing-abyss/obsidian-hybrid-search-plugin/total?style=flat-square&label=downloads&color=blue)](https://github.com/flowing-abyss/obsidian-hybrid-search-plugin/releases)

Fast hybrid search for Obsidian — combines BM25 full-text and semantic (vector) search over your vault.

The plugin is a thin UI layer that communicates with the [obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) CLI, which runs as a background process and handles indexing and search.

> **Desktop only.**

![Search modal with results, preview and local graph](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/modal.png)

## Requirements

Install the CLI globally via npm:

```bash
npm install -g obsidian-hybrid-search
```

The CLI must be available in your `PATH` (or you can set a custom path in plugin settings).

## Installation

### Via Obsidian Community Plugins

Open the [Hybrid Search](https://community.obsidian.md/plugins/hybrid-search) page and click **Add to Obsidian**.

### Via BRAT

1. Install the [BRAT](https://community.obsidian.md/plugins/obsidian42-brat) plugin.
2. In BRAT settings, click **Add Beta Plugin** and enter this repository's URL.
   - `https://github.com/flowing-abyss/obsidian-hybrid-search-plugin`
3. Enable **Hybrid Search** in Obsidian's plugin list.

## Usage

Open the search modal with:

- **Ribbon icon** — click the search icon in the left sidebar.
- **Command palette** — run `Hybrid search: Open search`.

Type to search. Results appear as you type with a relevance score:

<details>
<summary>📷 Hybrid search results with relevance scores</summary>

![Hybrid search results with relevance scores](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/search.png)

</details>

| Score   | Color  | Meaning          |
| ------- | ------ | ---------------- |
| >0.8    | Green  | High relevance   |
| 0.5–0.8 | Orange | Medium relevance |
| <0.5    | Gray   | Low relevance    |

### Empty query & similar notes

Leave the query empty and the plugin shows contextually relevant results:

- If a note is open, it surfaces **semantically similar notes**.
- If no note is open, it shows recently opened files.

<details>
<summary>📷 Semantically similar notes</summary>

![Semantically similar notes](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/similar.png)

</details>

### Workbench

The plugin includes a **link-discovery workbench** that analyzes your vault's knowledge graph to surface the most actionable connections for the current note. It runs several graph algorithms side by side:

- **Best** — top candidates ranked by a composite of structural and semantic signals.
- **Missing Links** — notes that are strongly related but not yet linked.
- **Bridges** — notes that connect otherwise distant parts of your graph.
- **Similar** — semantically close notes.
- **Links** — existing outgoing and incoming links.
- **Diagnostics** — structural insights about the note's position in the graph.

Each candidate exposes interpretable scores — **cosine**, **Adamic-Adar**, **common** neighbors, **co-citation** count, **semantic** distance, and more — so you can decide whether a suggested link makes sense. You can add links, inspect backlinks, or compare notes directly from the list, while a live **local graph** visualizes the neighborhood around the current file.

<details>
<summary>📷 Link-discovery workbench</summary>

![Link-discovery workbench with local graph and scored candidates](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/workbench.png)

</details>

## Query Syntax

These two queries are equivalent:

```
hybrid: zettelkasten tag:project limit:20 @rerank
zettelkasten #project @limit:20 @rerank @hybrid
```

| Inline                | Postfix                  | Description                                 |
| --------------------- | ------------------------ | ------------------------------------------- |
| _(plain text)_        | —                        | Hybrid search (default)                     |
| `hybrid:`             | `@hybrid` / `@hyb`       | Hybrid mode (BM25 + semantic)               |
| `semantic:` / `sem:`  | `@semantic` / `@sem`     | Semantic (vector) only                      |
| `fulltext:` / `full:` | `@full`                  | Full-text (BM25) only                       |
| `title:`              | `@title`                 | Fuzzy title match                           |
| `tag:` / `tag:#tag`   | `#tag`                   | Filter by tag (include)                     |
| `-tag:` / `-tag:#tag` | `-#tag`                  | Filter by tag (exclude)                     |
| `folder:` / `path:`   | —                        | Limit to a folder (quote names with spaces) |
| `-folder:` / `-path:` | —                        | Exclude a folder                            |
| `limit:N`             | `@limit:N` / `@lim:N`    | Override result count                       |
| `threshold:N`         | `@threshold:N` / `@th:N` | Minimum score threshold                     |
| —                     | `@rerank`                | Re-rank with cross-encoder                  |
| `key:value`           | —                        | Filter by frontmatter field                 |
| `-key:value`          | —                        | Exclude by frontmatter field                |

Exclusion is a leading `-` before the operator, matching [Obsidian's own core search syntax](https://help.obsidian.md/plugins/search) (e.g. `-tag:#archive`, `-folder:Templates`). The `#` on tag values is optional — `tag:project` and `tag:#project` are equivalent. Filters can be combined freely.

In settings, you can also define your own `@name` shortcuts that expand to a filter string, e.g. `@work` → `-tag:personal folder:work`, and a **Default search filters** field applied to every search automatically.

## Hotkeys

| Hotkey            | Action                            |
| ----------------- | --------------------------------- |
| `Mod+J` / `Mod+K` | Next / previous result            |
| `Mod+P`           | Toggle preview panel              |
| `Mod+G`           | Toggle local graph panel          |
| `Mod+O`           | Open selected in new tab          |
| `Mod+Shift+O`     | Open all results in new tabs      |
| `Alt+Enter`       | Insert wiki link to selected note |
| `Alt+Shift+Enter` | Insert wiki links to all results  |

_`Mod` = `Ctrl` (Windows/Linux) or `Cmd` (macOS). `Alt` = `Option` on macOS._

## License

MIT
