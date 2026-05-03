# ingest

Interactive CLI for ingesting raw source files into an org-mode LLM wiki via `claude -p`. Supports standalone knowledge bases and git submodule knowledge bases with independent digestion.

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
ingest -a

# Ingest specific files directly (skips pending scan)
ingest raw/clips/article.org

# Scaffold a blank wiki (4 category files + raw/ + subs/)
ingest init
ingest init ./path/to/new-wiki

# Install/refresh pre-commit hook (in an existing org root)
ingest init

# Apply deterministic safe fixes to wiki files (no ingest)
ingest --fix

# Export a wiki page and its linked neighborhood as HTML
ingest export <id> [--depth N] [--backlinks] [--output PATH] [--open]
ingest export --list
```

## Full Flow

```
git pull --ff-only
  ↓
git submodule update --remote --init
  ↓
Scan raw/ + subs/ vs .ingest-lock.json → find new + updated files
  ↓
Interactive checkbox (skipped with --all or explicit paths)
  ↓
Group files by submodule
  ↓
For each group: claude -p --model sonnet session
  • Main-repo files → writes to root wiki files
  • Submodule files → writes to that submodule's wiki files (cwd = submodule root)
  ↓
Write lock entries to .ingest-lock.json (one per file)
  ↓
Commit submodules first (wiki files inside each submodule) + push
  ↓
Commit main repo (wiki files + lock + submodule pointers)
  ↓
git push
```

## Submodule Knowledge Bases

Git submodules under `subs/` are treated as independent knowledge bases. Each submodule has its own `entities.org`, `concepts.org`, `sources.org`, `analyses.org`, and `raw/`.

When ingest finds source files inside a submodule, it:

1. Invokes Claude with the submodule root as working directory
2. Claude writes wiki pages to the submodule's own category files
3. Commits inside the submodule, then pushes
4. Main repo commits the submodule pointer update + lock

Submodule wiki files at the root level (`entities.org`, etc.) are skipped during scanning — they are wiki output, not source material.

## Scaffolding

`ingest init [path]` creates a blank wiki template:

```
entities.org
concepts.org
sources.org
analyses.org
raw/
  example-ingest-readme.md
subs/
```

If the target directory is a git repository, the pre-commit hook is also installed.

## Pending File Detection

A file is considered pending if:

- Its path is **not in** `.ingest-lock.json` → status `new`
- Its path is in the lock but its **SHA-256 hash changed** → status `updated`

Files with a matching hash in the lock are skipped. Supported extensions: `.org`, `.md`, `.txt`, `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`.

Office files (doc/docx/ppt/pptx/xls/xlsx) are pre-converted to PDF before Claude processes them.

## What Claude Does

Claude runs as a single `claude -p --model sonnet` session with all selected files. Its instructions are embedded in the CLI — it does not read `CLAUDE.md`.

For each source file, Claude:

1. Reads the file (chunked if > 200 KB)
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
| `Read` | Read source files and wiki files |
| `Edit` | Write to wiki files |
| `Bash(date *)` | Generate `YYYYMMDDTHHMMSS` IDs |
| `Bash(grep *)` | Search for existing headings |
| `Bash(git status)` | Check repo state |
| `Bash(git log *)` | Read recent commit history |

## Pre-commit Hook

The hook (installed via `ingest init`) validates staged wiki category files:

- Every top-level heading has a tag, `:ID:`, and `:DATE:`
- Tag matches the file (`entities.org` → `:entity:`, etc.)
- All `[[id:...]]` links resolve to existing `:ID:` values
- No duplicate `:ID:` across category files
- `:PROPERTIES:` / `:END:` drawers are balanced

If a commit is rejected, ingest retries with two fix stages: deterministic safe fixes, then an LLM fix pass.

## Org Root Detection

The CLI walks up from the current directory looking for a folder that contains both `raw/` and `CLAUDE.md`. Run from anywhere inside your org repo.

## Requirements

- Node >= 20
- `claude` CLI in PATH — install via `npm install -g @anthropic-ai/claude-code`
- An org repo with `raw/` directory, `CLAUDE.md`, and `.ingest-lock.json` at the root
  (`.ingest-lock.json` is created automatically on first run if missing)

## License

MIT
