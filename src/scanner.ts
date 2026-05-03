import { readdirSync, existsSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileHash } from "./lock.js";
import type { LockFile } from "./lock.js";

export type FileStatus = "new" | "updated";

export interface PendingFile {
  rel: string;
  status: FileStatus;
  /** Absolute path to the submodule root, or undefined for main-repo files. */
  submoduleRoot?: string;
}

const SUPPORTED = new Set([
  ".org",
  ".md",
  ".txt",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".m4a",
  ".mp3",
  ".wav",
  ".ogg",
]);

const WIKI_FILES = new Set([
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
]);

function* walkDir(dir: string, submoduleRoot?: string): Generator<{ abs: string; submoduleRoot?: string }> {
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

export function scanPendingFiles(
  orgRoot: string,
  lock: LockFile,
): PendingFile[] {
  const locked = lock.files ?? {};
  const results: PendingFile[] = [];

  const scanRoots: Array<{ dir: string; subwikiRoot?: string }> = [
    { dir: join(orgRoot, "raw") },
  ];
  const subsDir = join(orgRoot, "subs");
  if (existsSync(subsDir)) {
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
