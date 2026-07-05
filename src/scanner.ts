import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { fileHash, lockPath } from "./lock.js";
import type { LockFile } from "./lock.js";

// ── types ──────────────────────────────────────────────────────────────────────

export type FileStatus = "new" | "updated" | "renamed";

export interface PendingFile {
  rel: string;
  status: FileStatus;
  /** Absolute path to the submodule root, or undefined for main-repo files. */
  submoduleRoot?: string;
  /** Previous relative path when this file was renamed. */
  renamedFrom?: string;
}

interface FileChange {
  rel: string;
  type: "A" | "M" | "D" | "R";
  oldPath?: string;
  similarity?: number;
  submoduleRoot?: string;
}

// ── supported extensions (for fallback path) ───────────────────────────────────

const SUPPORTED = new Set([
  ".org",
  ".md",
  ".txt",
  ".html",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

const WIKI_FILES = new Set([
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
]);

// ── Git helpers ────────────────────────────────────────────────────────────────

/** Resolve the real .git directory, handling submodule gitdir files. */
function gitDir(repoRoot: string): string {
  const dotGit = join(repoRoot, ".git");
  try {
    const st = statSync(dotGit);
    if (st.isFile()) {
      const content = readFileSync(dotGit, "utf8");
      const m = content.match(/^gitdir:\s*(.+)$/m);
      if (m) return resolve(repoRoot, m[1].trim());
    }
  } catch {
    // fall through
  }
  return dotGit;
}

/** Parse NUL-separated `git diff --name-status -z` output. */
function parseGitDiff(raw: string): FileChange[] {
  if (!raw) return [];
  const parts = raw.split("\0").filter(Boolean);
  const changes: FileChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const head = parts[i];
    if (head.startsWith("R")) {
      // R100\0old-path\0new-path  (git puts old path first)
      const similarity = parseInt(head.slice(1), 10) || 100;
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (newPath && oldPath) {
        changes.push({ rel: newPath, type: "R", oldPath, similarity });
      }
      i += 3;
    } else {
      // A\0path  or  M\0path  or  D\0path
      const type = head[0] as "A" | "M" | "D";
      const path = parts[i + 1];
      if (path && (type === "A" || type === "M" || type === "D")) {
        changes.push({ rel: path, type });
      }
      i += 2;
    }
  }
  return changes;
}

/**
 * Scan a single git repo for changes in raw/.
 * Uses a temp index (copied from the real one to preserve mtime cache)
 * so the user's real index is never touched.
 */
function scanOneRepo(repoRoot: string): FileChange[] {
  const gd = gitDir(repoRoot);
  const realIndex = join(gd, "index");
  if (!existsSync(realIndex)) return [];

  const rawDir = join(repoRoot, "raw");
  if (!existsSync(rawDir)) return [];

  const tmpDir = mkdtempSync(join(tmpdir(), "ingest-scan-"));
  const tmpIndex = join(tmpDir, "index");

  try {
    copyFileSync(realIndex, tmpIndex);

    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };

    execFileSync("git", ["add", "-A", "raw/"], {
      cwd: repoRoot,
      env,
      stdio: "pipe",
    });

    const output = execFileSync(
      "git",
      ["diff", "--cached", "--find-renames", "--name-status", "-z", "HEAD", "--", "raw/"],
      { cwd: repoRoot, env, stdio: "pipe" },
    );

    return parseGitDiff(output.toString("utf8"));
  } catch {
    return [];
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Scan the main repo and optionally all subwiki repos. */
function scanAllChanges(orgRoot: string, includeSubs: boolean): FileChange[] {
  const changes = scanOneRepo(orgRoot);

  if (includeSubs) {
    const subsDir = join(orgRoot, "subs");
    if (existsSync(subsDir)) {
      for (const entry of readdirSync(subsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const subRoot = join(subsDir, entry.name);
        if (!existsSync(join(subRoot, ".git"))) continue;
        const subName = entry.name;
        for (const c of scanOneRepo(subRoot)) {
          // Git paths are relative to the subwiki root; prefix with subs/<name>/
          c.rel = `subs/${subName}/${c.rel}`;
          if (c.oldPath) c.oldPath = `subs/${subName}/${c.oldPath}`;
          c.submoduleRoot = subRoot;
          changes.push(c);
        }
      }
    }
  }

  return changes;
}

// ── Fallback: filesystem walk (used when Git is unavailable) ───────────────────

function* walkDir(
  dir: string,
  submoduleRoot?: string,
): Generator<{ abs: string; submoduleRoot?: string }> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full, submoduleRoot);
    } else if (entry.isFile()) {
      if (submoduleRoot && WIKI_FILES.has(entry.name)) continue;
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED.has(ext)) yield { abs: full, submoduleRoot };
    }
  }
}

function scanPendingFilesFallback(
  orgRoot: string,
  lock: LockFile,
  includeSubs: boolean,
): PendingFile[] {
  const locked = lock.files ?? {};
  const results: PendingFile[] = [];

  const scanRoots: Array<{ dir: string; subwikiRoot?: string }> = [
    { dir: join(orgRoot, "raw") },
  ];
  const subsDir = join(orgRoot, "subs");
  if (includeSubs && existsSync(subsDir)) {
    for (const entry of readdirSync(subsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const full = join(subsDir, entry.name);
        scanRoots.push({ dir: full, subwikiRoot: full });
      }
    }
  }

  const entries = scanRoots
    .flatMap((root) => [...walkDir(root.dir, root.subwikiRoot)])
    .sort((a, b) => a.abs.localeCompare(b.abs));

  for (const { abs, submoduleRoot } of entries) {
    const rel = relative(orgRoot, abs);
    const currentHash = fileHash(abs);
    const entry = locked[rel];

    if (!entry) {
      results.push({ rel, status: "new", submoduleRoot });
    } else if (entry.contentHash.replace("sha256:", "") !== currentHash) {
      results.push({ rel, status: "updated", submoduleRoot });
    }
  }

  return results;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function scanPendingFiles(
  orgRoot: string,
  lock: LockFile,
  includeSubs = false,
): PendingFile[] {
  let changes: FileChange[];
  try {
    changes = scanAllChanges(orgRoot, includeSubs);
  } catch {
    return scanPendingFilesFallback(orgRoot, lock, includeSubs);
  }

  if (changes.length === 0) return [];

  const locked = lock.files ?? {};
  const results: PendingFile[] = [];
  const lockMutations: Array<
    | { action: "delete"; path: string }
    | { action: "rename"; oldPath: string; newPath: string; contentChanged: boolean }
  > = [];

  for (const c of changes) {
    if (c.type === "D") {
      // File deleted from disk — clean up orphaned lock entry.
      if (locked[c.rel]) {
        lockMutations.push({ action: "delete", path: c.rel });
      }
      continue;
    }

    if (c.type === "R") {
      // Git detected a rename.
      const oldPath = c.oldPath!;
      const contentChanged = c.similarity !== 100;
      lockMutations.push({ action: "rename", oldPath, newPath: c.rel, contentChanged });
      if (contentChanged) {
        // Renamed + modified: needs re-ingestion.
        results.push({
          rel: c.rel,
          status: "updated",
          submoduleRoot: c.submoduleRoot,
          renamedFrom: oldPath,
        });
      } else {
        // Pure rename: lock updated, no re-ingestion needed.
        results.push({
          rel: c.rel,
          status: "renamed",
          submoduleRoot: c.submoduleRoot,
          renamedFrom: oldPath,
        });
      }
      continue;
    }

    // A (added) or M (modified)
    const entry = locked[c.rel];
    if (c.type === "A") {
      results.push({ rel: c.rel, status: "new", submoduleRoot: c.submoduleRoot });
    } else {
      // M: modified since HEAD
      results.push({
        rel: c.rel,
        status: entry ? "updated" : "new",
        submoduleRoot: c.submoduleRoot,
      });
    }
  }

  // Apply lock mutations in one batch.
  if (lockMutations.length > 0) {
    for (const m of lockMutations) {
      if (m.action === "delete") {
        delete lock.files[m.path];
      } else {
        const oldEntry = lock.files[m.oldPath];
        delete lock.files[m.oldPath];
        const absPath = join(orgRoot, m.newPath);
        lock.files[m.newPath] = {
          ingestedAt:
            oldEntry?.ingestedAt ?? new Date().toISOString(),
          contentHash: "sha256:" + fileHash(absPath),
        };
      }
    }
    writeFileSync(lockPath(orgRoot), JSON.stringify(lock, null, 2) + "\n", "utf8");
  }

  // Stable sort: renamed before updated before new, then alphabetical.
  const order: Record<FileStatus, number> = { renamed: 0, updated: 1, new: 2 };
  results.sort((a, b) => {
    const d = order[a.status] - order[b.status];
    return d !== 0 ? d : a.rel.localeCompare(b.rel);
  });

  return results;
}
