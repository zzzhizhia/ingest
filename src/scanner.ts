import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileHash } from "./lock.js";
import type { LockFile } from "./lock.js";

export type FileStatus = "new" | "updated";

export interface PendingFile {
  rel: string;
  status: FileStatus;
}

const SUPPORTED = new Set([".org", ".md", ".txt", ".pdf"]);

function* walkDir(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (SUPPORTED.has(ext)) yield full;
    }
  }
}

export function scanPendingFiles(
  orgRoot: string,
  lock: LockFile,
): PendingFile[] {
  const rawDir = join(orgRoot, "raw");
  const locked = lock.files ?? {};
  const results: PendingFile[] = [];

  for (const absPath of [...walkDir(rawDir)].sort()) {
    const rel = relative(orgRoot, absPath);
    const currentHash = fileHash(absPath);
    const entry = locked[rel];

    if (!entry) {
      results.push({ rel, status: "new" });
    } else if (entry.contentHash.replace("sha256:", "") !== currentHash) {
      results.push({ rel, status: "updated" });
    }
  }

  return results;
}
