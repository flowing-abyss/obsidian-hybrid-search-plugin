# Hybrid Search

Fast hybrid search for Obsidian — combines BM25 full-text and semantic (vector) search over your vault.

The plugin is a thin UI layer that communicates with the [obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) CLI, which runs as a background process and handles indexing and search.

> **Desktop only.**

---

## Requirements

Install the CLI globally via npm:

```bash
npm install -g obsidian-hybrid-search
```

The CLI must be available in your `PATH` (or you can set a custom path in plugin settings).

---

## Installation

### Via BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. In BRAT settings, click **Add Beta Plugin** and enter this repository's URL.
3. Enable **Hybrid Search** in Obsidian's plugin list.

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/flowing-abyss/obsidian-hybrid-search/releases).
2. Copy them to `<your vault>/.obsidian/plugins/obsidian-hybrid-search/`.
3. Enable **Hybrid Search** in Obsidian's plugin list.

---

## Usage

Open the search modal with:

- **Ribbon icon** — click the search icon in the left sidebar.
- **Command palette** — run `Hybrid search: Open search`.

Type to search. Results appear as you type with a relevance score.

**Empty query behaviour:**

- If a note is open, shows semantically similar notes.
- If no note is open, shows recently opened files.

---

## Query Syntax

Filters can be combined freely.

| Syntax                | Example                        | Description                          |
| --------------------- | ------------------------------ | ------------------------------------ |
| _(plain text)_        | `zettelkasten`                 | Hybrid search (default mode)         |
| `hybrid:`             | `hybrid: memory`               | Force hybrid mode (BM25 + semantic)  |
| `semantic:` / `sem:`  | `sem: attention mechanism`     | Semantic (vector) only               |
| `fulltext:` / `full:` | `full: TODO`                   | Full-text (BM25) only                |
| `title:`              | `title: inbox`                 | Fuzzy title match                    |
| `tag:`                | `tag:project`                  | Filter by tag (include)              |
| `tag:-`               | `tag:-archive`                 | Filter by tag (exclude)              |
| `folder:`             | `folder:work`                  | Limit to a folder                    |
| `limit:N` / `@lim:N`  | `limit:20` / `@lim:20`         | Override result count                |
| `@rerank`             | `best practices @rerank`       | Re-rank results with a cross-encoder |
| `@threshold:N`        | `meeting notes @threshold:0.5` | Minimum score threshold              |

Multiple `tag:` and `folder:` filters can be combined in one query.

---

## Settings

| Setting                           | Description                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| **Binary path**                   | Path to the `obsidian-hybrid-search` binary. Leave empty to use `PATH`.              |
| **Default mode**                  | Search mode used when opening the modal (`hybrid`, `semantic`, `fulltext`, `title`). |
| **Show path and tags**            | Show folder path and tags below each result title.                                   |
| **Show note metadata in preview** | Show folder, aliases, tags, links, and backlinks in the preview panel.               |
| **Test connection**               | Verify the background server is running.                                             |

---

## License

MIT
