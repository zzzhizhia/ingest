# ingest

Interactive CLI for ingesting raw source files into an org-mode LLM wiki via `claude -p`.

## Quick Start

```bash
npx ingest
```

Run from your org directory (or any subdirectory). Detects the repo root by looking for `raw/` and `CLAUDE.md`.

## Usage

```bash
# Interactive: shows checkbox of new/updated files, select to ingest
npx ingest

# Ingest a specific file directly (non-interactive)
npx ingest raw/clips/sspai/article.org
```

## What it does

1. Scans `raw/` for files not yet in `.ingest-lock.json`, or whose content changed since last ingest
2. Shows an interactive checkbox — select which files to process
3. For each selected file: runs `claude -p --permission-mode dontAsk` with the ingest prompt
4. On success: writes a lock entry to `.ingest-lock.json` and commits all wiki changes + lock in one git commit

Claude follows the CLAUDE.md ingest workflow (§ 3.1): reads the source, extracts entities/concepts, writes wiki pages, updates `summary.org`. The package handles the git commit.

## Requirements

- Node >= 20
- `claude` CLI in PATH (`npm install -g @anthropic-ai/claude-code`)
- `CLAUDE.md` and `raw/` directory in the org repo root

## License

MIT
