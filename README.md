# ingest

Interactive CLI for ingesting raw source files into an org-mode LLM wiki via `claude -p`.

## Quick Start

```bash
ingest         # interactive: pick files from a checkbox
ingest --all   # non-interactive: ingest all pending files
```

Run from your org directory (or any subdirectory). The repo root is detected by the presence of `raw/` and `CLAUDE.md`.

## Usage

```bash
# Interactive checkbox — select which pending files to ingest
ingest

# Ingest all pending files without prompting
ingest --all
ingest -a

# Ingest specific files directly
ingest raw/clips/sspai/article.org raw/repos/project/notes.md
```

## What it does

1. `git pull --ff-only`
2. Scans `raw/` and compares SHA-256 hashes against `.ingest-lock.json` — finds new and updated files
3. Shows an interactive checkbox to select which files to process (skipped with `--all`)
4. Runs a single `claude -p --model sonnet` session with all selected files — Claude reads each source, extracts entities/concepts, writes wiki pages, updates `summary.org` log
5. Writes lock entries to `.ingest-lock.json`
6. `git commit` with all changed wiki files + lock in one commit
7. `git push`

Claude's ingest instructions are embedded in the CLI — no dependency on `CLAUDE.md` content.

## Requirements

- Node >= 20
- `claude` CLI in PATH (`npm install -g @anthropic-ai/claude-code`)
- `raw/` directory and `CLAUDE.md` present in the org repo root (used for root detection)

## License

MIT
