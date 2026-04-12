# ingest

Interactive CLI for ingesting raw source files into an org-mode LLM wiki via `claude -p`.

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
ingest raw/clips/sspai/article.org
ingest raw/clips/foo.org raw/repos/bar/notes.md
```

## Full Flow

```
git pull --ff-only
  ↓
Scan raw/ vs .ingest-lock.json → find new + updated files
  ↓
Interactive checkbox (skipped with --all or explicit paths)
  ↓
Single claude -p --model sonnet session
  • Reads each source file
  • Extracts entities, concepts, key arguments
  • Writes/updates pages in entities.org, concepts.org, sources.org, analyses.org
  • Appends ingest entry to summary.org log
  ↓
Write lock entries to .ingest-lock.json (one per file)
  ↓
git add wiki files + .ingest-lock.json
git commit "[ingest] <label>"
  ↓
git push
```

## Pending File Detection

A file is considered pending if:

- Its path is **not in** `.ingest-lock.json` → status `new`
- Its path is in the lock but its **SHA-256 hash changed** → status `updated`

Files with a matching hash in the lock are skipped. The lock stores:

```json
{
  "version": 1,
  "files": {
    "raw/clips/sspai/article.org": {
      "ingestedAt": "2026-04-12T08:00:00.000Z",
      "contentHash": "sha256:a3f2c1...",
      "wikiPages": []
    }
  }
}
```

Supported extensions: `.org`, `.md`, `.txt`.

## What Claude Does

Claude runs as a single `claude -p --model sonnet` session with all selected files. Its instructions are embedded in the CLI — it does not read `CLAUDE.md`.

For each source file, Claude:

1. Reads the file (chunked if > 200 KB)
2. Checks for existing wiki pages (`grep SOURCES:` in wiki files)
3. Extracts entities, concepts, and key arguments with section-level attribution
4. Matches existing headings (fuzzy) or appends new ones
5. Writes pages following the org-mode wiki template, with source citations and confidence levels (`HIGH` / `MED` / `LOW`)
6. Flags contradictions between new content and existing wiki pages

After all files are processed, Claude appends an entry to `summary.org` log.

Claude is **not** responsible for git commits or lock updates — the CLI handles both.

### Allowed Tools

Claude is restricted to the minimum required:

| Tool | Purpose |
|------|---------|
| `Read` | Read source files and wiki files |
| `Edit` | Write to wiki files |
| `Bash(date *)` | Generate `YYYYMMDDTHHMMSS` IDs |
| `Bash(grep *)` | Search for existing headings |
| `Bash(git status)` | Check repo state |
| `Bash(git log *)` | Read recent commit history |

Git commits and lock writes are intentionally excluded — the CLI owns those.

## Org Root Detection

The CLI walks up from the current directory looking for a folder that contains both `raw/` and `CLAUDE.md`. Run from anywhere inside your org repo.

## Requirements

- Node >= 20
- `claude` CLI in PATH — install via `npm install -g @anthropic-ai/claude-code`
- An org repo with `raw/` directory, `CLAUDE.md`, and `.ingest-lock.json` at the root
  (`.ingest-lock.json` is created automatically on first run if missing)

## License

MIT
