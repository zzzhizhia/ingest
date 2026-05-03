import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LockEntry {
  ingestedAt: string;
  contentHash: string;
}

export interface LockFile {
  version: number;
  files: Record<string, LockEntry>;
}

export function lockPath(orgRoot: string): string {
  return join(orgRoot, ".ingest-lock.json");
}

export function readLock(orgRoot: string): LockFile {
  const p = lockPath(orgRoot);
  if (!existsSync(p)) return { version: 1, files: {} };
  return JSON.parse(readFileSync(p, "utf8")) as LockFile;
}

export function writeLockEntry(
  orgRoot: string,
  rel: string,
): void {
  const p = lockPath(orgRoot);
  const lock = readLock(orgRoot);
  const absPath = join(orgRoot, rel);
  const contentHash =
    "sha256:" + createHash("sha256").update(readFileSync(absPath)).digest("hex");
  lock.files[rel] = {
    ingestedAt: new Date().toISOString(),
    contentHash,
  };
  writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", "utf8");
}

export function fileHash(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}
