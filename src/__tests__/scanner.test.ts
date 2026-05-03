import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileHash } from "../lock.js";
import type { LockFile } from "../lock.js";
import { scanPendingFiles } from "../scanner.js";

const TMP = join(import.meta.dirname, "__tmp_scanner__");

function makeOrg(orgRoot: string, relPath: string, content = "content"): void {
  const full = join(orgRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function emptyLock(): LockFile {
  return { version: 1, files: {} };
}

beforeEach(() => mkdirSync(join(TMP, "raw"), { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("scanPendingFiles", () => {
  it("reports new files not in lock", () => {
    makeOrg(TMP, "raw/clips/article.org", "hello");
    const results = scanPendingFiles(TMP, emptyLock());
    expect(results).toEqual([{ rel: "raw/clips/article.org", status: "new" }]);
  });

  it("skips files already in lock with matching hash", () => {
    makeOrg(TMP, "raw/clips/article.org", "hello");
    const hash = fileHash(join(TMP, "raw/clips/article.org"));
    const lock: LockFile = {
      version: 1,
      files: {
        "raw/clips/article.org": {
          ingestedAt: "2026-04-12T00:00:00.000Z",
          contentHash: "sha256:" + hash,
        },
      },
    };
    expect(scanPendingFiles(TMP, lock)).toHaveLength(0);
  });

  it("reports updated files when hash changes", () => {
    makeOrg(TMP, "raw/clips/article.org", "v1");
    const lock: LockFile = {
      version: 1,
      files: {
        "raw/clips/article.org": {
          ingestedAt: "2026-04-12T00:00:00.000Z",
          contentHash: "sha256:oldhash",
        },
      },
    };
    const results = scanPendingFiles(TMP, lock);
    expect(results).toEqual([
      { rel: "raw/clips/article.org", status: "updated" },
    ]);
  });

  it("ignores unsupported file extensions", () => {
    makeOrg(TMP, "raw/clips/image.png", "binary");
    makeOrg(TMP, "raw/clips/archive.zip", "binary");
    expect(scanPendingFiles(TMP, emptyLock())).toHaveLength(0);
  });

  it("includes .pdf files", () => {
    makeOrg(TMP, "raw/papers/paper.pdf", "%PDF-1.4 binary");
    const results = scanPendingFiles(TMP, emptyLock());
    expect(results).toEqual([{ rel: "raw/papers/paper.pdf", status: "new" }]);
  });

  it("includes Office files (doc/docx/ppt/pptx/xls/xlsx)", () => {
    makeOrg(TMP, "raw/drafts/slides.pptx", "PK\x03\x04 fake");
    makeOrg(TMP, "raw/drafts/report.docx", "PK\x03\x04 fake");
    makeOrg(TMP, "raw/drafts/data.xlsx", "PK\x03\x04 fake");
    const results = scanPendingFiles(TMP, emptyLock());
    const rels = results.map((r) => r.rel).sort();
    expect(rels).toEqual([
      "raw/drafts/data.xlsx",
      "raw/drafts/report.docx",
      "raw/drafts/slides.pptx",
    ]);
    for (const r of results) expect(r.status).toBe("new");
  });

  it("handles multiple files mixed new/updated/done", () => {
    makeOrg(TMP, "raw/a.org", "a");
    makeOrg(TMP, "raw/b.md", "b");
    makeOrg(TMP, "raw/c.org", "c");

    const hashC = fileHash(join(TMP, "raw/c.org"));
    const lock: LockFile = {
      version: 1,
      files: {
        "raw/b.md": {
          ingestedAt: "2026-04-12T00:00:00.000Z",
          contentHash: "sha256:stale",
        },
        "raw/c.org": {
          ingestedAt: "2026-04-12T00:00:00.000Z",
          contentHash: "sha256:" + hashC,
        },
      },
    };

    const results = scanPendingFiles(TMP, lock);
    expect(results).toHaveLength(2);
    expect(results.find((f) => f.rel === "raw/a.org")?.status).toBe("new");
    expect(results.find((f) => f.rel === "raw/b.md")?.status).toBe("updated");
  });
});
