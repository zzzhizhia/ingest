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
  return join(orgRoot, "ingest-lock.json");
}

export function readLock(orgRoot: string): LockFile {
  const p = lockPath(orgRoot);
  if (!existsSync(p)) return { version: 1, files: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new Error(`invalid JSON in ${p}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${p}: expected object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    throw new Error(`${p}: missing or invalid "version" field`);
  }
  if (typeof obj.files !== "object" || obj.files === null || Array.isArray(obj.files)) {
    throw new Error(`${p}: missing or invalid "files" field`);
  }
  return raw as LockFile;
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

export function writeLockEntries(
  orgRoot: string,
  rels: string[],
): void {
  if (rels.length === 0) return;
  const p = lockPath(orgRoot);
  const lock = readLock(orgRoot);
  for (const rel of rels) {
    const absPath = join(orgRoot, rel);
    const contentHash =
      "sha256:" + createHash("sha256").update(readFileSync(absPath)).digest("hex");
    lock.files[rel] = {
      ingestedAt: new Date().toISOString(),
      contentHash,
    };
  }
  writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", "utf8");
}

export function removeLockEntry(
  orgRoot: string,
  rel: string,
): boolean {
  const p = lockPath(orgRoot);
  const lock = readLock(orgRoot);
  if (!(rel in lock.files)) return false;
  delete lock.files[rel];
  writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", "utf8");
  return true;
}

export function fileHash(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}
