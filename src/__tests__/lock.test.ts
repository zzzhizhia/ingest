import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileHash, readLock, writeLockEntry } from "../lock.js";

const TMP = join(import.meta.dirname, "__tmp__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("readLock", () => {
  it("returns empty lock when file does not exist", () => {
    const lock = readLock(TMP);
    expect(lock).toEqual({ version: 1, files: {} });
  });

  it("parses existing lock file", () => {
    const data = {
      version: 1,
      files: {
        "raw/foo.org": {
          ingestedAt: "2026-04-12T00:00:00.000Z",
          contentHash: "sha256:abc",
          wikiPages: ["20260412T100000"],
        },
      },
    };
    writeFileSync(join(TMP, ".ingest-lock.json"), JSON.stringify(data));
    expect(readLock(TMP)).toEqual(data);
  });
});

describe("writeLockEntry", () => {
  it("creates lock file and writes entry", () => {
    const rawDir = join(TMP, "raw");
    mkdirSync(rawDir);
    writeFileSync(join(rawDir, "article.org"), "hello world");

    writeLockEntry(TMP, "raw/article.org", ["20260412T100000"]);

    const lock = readLock(TMP);
    expect(lock.files["raw/article.org"]).toMatchObject({
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      wikiPages: ["20260412T100000"],
    });
  });

  it("overwrites an existing entry", () => {
    const rawDir = join(TMP, "raw");
    mkdirSync(rawDir);
    writeFileSync(join(rawDir, "article.org"), "v1");
    writeLockEntry(TMP, "raw/article.org", ["id1"]);

    writeFileSync(join(rawDir, "article.org"), "v2");
    writeLockEntry(TMP, "raw/article.org", ["id2"]);

    const lock = readLock(TMP);
    expect(lock.files["raw/article.org"].wikiPages).toEqual(["id2"]);
    expect(Object.keys(lock.files)).toHaveLength(1);
  });
});

describe("fileHash", () => {
  it("returns consistent sha256 hex", () => {
    const p = join(TMP, "test.txt");
    writeFileSync(p, "deterministic");
    const h1 = fileHash(p);
    const h2 = fileHash(p);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
