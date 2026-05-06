import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOrgHeadings, serializeHeadings } from "../org-headings.js";
import { buildSyncPair, diffFiles, diffHeadings } from "../sync-diff.js";
import { applyOrgContent, applyFileWrite, resolveOrgFile, type SyncOptions } from "../sync-resolve.js";

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
