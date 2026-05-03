# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
