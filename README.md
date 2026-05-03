# ingest

Interactive CLI for ingesting raw source files into an org-mode LLM wiki via `claude -p`. Supports standalone knowledge bases and git submodule knowledge bases with independent digestion.

## Knowledge Base Structure

An ingest knowledge base is a git repository with this layout:

```
my-wiki/
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
├── subs/                 ← Git submodule knowledge bases
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

- **:ID:** — Timestamp identifier (`YYYYMMDDTHHMMSS`), unique across all files
- **:DATE:** — Creation date in `[YYYY-MM-DD]` format
- **:SOURCES:** — Path to the raw source file that contributed this page
- **Tag** — One of `:entity:`, `:concept:`, `:source:`, `:analysis:`, must match the file
- **Cross-references** — Bidirectional `[[id:...][Title]]` links between pages

**Source files** under `raw/` are immutable — ingest never modifies them. They use [Denote naming](https://protesilaos.com/emacs/denote): `{YYYYMMDDTHHMMSS}--{title}__{tags}.ext`.

**Submodule knowledge bases** under `subs/` are fully independent: own category files, own raw/, own git history. Useful for team/project wikis with different access permissions.

## Install

```bash
npm install -g ingest
```

Or link locally for development:

```bash
cd ~/Developer/zzzhizhia/ingest
pnpm link --global
```

## Usage

```bash
# Interactive checkbox — select which pending files to ingest
ingest

# Ingest all pending files without prompting
ingest --all

# Ingest specific files directly (skips pending scan)
ingest raw/clips/article.org

# Show pending files, submodule grouping, and config
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

# Export a wiki page and its linked neighborhood as HTML
ingest export <id> [--depth N] [--backlinks] [--output PATH] [--open]
ingest export --list
```

## Options

| Option | Description |
|--------|-------------|
| `-a`, `--all` | Ingest all pending files without prompting |
| `--verbose` | Stream Claude output in real-time (default: spinner with elapsed time) |
| `--depth N` | BFS hops for export (default 1) |
| `--backlinks` | Include reverse links during BFS for export |
| `--output P` | Output HTML path for export |
| `--output-root D` | Directory for export with auto Denote-style filename |
| `--open` | Open exported HTML in browser |
| `--fix` | Apply safe auto-fixes (used with `lint`) |

## Full Flow

```
git pull --ff-only (auto stash/pop)
  ↓
git submodule update --remote --init
  ↓
Scan raw/ + subs/ vs ingest-lock.json → find new + updated files
  ↓
Pre-convert: Office → PDF (LibreOffice), audio → text (Whisper)
  ↓
Interactive checkbox (skipped with --all or explicit paths)
  ↓
Group files by submodule
  ↓
Claude sessions (main repo sequential, submodules parallel)
  ↓
Write lock entries to ingest-lock.json (batch)
  ↓
Commit submodules first + push
  ↓
Commit main repo (wiki files + lock + submodule pointers) + push
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
  }
}
```

All fields are optional. Missing fields use the defaults shown above. `ingest init` generates a starter config with model and effort.

## Supported File Types

| Type | Extensions | Processing |
|------|-----------|------------|
| Text | `.org`, `.md`, `.txt` | Direct read |
| PDF | `.pdf` | Direct read |
| Office | `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx` | Pre-converted to PDF via LibreOffice |
| Image | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | Direct read via Claude vision |
| Audio | `.m4a`, `.mp3`, `.wav`, `.ogg` | Pre-transcribed via Whisper |

## Submodule Knowledge Bases

Git submodules under `subs/` are treated as independent knowledge bases. Each submodule has its own `entities.org`, `concepts.org`, `sources.org`, `analyses.org`, and `raw/`.

When ingest finds source files inside a submodule, it:

1. Invokes Claude with the submodule root as working directory
2. Claude writes wiki pages to the submodule's own category files
3. Commits inside the submodule, then pushes
4. Main repo commits the submodule pointer update + lock

Submodule Claude sessions run in parallel. Submodule wiki files at the root level are skipped during scanning.

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

## What Claude Does

Claude runs as `claude -p` with model and effort from `ingest.json`. Its instructions are embedded in the CLI — it does not read `CLAUDE.md`.

For each source file, Claude:

1. Reads the file (images via vision, audio via pre-transcription, Office via pre-conversion)
2. Checks for existing wiki pages (`grep SOURCES:` in wiki files)
3. Extracts entities, concepts, and key arguments with section-level attribution
4. Matches existing headings (fuzzy) or appends new ones
5. Writes pages following the org-mode wiki template, with source citations and confidence levels (`HIGH` / `MED` / `LOW`)
6. Flags contradictions between new content and existing wiki pages

After all files are processed, Claude appends an entry to `summary.org` log (main repo only; submodules skip this).

Claude is **not** responsible for git commits or lock updates — the CLI handles both.

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

## Requirements

- Node >= 20
- `claude` CLI in PATH
- LibreOffice (optional, for Office file conversion)
- Whisper (optional, for audio transcription)
- glow (optional, for rendered query output)

## License

MIT
