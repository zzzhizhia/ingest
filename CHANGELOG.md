# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.9.3] - 2026-07-06

### Fixed

- Renamed `raw/` files were shown as `[NEW]` in the pending list. `scanPendingFiles()` now uses `git diff --cached --find-renames` (via a temp index) to detect renames. Pure renames (content unchanged) show as `[REN]` and are skipped; renames with modifications show as `[UPD]` with the old path noted.
- Deleted `raw/` files now automatically clean up orphaned entries in `ingest-lock.json`.

## [1.9.2] - 2026-07-03

### Added

- Safety rule: never edit the four wiki files directly (entities.org, concepts.org, sources.org, analyses.org); only `ingest` may modify them. Added to the auto-generated `CLAUDE.md` and the digest `SYSTEM_PROMPT`.

## [1.9.1] - 2026-07-02

### Changed

- `ingest` and `ingest status` now show only the main repository's pending files by default. Subwiki files under `subs/` are included only when `--subs` is passed. This also applies to `ingest --all --subs`.

## [1.9.0] - 2026-07-01

### Changed

- Removed the "`raw/` is immutable" and "never modify `raw/`" requirements from the auto-generated `CLAUDE.md`, the digest `SYSTEM_PROMPT`, the query `SYSTEM_PROMPT`, and `README.md`. `raw/` remains the canonical source location, but edits are no longer forbidden.

## [1.8.3] - 2026-06-23

### Added

- `ingest view <id>` as an alias for `ingest show <id>`.

## [1.8.2] - 2026-06-22

### Changed

- Auto-generated `CLAUDE.md` now includes a `## Common CLI Commands` section documenting `ingest`, `ingest --all`, `ingest status`, `ingest query`, `ingest grep`, `ingest show`, `ingest export`, and `ingest lint`.

## [1.8.1] - 2026-06-22

### Changed

- Auto-generated `CLAUDE.md` now documents the `ingest vector` workflow (index, search, similar, cluster, stats) and lists `clusters.org` and `ingest.json` in the knowledge base structure.

## [1.8.0] - 2026-06-22

### Added

- `ingest vector` subcommand family — page-level semantic indexing, search, similarity, and K-means clustering. Embeddings are fetched via an OpenAI-compatible API (default DashScope `text-embedding-v4`) and stored locally in SQLite (`node:sqlite`). Commands: `index`, `search`, `similar`, `cluster`, `stats`.
- `ingest export --semantic N` — augment link-based HTML export with the top-N semantically similar pages.
- `ingest show <id>` — print the raw org block of a wiki page by `:ID:`.
- Independent `--help` text for every subcommand; run `ingest <command> --help` for detailed usage.

### Changed

- Dynamic imports plus `tsup` code splitting so `node:sqlite` is only loaded for vector commands; non-vector commands no longer print the SQLite experimental warning.
- The SQLite experimental warning is filtered out for vector commands in the CLI while keeping other warnings visible.
- Auto-generated `CLAUDE.md` template now notes that `raw/` files may be modified when explicitly instructed.

## [1.7.0] - 2026-06-12

### Added

- `ingest history` subcommand — list past ingest runs with `--last N` and `--status` filters; show details with `ingest history <id>`. State stored in `$XDG_STATE_HOME/ingest/runs.json` (machine-local, not version-controlled).
- `ingest resume [id]` subcommand — resume an interrupted run by replaying the original Claude session with `--resume <session-id> "continue"`. Defaults to the latest in-progress or interrupted run for the current wiki. Claude's session already knows which sources it had been processing, so a one-word prompt picks up where it left off.
- New `src/runs.ts` module: ULID-based run ids, XDG-state storage, `readRuns` / `addRun` / `updateRun` / `findLatestResumable` / `getRun` / `setRunStatus` API. ULIDs self-implemented to avoid a new dep.
- 22 vitest assertions in `runs.test.ts` covering ulid format, XDG path resolution, file round-trip, addRun accumulation, updateRun merge, findLatestResumable priority + sort + sessionId filter, and the setRunStatus helper's four shapes.

### Fixed

- **Resume preserved org files on Ctrl+C** (`f2d0acf`): `claude.ts` was calling `process.exit(130)` in its close handler before the caller could persist the parsed `session_id`, so any Ctrl+C during the main ingest left the run record with `status: "interrupted"` but no `mainSessionId`. `invokeClaude` now resolves with a new `aborted: true` flag; `cmdIngest` and `cmdResume` persist the sessionId (when present in the buffer) before exiting. `findLatestResumable` filters out runs without a `mainSessionId` so stale unresumable records don't surface.
- **Duplicate `:ID:` from Claude's `Edit replace_all`** (`6b41c48`): a real-world ingest hit the same `:ID:` stamp twice in `concepts.org` and the pre-commit hook caught it, but the recovery loop (`runClaudeFix`) took 20+ minutes. Defense-in-depth: a prompt guard tells the agent never to use `replace_all=true`, and `runSafeFixes` gains a `duplicate-id` kind that drops later copies in O(n) and recovers in <1s.
- **Subwiki aborted branch was overwriting the main sessionId** (`61098cd`): the spread `(sessionId ? { mainSessionId: sessionId } : {})` in the subwiki parallel loop clobbered the previously-persisted main sessionId with the subwiki's. Resume would then re-invoke Claude on the wrong conversation. Subwiki session ids are no longer persisted at all.
- **XDG_STATE_HOME="" bypassed the `??` fallback**: an explicitly-empty env var produced a CWD-relative `ingest/runs.json` path and stray files anywhere. Switched to `||` which falls back on empty strings.
- **markInterrupted race vs cmdIngest success path**: a SIGINT arriving after the run was marked `completed` would clobber it back to `interrupted`. The handler now reads the current status and skips the write if the run is in a terminal state.
- **findOrgRoot didn't resolve symlinks** — on macOS (`/var` → `/private/var`) the same wiki compared as a different one and `ingest resume` rejected valid runs. Added `realpathSync(dir)` on the success path.
- **runClaudeFix returned a bare boolean**: an aborted fix pass was reported as `claude fix exited with non-zero` and then immediately fell through to `git commit still failing`. Changed to `{ ok, aborted }`; cmdIngest handles the abort with the correct exit code (130) and message.
- **Fix-exhausted runs were marked "interrupted" with the original mainSessionId intact**: `ingest resume` would happily continue a session whose previous turn was the failed fix. Now clears mainSessionId so findLatestResumable skips the run.
- **Module-level SIGINT/SIGTERM handlers were registered at import time and never removed**, accumulating on every test-suite import. Moved registration into `main()`.
- **cmdQuery ignored the `aborted` field**: SIGINT during a query showed generic `query failed` + exit 1 instead of `aborted by user` + exit 130.
- **`ingest history --last 0` / `--last abc`** was silently accepted, returning the full list. Now validates and errors.
- **`ingest history --status foo`** was cast unsafely to `RunStatus[]` and silently returned an empty list for any typo. Now validates against the closed set and errors with the allowed values.
- `findLatestResumable` and `cmdHistory` used `localeCompare` on fixed-format ISO-8601 strings — locale-dependent and slower. Switched to plain `<` / `>`.

### Changed

- New `setRunStatus(runId, status, opts?)` helper in `runs.ts` collapses the 14 `try { updateRun(...) } catch {}` call sites across `cmdIngest`, `cmdResume`, and `markInterrupted` into a single helper that auto-stamps `finishedAt`, optionally sets/clears `mainSessionId`, and silently swallows disk-write errors. Net: -71 lines from `index.ts`.

## [1.6.0] - 2026-06-06

### Added

- `Iron Law` + `Red Flags` + `Pre-Save Self-Check` sections to the sub-process worker prompt (`src/prompts.ts`); mirrors the design from the auto-generated `CLAUDE.md`
- `:CONTRADICTS:` property demo (comment line) in the page-template org block of both `src/init.ts` `CLAUDE_MD_TEMPLATE` and `src/prompts.ts` `SYSTEM_PROMPT`
- `[unverified]` marker as a named safety rule
- `## Attachments` section in the auto-generated `CLAUDE.md` template (Denote subdirectory co-location convention)
- 6 new vitest assertions pinning the new schema sections across `prompts.test.ts` (5) and `init.test.ts` (1)

### Changed

- **i18n**: `src/prompts.ts` (SYSTEM_PROMPT, SUBMODULE_SYSTEM_PROMPT, buildPrompt, buildFixPrompt) and `src/index.ts` `QUERY_SYSTEM_PROMPT` translated from Chinese to English
- Simplified `CLAUDE_MD_TEMPLATE` (init.ts): 103 → 87 lines; added Iron Law, Red Flags, Page Self-Check, `:CONTRADICTS:` demo, `[unverified]`, `## Attachments`; updated Query Workflow step 3 to propose Denote-named `raw/` files instead of writing `analyses.org` directly
- Tightened `Page Creation Rules` (3 bullets → 1) in `src/prompts.ts`; only the "no trivial pages" rule is load-bearing
- Added load-bearing comment above `SUBMODULE_SYSTEM_PROMPT.replace()` chain warning about the column-aligned table row and trailing English sentence being anchor strings (silent no-op if either changes)
- Defined `+N ~M` log-line notation in summary.org update step (N = headings created, M = updated)

### Fixed

- Claude fix now resumes the just-finished ingest session (`--resume <session-id>`) instead of starting a fresh `claude -p`, so the model keeps its source-file and wiki context across the fix pass — no more cold re-read of every source file
- A5: real org-mode bug — `:CONTRADICTS:` PROPERTIES block was inside a `** Contradictions` body section (where org-mode silently ignores it). Moved to a `; CONTRADICTS:` comment line in the heading-level PROPERTIES drawer
- Pre-existing tsc strict error: `prompts.test.ts` was missing `noPull: false` in its `IngestConfig` literal. `tsc --noEmit` now passes cleanly for the first time

## [1.5.5] - 2026-06-04

### Added

- `.html` to the supported source file types (direct read, no pre-conversion)

### Changed

- Simplified `SUBMODULE_SYSTEM_PROMPT` chained calls and unified multi-line format

### Fixed

- Remove extra blank line between file list and ingesting spinner in auto mode

## [1.5.4] - 2026-05-28

### Changed

- `claude -p` always runs with `--bare` (skip hooks, LSP, auto-memory, CLAUDE.md auto-discovery)

## [1.5.3] - 2026-05-26

### Added

- `ingest grep` promoted to primary search tool in all prompts; auto-allowlisted in Claude tools

### Fixed

- Replace `echo|grep` pipeline with here-string to avoid pipefail false positive with large inputs

## [1.5.2] - 2026-05-23

### Added

- `noPull` config option in `ingest.json` as alternative to `--no-pull` flag
- Claude output included as git commit message body

## [1.5.1] - 2026-05-11

### Changed

- `ingest grep` now uses `rg` (ripgrep) for extraction -- keyword highlighting in TTY, raw output when piped
- `ingest grep` heading displays clean wiki page title (purple in TTY) instead of raw `* Title :tag:`
- Added `ingest rg` as alias for `ingest grep`
- rg (ripgrep) is now a required dependency for `grep`/`rg` subcommand

## [1.5.0] - 2026-05-11

### Added

- `ingest grep <pattern>` command -- search wiki pages by title (regex, case-insensitive) and print full org content

## [1.4.0] - 2026-05-07

### Added

- `ingest sync` command for bidirectional wiki synchronization
- `--at` flag for delayed execution (e.g. `--at 30m`, `--at 2h`, `--at 09:00`)
- `ingest schedule` command to list and cancel pending scheduled jobs
- Scheduled jobs self-cleanup from `$XDG_STATE_HOME/ingest/jobs.json` after completion

### Fixed

- Spinner and ANSI artifacts suppressed when stdout is not a TTY
- Duplicate `--all` entry removed from help output
- Positional arg parser correctly skips values of `--at` and other valued flags

## [1.1.1] - 2026-05-04

### Removed

- Image and audio file support (`.png`, `.jpg`, `.gif`, `.m4a`, `.mp3`, `.wav`, `.ogg`)

### Changed

- Claude output rendered via glow instead of box borders
- Deduplicated file list display: checkbox shows tagged list once
- Spinner label: "ingesting" while running, "ingested" on completion
- Subwiki push output labeled with subwiki name
- Extracted `printMarkdown` as shared rendering helper

## [1.1.0] - 2026-05-03

### Added

- `ingest sub` command for subwiki management (list, add, new, remove)
- Support removing multiple subwikis in one command

### Changed

- Renamed all user-facing "submodule" to "subwiki"
- Subwiki detection simplified to any subdirectory under `subs/`

## [1.0.0] - 2026-05-03

### Added

- Interactive CLI with checkbox file selection
- `ingest init` scaffolding with pre-commit hook
- `ingest status` to show pending files
- `ingest lint` with `--fix` for safe auto-fixes
- `ingest query` for read-only wiki Q&A via Claude
- `ingest export` for HTML rendering with SPA navigation
- `ingest forget` to re-queue files for ingestion
- `ingest man` for terminal-rendered manual
- Subwiki knowledge bases with parallel ingestion
- Pre-conversion: Office to PDF (LibreOffice), audio to text (Whisper)
- Pre-commit hook for wiki validation
- `ingest.json` config for model, effort, and allowed tools
