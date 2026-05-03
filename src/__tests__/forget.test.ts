import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLock, removeLockEntry, writeLockEntry, writeLockEntries } from "../lock.js";

const TMP = join(import.meta.dirname, "__tmp_forget__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("removeLockEntry", () => {
  it("removes an existing entry and returns true", () => {
    const rawDir = join(TMP, "raw");
    mkdirSync(rawDir);
    writeFileSync(join(rawDir, "a.org"), "content");
    writeLockEntry(TMP, "raw/a.org");

    const removed = removeLockEntry(TMP, "raw/a.org");
    expect(removed).toBe(true);

    const lock = readLock(TMP);
    expect(lock.files["raw/a.org"]).toBeUndefined();
  });

  it("returns false for non-existent entry", () => {
    const removed = removeLockEntry(TMP, "raw/nonexistent.org");
    expect(removed).toBe(false);
  });

  it("preserves other entries", () => {
    const rawDir = join(TMP, "raw");
    mkdirSync(rawDir);
    writeFileSync(join(rawDir, "a.org"), "a");
    writeFileSync(join(rawDir, "b.org"), "b");
    writeLockEntry(TMP, "raw/a.org");
    writeLockEntry(TMP, "raw/b.org");

    removeLockEntry(TMP, "raw/a.org");

    const lock = readLock(TMP);
    expect(lock.files["raw/a.org"]).toBeUndefined();
    expect(lock.files["raw/b.org"]).toBeDefined();
  });
});

describe("writeLockEntries", () => {
  it("writes multiple entries in one call", () => {
    const rawDir = join(TMP, "raw");
    mkdirSync(rawDir);
    writeFileSync(join(rawDir, "a.org"), "a");
    writeFileSync(join(rawDir, "b.org"), "b");

    writeLockEntries(TMP, ["raw/a.org", "raw/b.org"]);

    const lock = readLock(TMP);
    expect(Object.keys(lock.files)).toHaveLength(2);
    expect(lock.files["raw/a.org"].contentHash).toMatch(/^sha256:/);
    expect(lock.files["raw/b.org"].contentHash).toMatch(/^sha256:/);
  });

  it("does nothing with empty array", () => {
    writeLockEntries(TMP, []);
    const lock = readLock(TMP);
    expect(Object.keys(lock.files)).toHaveLength(0);
  });
});

describe("readLock validation", () => {
  it("rejects invalid JSON", () => {
    writeFileSync(join(TMP, "ingest-lock.json"), "not json");
    expect(() => readLock(TMP)).toThrow("invalid JSON");
  });

  it("rejects non-object", () => {
    writeFileSync(join(TMP, "ingest-lock.json"), '"string"');
    expect(() => readLock(TMP)).toThrow("expected object");
  });

  it("rejects missing version", () => {
    writeFileSync(join(TMP, "ingest-lock.json"), JSON.stringify({ files: {} }));
    expect(() => readLock(TMP)).toThrow('invalid "version"');
  });

  it("rejects missing files field", () => {
    writeFileSync(join(TMP, "ingest-lock.json"), JSON.stringify({ version: 1 }));
    expect(() => readLock(TMP)).toThrow('invalid "files"');
  });

  it("rejects array for files", () => {
    writeFileSync(
      join(TMP, "ingest-lock.json"),
      JSON.stringify({ version: 1, files: [] }),
    );
    expect(() => readLock(TMP)).toThrow('invalid "files"');
  });
});
