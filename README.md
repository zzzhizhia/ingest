# ingest

Interactive CLI for ingesting raw source files into an org-mode LLM wiki via `claude -p`. Supports standalone knowledge bases and subwiki knowledge bases with independent digestion.

## Quick Start

```bash
# Install
npm install -g @zzzhizhia/ingest

# Scaffold a new wiki
ingest init ./wiki
cd wiki

# Drop a file into raw/ and ingest it
cp ~/notes/article.md raw/
ingest
```

Or run directly without installing:

```bash
npx @zzzhizhia/ingest init ./wiki
```

### Requirements

- Node >= 22.5 (uses `node:sqlite`)
- `claude` CLI in PATH ([install guide](https://docs.anthropic.com/en/docs/claude-code/overview))
- rg (ripgrep) for `ingest grep`
- LibreOffice (optional, for Office file conversion)
- glow (optional, for rendered query output)

Optional dependencies can be installed via Homebrew:

```bash
brew install ripgrep glow libreoffice
```

## Usage

```bash
# Interactive checkbox -- select which pending files to ingest
ingest

# Show detailed help for any subcommand
ingest <command> --help

# Ingest all pending files without prompting
ingest --all

# Ingest specific files directly (skips pending scan)
ingest raw/clips/article.org

# Show pending files, subwiki grouping, and config
ingest status

# Scaffold a blank wiki (+ pre-commit hook if git repo)
ingest init
ingest init ./path/to/new-wiki

# Remove a file from lock (makes it pending again for re-ingestion)
ingest forget raw/clips/article.org

# Validate wiki files (format, links, ID uniqueness)
ingest lint

# Validate + apply safe deterministic auto-fixes
ingest lint --fix

# Ask a question against the wiki via Claude
ingest query "What do we know about X?"

# Search wiki pages by title and print full org content
ingest grep "Alice"
ingest grep "^Claude$"

# Print a single wiki page by :ID:
ingest show 20260503T120000
ingest view 20260503T120000

# Export a wiki page and its linked neighborhood as HTML
ingest export <id> [--depth N] [--backlinks] [--semantic N] [--output PATH] [--open]
ingest export --list

# Vector semantic search / clustering (embeddings via API, stored locally in SQLite)
ingest vector index [--force]                 # index all wiki pages incrementally
ingest vector search "early AI investment cases"        # semantic search
ingest vector similar <id> [--limit N]         # pages similar to a wiki page
ingest vector cluster [--k N] [--output PATH]  # K-means clustering → clusters.org
ingest vector stats                            # index size and last indexed time

# List past ingest runs (state in $XDG_STATE_HOME/ingest/runs.json)
ingest history
ingest history --last 5
ingest history --status interrupted,completed
ingest history 01HXYZW...

# Resume the most recent interrupted run (reuses the original claude session)
ingest resume
ingest resume 01HXYZW...
```

## Options

| Option | Description |
|--------|-------------|
| `-a`, `--all` | Ingest all pending files without prompting |
| `--no-pull` | Skip git pull and subwiki sync before ingesting |
| `-V`, `--version` | Show version and exit |
| `--verbose` | Stream Claude output in real-time (default: spinner with elapsed time) |
| `--depth N` | BFS hops for export (default 1) |
| `--backlinks` | Include reverse links during BFS for export |
| `--semantic N` | Include top-N semantically similar pages in export (requires `ingest vector index`) |
| `--output P` | Output HTML path for export |
| `--output-root D` | Directory for export with auto Denote-style filename |
| `--open` | Open exported HTML in browser |
| `--fix` | Apply safe auto-fixes (used with `lint`) |
| `--last N` | Show only the last N runs (used with `history`) |
| `--status S` | Filter by status: `in-progress`, `completed`, `interrupted` (used with `history`) |

## Knowledge Base Structure

An ingest knowledge base is a git repository with this layout:

```
wiki/
├── entities.org          ← People, organizations, products, places
├── concepts.org          ← Ideas, theories, frameworks, methods
├── sources.org           ← One summary per ingested source file
├── analyses.org          ← Comparisons, syntheses, deep dives
├── summary.org           ← Dashboard + activity log (optional, main repo only)
├── raw/                  ← Immutable source material
│   ├── clips/            ←   Web clippings (.org, .md)
│   ├── books/            ←   Book notes
│   ├── papers/           ←   Academic papers (.pdf)
│   ├── plaud/            ←   Audio transcripts
│   └── assets/           ←   Images, diagrams
├── subs/                 ← Subwiki knowledge bases
│   ├── team-wiki/        ←   Each with its own entities/concepts/sources/analyses.org
│   └── project-wiki/
├── ingest-lock.json      ← Digestion state (path → content hash + timestamp)
├── ingest.json           ← CLI config (model, effort, allowedTools)
├── CLAUDE.md             ← Schema instructions for Claude
├── .gitignore
└── .gitattributes
```

**Category files** are org-mode files where each top-level heading is a wiki "page":

```org
* Claude Code                                                        :entity:
:PROPERTIES:
:ID:       20260503T120000
:DATE:     [2026-05-03]
:SOURCES:  raw/clips/20260503T115200--claude-code-announcement__dev.org
:END:

** Overview

Anthropic's CLI tool for AI-assisted software development.

** Content

Claude Code provides terminal-based access to Claude...
  [source: raw/clips/20260503T115200--claude-code-announcement__dev.org § Features | HIGH]

** Cross-references

- [[id:20260501T090000][Anthropic]] — developer
```

Key properties:

- **:ID:** -- Timestamp identifier (`YYYYMMDDTHHMMSS`), unique across all files
- **:DATE:** -- Creation date in `[YYYY-MM-DD]` format
- **:SOURCES:** -- Path to the raw source file that contributed this page
- **Tag** -- One of `:entity:`, `:concept:`, `:source:`, `:analysis:`, must match the file
- **Cross-references** -- Bidirectional `[[id:...][Title]]` links between pages

**Source files** under `raw/` are the canonical inputs for digestion. They use [Denote naming](https://protesilaos.com/emacs/denote): `{YYYYMMDDTHHMMSS}--{title}__{tags}.ext`.

**Subwiki knowledge bases** under `subs/` are fully independent: own category files, own raw/, own git history. Useful for team/project wikis with different access permissions.

## History & Resume

Every `ingest` run is recorded in `$XDG_STATE_HOME/ingest/runs.json` (machine-local, not version-controlled):

- `ingest history` — list all runs, most recent first
- `ingest history <id>` — show a run's session id, wiki, and timing
- `ingest history --last N` / `--status interrupted,completed` — narrow the list

If a run is interrupted (Ctrl+C, crash, network drop), `ingest resume` re-invokes Claude with `--resume <session-id> "continue"`. Claude's session already knows which sources it had been processing, which headings it had created, and which ones were still pending — so a one-word prompt is enough to pick up where it left off. The wiki does not need to be re-scanned and files are not re-listed.

`ingest resume` accepts an explicit run id; with no id it picks the most recent in-progress or interrupted run for the current wiki. The session id is only retained while Claude's own session log is alive (~30 days) — older runs fall back to a fresh `ingest` run.

## Full Flow

```
git pull --ff-only (auto stash/pop)
  ↓
git submodule update --remote --init
  ↓
Scan raw/ + subs/ vs ingest-lock.json → find new + updated files
  ↓
Pre-convert: Office → PDF (LibreOffice)
  ↓
Interactive checkbox (skipped with --all or explicit paths)
  ↓
Group files by subwiki
  ↓
Claude sessions (main repo sequential, subwikis parallel)
  ↓
Write lock entries to ingest-lock.json (batch)
  ↓
Commit subwikis first + push
  ↓
Commit main repo (wiki files + lock + subwiki pointers) + push
```

## Config

Place `ingest.json` at the org root to override defaults:

```json
{
  "model": "sonnet",
  "effort": "medium",
  "allowedTools": ["Read", "Edit", "Bash(date *)", "Bash(date)", "Bash(grep *)", "Bash(git status)", "Bash(git log *)"],
  "prompt": {
    "systemAppend": "Additional instructions appended to the system prompt",
    "userPrefix": "Text prepended to the user prompt"
  },
  "vector": {
    "provider": "dashscope",
    "model": "text-embedding-v4",
    "apiKey": "sk-...",
    "apiBase": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "dimensions": 1024,
    "dbPath": "~/.local/state/ingest/vector.db"
  }
}
```

All fields are optional. Missing fields use the defaults shown above. `ingest init` generates a starter config with model and effort.

### Vector config

The `vector` section controls semantic indexing, search, and clustering. Embeddings are computed via an OpenAI-compatible `/embeddings` API and stored in a local SQLite sidecar database (`dbPath`).

| Field | Default | Description |
|---|---|---|
| `provider` | `dashscope` | Provider key: `dashscope`, `openai`, `zeroentropyai`, or `ollama` |
| `model` | `text-embedding-v4` | Embedding model name |
| `apiKey` | env var | Provider API key. Falls back to `DASHSCOPE_API_KEY`, `OPENAI_API_KEY`, or `ZEROENTROPY_API_KEY` |
| `apiBase` | provider default | OpenAI-compatible base URL |
| `dimensions` | provider default | Output dimensions (DashScope v4 default: 1024) |
| `dbPath` | `~/.local/state/ingest/vector.db` | Local SQLite database for embeddings and clusters |

Example for OpenAI:

```json
{
  "vector": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "sk-...",
    "apiBase": "https://api.openai.com/v1",
    "dimensions": 1536
  }
}
```

Example for Ollama:

```json
{
  "vector": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "apiBase": "http://localhost:11434/v1",
    "dimensions": 768
  }
}
```

## Supported File Types

| Type | Extensions | Processing |
|------|-----------|------------|
| Text | `.org`, `.md`, `.txt` | Direct read |
| HTML | `.html` | Direct read |
| PDF | `.pdf` | Direct read |
| Office | `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx` | Pre-converted to PDF via LibreOffice |

## Subwiki Knowledge Bases

Subwikis under `subs/` are treated as independent knowledge bases. Each subwiki has its own `entities.org`, `concepts.org`, `sources.org`, `analyses.org`, and `raw/`.

When ingest finds source files inside a subwiki, it:

1. Invokes Claude with the subwiki root as working directory
2. Claude writes wiki pages to the subwiki's own category files
3. Commits inside the subwiki, then pushes
4. Main repo commits the subwiki pointer update + lock

Subwiki Claude sessions run in parallel. Subwiki wiki files at the root level are skipped during scanning.

## Scaffolding

`ingest init [path]` creates a blank wiki template:

```
entities.org
concepts.org
sources.org
analyses.org
ingest-lock.json
ingest.json
raw/
  example-ingest-readme.md
subs/
.gitignore
.gitattributes
CLAUDE.md
```

If the target directory is a git repository, the pre-commit hook is also installed.

## Wiki Validation

`ingest lint` checks all four category files:

- Every top-level heading has a tag, `:ID:`, and `:DATE:`
- Tag matches the file (`entities.org` → `:entity:`, etc.)
- `:ID:` format is `YYYYMMDDTHHMMSS`
- All `[[id:...]]` links resolve to existing `:ID:` values
- No duplicate `:ID:` across category files
- `:PROPERTIES:` / `:END:` drawers are balanced

`ingest lint --fix` applies safe deterministic fixes before reporting:

- Tag mismatch: replaces wrong tag with expected tag for the file
- Broken link with unique title match: replaces invalid ID with the correct one

The same validation runs as a pre-commit hook. If a commit is rejected during ingestion, the CLI retries with safe fixes first, then an LLM fix pass.

## Query

`ingest query "question"` invokes Claude in read-only mode against the wiki. Output is rendered with [glow](https://github.com/charmbracelet/glow) in interactive terminals, plain text when piped.

## Vector Search & Clustering

`ingest vector` adds page-level semantic search and clustering on top of the link-based wiki graph. It is useful for discovering cross-source associations that are not explicitly linked.

Workflow:

1. Configure a provider in `ingest.json` (default: DashScope `text-embedding-v4`)
2. `ingest vector index` — embed every wiki page once; incremental re-runs only update changed pages
3. `ingest vector search "question"` — find semantically similar pages
4. `ingest vector similar <id>` — pages closest to a given wiki page
5. `ingest vector cluster` — run K-means and write `clusters.org`
6. `ingest export <id> --semantic N` — augment link-based HTML export with N semantically similar pages

Embeddings are fetched via API but stored locally, so search/clustering is free after indexing.

## What Claude Does

Claude runs as `claude -p` with model and effort from `ingest.json`. Its instructions are embedded in the CLI -- it does not read `CLAUDE.md`.

For each source file, Claude:

1. Reads the file (Office files via pre-conversion to PDF)
2. Checks for existing wiki pages (`grep SOURCES:` in wiki files)
3. Extracts entities, concepts, and key arguments with section-level attribution
4. Matches existing headings (fuzzy) or appends new ones
5. Writes pages following the org-mode wiki template, with source citations and confidence levels (`HIGH` / `MED` / `LOW`)
6. Flags contradictions between new content and existing wiki pages

After all files are processed, Claude appends an entry to `summary.org` log (main repo only; subwikis skip this).

Claude is **not** responsible for git commits or lock updates -- the CLI handles both.

### Allowed Tools

| Tool | Purpose |
|------|---------|
| `Read` | Read source files, wiki files, and images |
| `Edit` | Write to wiki files |
| `Bash(date *)` | Generate `YYYYMMDDTHHMMSS` IDs |
| `Bash(grep *)` | Search for existing headings |
| `Bash(git status)` | Check repo state |
| `Bash(git log *)` | Read recent commit history |

Configurable via `allowedTools` in `ingest.json`.

## Org Root Detection

The CLI walks up from the current directory looking for `ingest-lock.json`. Run `ingest init` to scaffold a new wiki, or run from anywhere inside an existing one.

## License

MIT
