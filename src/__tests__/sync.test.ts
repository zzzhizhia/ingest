import { mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOrgHeadings, parseOrgFile, serializeHeadings } from "../org-headings.js";
import { buildSyncPair, diffFiles, diffHeadings, fileMtime } from "../sync-diff.js";
import { applyOrgContent, applyFileWrite, resolveOrgFile, resolveRawFile, type SyncOptions } from "../sync-resolve.js";

const TMP = join(import.meta.dirname, "__tmp_sync__");
const ROOT_A = join(TMP, "a");
const ROOT_B = join(TMP, "b");

beforeEach(() => {
  mkdirSync(join(ROOT_A, "raw"), { recursive: true });
  mkdirSync(join(ROOT_B, "raw"), { recursive: true });
});
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

const headingAlice = `* Alice                                                         :entity:
:PROPERTIES:
:ID:       20260101T000001
:DATE:     [2026-01-01]
:END:

** Overview

A person named Alice.
`;

const headingBob = `* Bob                                                           :entity:
:PROPERTIES:
:ID:       20260101T000002
:DATE:     [2026-01-01]
:END:

** Overview

A person named Bob.
`;

const headingAliceModified = `* Alice                                                         :entity:
:PROPERTIES:
:ID:       20260101T000001
:DATE:     [2026-01-01]
:END:

** Overview

Alice is a mathematician.
`;

// ── org-headings parser ──────────────────────────────────────────────────────

describe("parseOrgHeadings", () => {
  it("parses headings with ID", () => {
    const headings = parseOrgHeadings(headingAlice + headingBob);
    expect(headings).toHaveLength(2);
    expect(headings[0].id).toBe("20260101T000001");
    expect(headings[0].title).toBe("Alice");
    expect(headings[0].tags).toEqual(["entity"]);
    expect(headings[1].id).toBe("20260101T000002");
    expect(headings[1].title).toBe("Bob");
  });

  it("handles headings without ID", () => {
    const headings = parseOrgHeadings("* No Props\nSome content.\n");
    expect(headings).toHaveLength(1);
    expect(headings[0].id).toBeNull();
    expect(headings[0].title).toBe("No Props");
  });

  it("returns empty for empty content", () => {
    expect(parseOrgHeadings("")).toHaveLength(0);
  });
});

describe("serializeHeadings", () => {
  it("round-trips parsed headings", () => {
    const content = headingAlice + headingBob;
    const headings = parseOrgHeadings(content);
    const serialized = serializeHeadings(headings);
    expect(serialized.trim()).toBe(content.trim());
  });
});

// ── diffHeadings ─────────────────────────────────────────────────────────────

describe("diffHeadings", () => {
  it("detects identical headings", () => {
    const a = parseOrgHeadings(headingAlice);
    const b = parseOrgHeadings(headingAlice);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("identical");
  });

  it("detects only-a entries", () => {
    const a = parseOrgHeadings(headingAlice + headingBob);
    const b = parseOrgHeadings(headingAlice);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(2);
    expect(diff[0].kind).toBe("identical");
    expect(diff[1].kind).toBe("only-a");
    expect(diff[1].title).toBe("Bob");
  });

  it("detects only-b entries", () => {
    const a = parseOrgHeadings(headingAlice);
    const b = parseOrgHeadings(headingAlice + headingBob);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(2);
    expect(diff[0].kind).toBe("identical");
    expect(diff[1].kind).toBe("only-b");
    expect(diff[1].title).toBe("Bob");
  });

  it("detects modified entries by ID", () => {
    const a = parseOrgHeadings(headingAlice);
    const b = parseOrgHeadings(headingAliceModified);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("modified");
    expect(diff[0].id).toBe("20260101T000001");
  });
});

// ── diffFiles ────────────────────────────────────────────────────────────────

describe("diffFiles", () => {
  it("detects identical org wiki files", () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAlice);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair);
    const ent = diffs.find((d) => d.relPath === "entities.org");
    expect(ent?.kind).toBe("identical");
  });

  it("detects modified org wiki files with heading diff", () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAliceModified);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair);
    const ent = diffs.find((d) => d.relPath === "entities.org");
    expect(ent?.kind).toBe("modified");
    expect(ent?.headingDiff).toBeDefined();
    expect(ent?.headingDiff?.some((h) => h.kind === "modified")).toBe(true);
  });

  it("detects only-a raw files with includeNew", () => {
    writeFileSync(join(ROOT_A, "raw", "paper.md"), "content A");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, undefined, { includeNew: true });
    const raw = diffs.find((d) => d.relPath === "raw/paper.md");
    expect(raw?.kind).toBe("only-a");
    expect(raw?.isOrgWiki).toBe(false);
  });

  it("excludes only-a files by default", () => {
    writeFileSync(join(ROOT_A, "raw", "paper.md"), "content A");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair);
    const raw = diffs.find((d) => d.relPath === "raw/paper.md");
    expect(raw).toBeUndefined();
  });

  it("detects modified raw files by hash", () => {
    writeFileSync(join(ROOT_A, "raw", "paper.md"), "content A");
    writeFileSync(join(ROOT_B, "raw", "paper.md"), "content B");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair);
    const raw = diffs.find((d) => d.relPath === "raw/paper.md");
    expect(raw?.kind).toBe("modified");
  });

  it("filters to specific paths when provided", () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_A, "raw", "paper.md"), "content");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].relPath).toBe("entities.org");
  });
});

// ── resolveOrgFile (non-interactive) ─────────────────────────────────────────

describe("resolveOrgFile non-interactive", () => {
  it("strategy=a resolves conflicts to A", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice + headingBob);
    writeFileSync(join(ROOT_B, "entities.org"), headingAliceModified);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false, includeNew: true };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    // Alice from A (original) + Bob added to both
    expect(result!.contentA).toContain("Alice");
    expect(result!.contentB).toContain("Bob");
  });

  it("without includeNew, only-a headings stay in A only", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice + headingBob);
    writeFileSync(join(ROOT_B, "entities.org"), headingAliceModified);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    // Alice (modified → strategy=a picks A) synced to both
    expect(result!.contentA).toContain("Alice");
    expect(result!.contentB).toContain("Alice");
    // Bob only in A stays in A, not copied to B
    expect(result!.contentA).toContain("Bob");
    expect(result!.contentB).not.toContain("Bob");
  });

  it("strategy=b resolves conflicts to B", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAliceModified);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "b", oneWay: false };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.contentA).toContain("mathematician");
    expect(result!.contentB).toContain("mathematician");
  });

  it("one-way with includeNew pushes only-a entries to B", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice + headingBob);
    writeFileSync(join(ROOT_B, "entities.org"), headingAlice);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: true, includeNew: true };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.contentB).toContain("Bob");
  });
});

// ── buildSyncPair ────────────────────────────────────────────────────────────

describe("buildSyncPair", () => {
  it("resolves sub wiki as rootA and main as rootB", () => {
    const orgRoot = TMP;
    const subDir = join(TMP, "subs", "math");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(TMP, "ingest-lock.json"), '{"version":1,"files":{}}');
    const pair = buildSyncPair(orgRoot, "subs/math");
    expect(pair.rootA).toBe(subDir);
    expect(pair.rootB).toBe(orgRoot);
    expect(pair.labelA).toBe("subs/math");
    expect(pair.labelB).toBe(".");
  });

  it("resolves two sub wikis", () => {
    const orgRoot = TMP;
    const mathDir = join(TMP, "subs", "math");
    const physDir = join(TMP, "subs", "physics");
    mkdirSync(mathDir, { recursive: true });
    mkdirSync(physDir, { recursive: true });
    const pair = buildSyncPair(orgRoot, "subs/math", "subs/physics");
    expect(pair.rootA).toBe(mathDir);
    expect(pair.rootB).toBe(physDir);
  });
});

// ── apply helpers ────────────────────────────────────────────────────────────

describe("applyOrgContent", () => {
  it("writes content to destination", () => {
    applyOrgContent("hello\n", ROOT_A, "entities.org");
    expect(readFileSync(join(ROOT_A, "entities.org"), "utf8")).toBe("hello\n");
  });
});

describe("applyFileWrite", () => {
  it("copies file to destination", () => {
    const src = join(ROOT_A, "raw", "test.txt");
    writeFileSync(src, "data");
    applyFileWrite(src, ROOT_B, "raw/test.txt");
    expect(readFileSync(join(ROOT_B, "raw", "test.txt"), "utf8")).toBe("data");
  });
});

// ── parseOrgFile ──────────────────────────────────────────────────────────────

describe("parseOrgFile", () => {
  it("parses headings from an existing file", () => {
    const p = join(ROOT_A, "entities.org");
    writeFileSync(p, headingAlice);
    const headings = parseOrgFile(p);
    expect(headings).toHaveLength(1);
    expect(headings[0].title).toBe("Alice");
  });

  it("returns empty array when file does not exist", () => {
    expect(parseOrgFile(join(ROOT_A, "nonexistent.org"))).toEqual([]);
  });
});

// ── serializeHeadings (edge cases) ──────────────────────────────────────────

describe("serializeHeadings edge cases", () => {
  it("returns empty string for empty array", () => {
    expect(serializeHeadings([])).toBe("");
  });
});

// ── diffHeadings (title-based matching) ─────────────────────────────────────

const noIdAlice = `* Alice
Some content about Alice.
`;

const noIdAliceModified = `* Alice
Alice is a mathematician.
`;

const noIdBob = `* Bob
A person named Bob.
`;

describe("diffHeadings title-based", () => {
  it("matches identical headings by title when no ID", () => {
    const a = parseOrgHeadings(noIdAlice);
    const b = parseOrgHeadings(noIdAlice);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("identical");
    expect(diff[0].id).toBeNull();
  });

  it("detects modified headings by title when no ID", () => {
    const a = parseOrgHeadings(noIdAlice);
    const b = parseOrgHeadings(noIdAliceModified);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("modified");
    expect(diff[0].id).toBeNull();
  });

  it("detects only-a and only-b by title when no ID", () => {
    const a = parseOrgHeadings(noIdAlice);
    const b = parseOrgHeadings(noIdBob);
    const diff = diffHeadings(a, b);
    expect(diff).toHaveLength(2);
    expect(diff[0].kind).toBe("only-a");
    expect(diff[0].title).toBe("Alice");
    expect(diff[1].kind).toBe("only-b");
    expect(diff[1].title).toBe("Bob");
  });
});

// ── diffFiles (additional coverage) ─────────────────────────────────────────

describe("diffFiles extended", () => {
  it("detects identical raw files by hash", () => {
    writeFileSync(join(ROOT_A, "raw", "same.md"), "identical content");
    writeFileSync(join(ROOT_B, "raw", "same.md"), "identical content");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair);
    const d = diffs.find((d) => d.relPath === "raw/same.md");
    expect(d?.kind).toBe("identical");
    expect(d?.isOrgWiki).toBe(false);
  });

  it("only-a org wiki file includes headingDiff", () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, undefined, { includeNew: true });
    const d = diffs.find((d) => d.relPath === "entities.org");
    expect(d?.kind).toBe("only-a");
    expect(d?.isOrgWiki).toBe(true);
    expect(d?.headingDiff).toHaveLength(1);
    expect(d?.headingDiff![0].kind).toBe("only-a");
  });

  it("only-b org wiki file includes headingDiff", () => {
    writeFileSync(join(ROOT_B, "entities.org"), headingBob);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, undefined, { includeNew: true });
    const d = diffs.find((d) => d.relPath === "entities.org");
    expect(d?.kind).toBe("only-b");
    expect(d?.isOrgWiki).toBe(true);
    expect(d?.headingDiff).toHaveLength(1);
    expect(d?.headingDiff![0].kind).toBe("only-b");
    expect(d?.headingDiff![0].title).toBe("Bob");
  });

  it("includeNew=true includes only-b raw files", () => {
    writeFileSync(join(ROOT_B, "raw", "extra.md"), "only in B");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, undefined, { includeNew: true });
    const d = diffs.find((d) => d.relPath === "raw/extra.md");
    expect(d?.kind).toBe("only-b");
  });

  it("discovers files in nested raw subdirectories", () => {
    mkdirSync(join(ROOT_A, "raw", "sub"), { recursive: true });
    mkdirSync(join(ROOT_B, "raw", "sub"), { recursive: true });
    writeFileSync(join(ROOT_A, "raw", "sub", "deep.md"), "nested A");
    writeFileSync(join(ROOT_B, "raw", "sub", "deep.md"), "nested B");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair);
    const d = diffs.find((d) => d.relPath === "raw/sub/deep.md");
    expect(d?.kind).toBe("modified");
  });
});

// ── buildSyncPair (additional coverage) ─────────────────────────────────────

describe("buildSyncPair extended", () => {
  it("pathA='.' resolves to orgRoot", () => {
    writeFileSync(join(TMP, "ingest-lock.json"), '{"version":1,"files":{}}');
    const pair = buildSyncPair(TMP, ".");
    expect(pair.rootA).toBe(TMP);
    expect(pair.labelA).toBe(".");
  });

  it("throws on invalid wiki root path", () => {
    expect(() => buildSyncPair(TMP, "nonexistent/dir")).toThrow("Not a valid wiki root");
  });
});

// ── fileMtime ───────────────────────────────────────────────────────────────

describe("fileMtime", () => {
  it("returns mtime as Date", () => {
    const p = join(ROOT_A, "raw", "test.md");
    writeFileSync(p, "content");
    const mtime = fileMtime(p);
    expect(mtime).toBeInstanceOf(Date);
    expect(mtime.getTime()).toBeGreaterThan(0);
  });
});

// ── resolveOrgFile (missing branches) ───────────────────────────────────────

describe("resolveOrgFile extended", () => {
  it("returns null for identical files", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAlice);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).toBeNull();
  });

  it("returns null when no actionable diffs (only-a/only-b without includeNew)", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice + headingBob);
    writeFileSync(join(ROOT_B, "entities.org"), headingAlice);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    // Bob is only-a, but includeNew defaults to false → not actionable
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).toBeNull();
  });

  it("only-b with oneWay=true skips B-only headings", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAlice + headingBob);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: true, includeNew: true };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.contentA).not.toContain("Bob");
    expect(result!.contentB).toContain("Bob");
  });

  it("strategy=newest falls back to accept-a for headings", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAliceModified);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "newest", oneWay: false };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.contentA).toContain("A person named Alice");
    expect(result!.contentA).not.toContain("mathematician");
  });

  it("strategy=larger picks the longer heading", async () => {
    writeFileSync(join(ROOT_A, "entities.org"), headingAlice);
    writeFileSync(join(ROOT_B, "entities.org"), headingAliceModified);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["entities.org"]);
    const opts: SyncOptions = { interactive: false, strategy: "larger", oneWay: false };
    const result = await resolveOrgFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    // "Alice is a mathematician." (25 chars) > "A person named Alice." (21 chars)
    // B raw is longer → accept-b
    expect(result!.contentA).toContain("mathematician");
    expect(result!.contentB).toContain("mathematician");
  });
});

// ── resolveRawFile (non-interactive) ────────────────────────────────────────

describe("resolveRawFile non-interactive", () => {
  it("returns null for identical files", async () => {
    writeFileSync(join(ROOT_A, "raw", "same.md"), "same");
    writeFileSync(join(ROOT_B, "raw", "same.md"), "same");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["raw/same.md"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveRawFile(diffs[0], pair, opts);
    expect(result).toBeNull();
  });

  it("only-a copies to B", async () => {
    writeFileSync(join(ROOT_A, "raw", "only-a.md"), "content A");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diff = { kind: "only-a" as const, relPath: "raw/only-a.md", absA: join(ROOT_A, "raw", "only-a.md"), isOrgWiki: false };
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveRawFile(diff, pair, opts);
    expect(result).not.toBeNull();
    expect(result!.writeToB).toBe(diff.absA);
  });

  it("only-b with oneWay=true returns null (skip)", async () => {
    writeFileSync(join(ROOT_B, "raw", "only-b.md"), "content B");
    const diff = { kind: "only-b" as const, relPath: "raw/only-b.md", absB: join(ROOT_B, "raw", "only-b.md"), isOrgWiki: false };
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: true };
    const result = await resolveRawFile(diff, pair, opts);
    expect(result).toBeNull();
  });

  it("only-b with oneWay=false copies to A", async () => {
    writeFileSync(join(ROOT_B, "raw", "only-b.md"), "content B");
    const diff = { kind: "only-b" as const, relPath: "raw/only-b.md", absB: join(ROOT_B, "raw", "only-b.md"), isOrgWiki: false };
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveRawFile(diff, pair, opts);
    expect(result).not.toBeNull();
    expect(result!.writeToA).toBe(diff.absB);
  });

  it("modified strategy=a writes A to B", async () => {
    writeFileSync(join(ROOT_A, "raw", "mod.md"), "content A");
    writeFileSync(join(ROOT_B, "raw", "mod.md"), "content B");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["raw/mod.md"]);
    const opts: SyncOptions = { interactive: false, strategy: "a", oneWay: false };
    const result = await resolveRawFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.writeToB).toBe(diffs[0].absA);
  });

  it("modified strategy=b writes B to A", async () => {
    writeFileSync(join(ROOT_A, "raw", "mod.md"), "content A");
    writeFileSync(join(ROOT_B, "raw", "mod.md"), "content B");
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["raw/mod.md"]);
    const opts: SyncOptions = { interactive: false, strategy: "b", oneWay: false };
    const result = await resolveRawFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.writeToA).toBe(diffs[0].absB);
  });

  it("modified strategy=newest picks the newer file", async () => {
    const pathA = join(ROOT_A, "raw", "mod.md");
    const pathB = join(ROOT_B, "raw", "mod.md");
    writeFileSync(pathA, "old content");
    writeFileSync(pathB, "new content");
    // make B newer
    const future = new Date(Date.now() + 10000);
    utimesSync(pathB, future, future);
    const pair = { rootA: ROOT_A, rootB: ROOT_B, labelA: "a", labelB: "b" };
    const diffs = diffFiles(pair, ["raw/mod.md"]);
    const opts: SyncOptions = { interactive: false, strategy: "newest", oneWay: false };
    const result = await resolveRawFile(diffs[0], pair, opts);
    expect(result).not.toBeNull();
    expect(result!.writeToA).toBe(diffs[0].absB);
  });
});
