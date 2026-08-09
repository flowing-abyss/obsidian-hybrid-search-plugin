# Hybrid Search

[![Available in Obsidian](https://img.shields.io/badge/Available%20in%20Obsidian-7C3AED?logo=obsidian&logoColor=white&style=flat-square)](https://obsidian.md/plugins?id=hybrid-search)
[![Release](https://github.com/flowing-abyss/obsidian-hybrid-search-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/flowing-abyss/obsidian-hybrid-search-plugin/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/flowing-abyss/obsidian-hybrid-search-plugin/total?style=flat-square&label=downloads&color=blue)](https://github.com/flowing-abyss/obsidian-hybrid-search-plugin/releases)

Hybrid Search combines BM25 full-text search with semantic vector search across your Obsidian vault.

The plugin provides the Obsidian interface. The [obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) CLI runs in the background and handles indexing and search.

Hybrid Search works with the desktop version of Obsidian.

![Search modal with results, preview and local graph](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/modal.png)

## Requirements

Install the CLI globally with npm.

```bash
npm install -g obsidian-hybrid-search
```

The CLI must be available in your `PATH`. You can also set a custom path in the plugin settings.

## Installation

Open [Hybrid Search](https://community.obsidian.md/plugins/hybrid-search) in the Obsidian Community plugins directory and select **Add to Obsidian**.

## Usage

Open the search window in either of these ways.

- Select the search icon in the left sidebar.
- Open the command palette and run `Hybrid search: Open search`.

Results update as you type and include a relevance score.

<details>
<summary>Hybrid search results with relevance scores</summary>

![Hybrid search results with relevance scores](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/search.png)

</details>

| Score      | Color  | Meaning          |
| ---------- | ------ | ---------------- |
| >0.8       | Green  | High relevance   |
| 0.5 to 0.8 | Orange | Medium relevance |
| <0.5       | Gray   | Low relevance    |

### Empty query and similar notes

Leave the query empty to see results based on the current context.

- If a note is open, the plugin shows semantically similar notes.
- If no note is open, it shows recently opened files.

<details>
<summary>Semantically similar notes</summary>

![Semantically similar notes](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/similar.png)

</details>

### Workbench

The link discovery workbench helps you find useful connections for the current note. It compares graph structure with semantic similarity.

- **Best** shows the top candidates based on structural and semantic signals.
- **Missing Links** shows related notes that are not linked yet.
- **Bridges** shows notes that connect distant parts of the graph.
- **Similar** shows semantically close notes.
- **Links** shows existing outgoing and incoming links.
- **Diagnostics** explains the note's position in the graph.

Each candidate includes scores for cosine similarity, Adamic-Adar, common neighbors, co-citation count, semantic distance, and other signals. You can add links, inspect backlinks, and compare notes from the list. The local graph shows the notes around the current file.

<details>
<summary>Link discovery workbench</summary>

![Link-discovery workbench with local graph and scored candidates](https://raw.githubusercontent.com/flowing-abyss/obsidian-hybrid-search-plugin/master/assets/workbench.png)

</details>

## Query syntax

These two queries are equivalent.

```
hybrid: zettelkasten tag:project limit:20 @rerank
```

```
zettelkasten #project @limit:20 @rerank @hybrid
```

| Inline                | Postfix                  | Description                                 |
| --------------------- | ------------------------ | ------------------------------------------- |
| _(plain text)_        | None                     | Hybrid search (default)                     |
| `hybrid:`             | `@hybrid` / `@hyb`       | Hybrid mode (BM25 + semantic)               |
| `semantic:` / `sem:`  | `@semantic` / `@sem`     | Semantic (vector) only                      |
| `fulltext:` / `full:` | `@full`                  | Full-text (BM25) only                       |
| `title:`              | `@title`                 | Fuzzy title match                           |
| None                  | `@sim` / `@similar`      | Notes similar to the active note            |
| None                  | `@sim:[[Note]]`          | Notes similar to a specific note            |
| None                  | `@sim:"path/note.md"`    | Same, by path                               |
| `tag:` / `tag:#tag`   | `#tag`                   | Filter by tag (include)                     |
| `-tag:` / `-tag:#tag` | `-#tag`                  | Filter by tag (exclude)                     |
| `folder:` / `path:`   | None                     | Limit to a folder (quote names with spaces) |
| `-folder:` / `-path:` | None                     | Exclude a folder                            |
| `limit:N`             | `@limit:N` / `@lim:N`    | Override result count                       |
| `threshold:N`         | `@threshold:N` / `@th:N` | Minimum score threshold                     |
| None                  | `@rerank`                | Rerank with a cross-encoder                 |
| `key:value`           | None                     | Filter by frontmatter field                 |
| `-key:value`          | None                     | Exclude by frontmatter field                |

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

`Mod` means `Ctrl` on Windows and Linux or `Cmd` on macOS. `Alt` means `Option` on macOS.

## License

MIT
