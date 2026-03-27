# Hybrid Search

Fast hybrid search for Obsidian — combines BM25 full-text and semantic (vector) search over your vault.

The plugin is a thin UI layer that communicates with the [obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) CLI, which runs as a background process and handles indexing and search.

> **Desktop only.**

## Requirements

Install the CLI globally via npm:

```bash
npm install -g obsidian-hybrid-search
```

The CLI must be available in your `PATH` (or you can set a custom path in plugin settings).

## Installation

### Via BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. In BRAT settings, click **Add Beta Plugin** and enter this repository's URL.
3. Enable **Hybrid Search** in Obsidian's plugin list.

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/flowing-abyss/obsidian-hybrid-search/releases).
2. Copy them to `<your vault>/.obsidian/plugins/obsidian-hybrid-search/`.
3. Enable **Hybrid Search** in Obsidian's plugin list.

## Usage

Open the search modal with:

- **Ribbon icon** — click the search icon in the left sidebar.
- **Command palette** — run `Hybrid search: Open search`.

Type to search. Results appear as you type with a relevance score:

| Score   | Color  | Meaning          |
| ------- | ------ | ---------------- |
| >0.8    | Green  | High relevance   |
| 0.5–0.8 | Orange | Medium relevance |
| <0.5    | Gray   | Low relevance    |

**Empty query behaviour:**

- If a note is open, shows semantically similar notes.
- If no note is open, shows recently opened files.

## Query Syntax

These two queries are equivalent:

```
hybrid: zettelkasten tag:project limit:20 @rerank
zettelkasten #project @limit:20 @rerank @hybrid
```

| Inline                | Postfix                  | Description                   |
| --------------------- | ------------------------ | ----------------------------- |
| _(plain text)_        | —                        | Hybrid search (default)       |
| `hybrid:`             | `@hybrid` / `@hyb`       | Hybrid mode (BM25 + semantic) |
| `semantic:` / `sem:`  | `@semantic` / `@sem`     | Semantic (vector) only        |
| `fulltext:` / `full:` | `@full`                  | Full-text (BM25) only         |
| `title:`              | `@title`                 | Fuzzy title match             |
| `tag:`                | `#tag`                   | Filter by tag (include)       |
| `tag:-`               | `-#tag`                  | Filter by tag (exclude)       |
| `folder:`             | —                        | Limit to a folder             |
| `limit:N`             | `@limit:N` / `@lim:N`    | Override result count         |
| `threshold:N`         | `@threshold:N` / `@th:N` | Minimum score threshold       |
| —                     | `@rerank`                | Re-rank with cross-encoder    |

Filters can be combined freely.

## Hotkeys

| Hotkey            | Action                            |
| ----------------- | --------------------------------- |
| `Mod+J` / `Mod+K` | Next / previous result            |
| `Mod+P`           | Toggle preview panel              |
| `Mod+O`           | Open selected in new tab          |
| `Mod+Shift+O`     | Open all results in new tabs      |
| `Alt+Enter`       | Insert wiki link to selected note |
| `Alt+Shift+Enter` | Insert wiki links to all results  |

_`Mod` = `Ctrl` (Windows/Linux) or `Cmd` (macOS). `Alt` = `Option` on macOS._

## License

MIT
