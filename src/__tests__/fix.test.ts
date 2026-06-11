import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSafeFixes } from "../fix.js";

const TMP = join(import.meta.dirname, "__tmp_fix__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function writeFile(name: string, lines: string[]): void {
  writeFileSync(join(TMP, name), lines.join("\n") + "\n");
}

function readLines(name: string): string[] {
  return readFileSync(join(TMP, name), "utf8").split("\n");
}

describe("runSafeFixes — tag-file mismatch", () => {
  it("rewrites wrong tag in entities.org to :entity:", () => {
    writeFile("entities.org", [
      "* Foo Person                                                       :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", []);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].kind).toBe("tag-mismatch");
    expect(result.applied[0].file).toBe("entities.org");

    const lines = readLines("entities.org");
    expect(lines[0]).toMatch(/:entity:\s*$/);
    expect(lines[0]).not.toMatch(/:concept:/);
  });

  it("leaves correctly-tagged headings untouched", () => {
    writeFile("entities.org", [
      "* Foo Person                                                       :entity:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", []);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(0);
  });

  it("does not invent a tag block for headings missing one", () => {
    writeFile("entities.org", [
      "* Foo Person",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", []);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(0);
    const lines = readLines("entities.org");
    expect(lines[0]).toBe("* Foo Person");
  });
});

describe("runSafeFixes — broken link", () => {
  it("repairs broken id link with unique title match", () => {
    writeFile("entities.org", [
      "* Alice                                                            :entity:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", [
      "* SomeConcept                                                      :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000002",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "Refers to [[id:9999][Alice]] as a known person.",
      "",
    ]);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].kind).toBe("broken-link");

    const concepts = readLines("concepts.org");
    expect(concepts.some((l) => l.includes("[[id:20260101T000001][Alice]]"))).toBe(true);
    expect(concepts.some((l) => l.includes("id:9999"))).toBe(false);
  });

  it("leaves broken links with no title match alone", () => {
    writeFile("entities.org", []);
    writeFile("concepts.org", [
      "* Page                                                             :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "Refers to [[id:9999][Nonexistent Person]].",
      "",
    ]);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(0);
  });

  it("leaves broken links with multiple title matches alone", () => {
    writeFile("entities.org", [
      "* Smith                                                            :entity:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", [
      "* Smith                                                            :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000002",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "Refers to [[id:9999][Smith]].",
      "",
    ]);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(0);
  });

  it("leaves valid links untouched", () => {
    writeFile("entities.org", [
      "* Alice                                                            :entity:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", [
      "* Page                                                             :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000002",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "Refers to [[id:20260101T000001][Alice]].",
      "",
    ]);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied).toHaveLength(0);
  });
});

describe("runSafeFixes — combined", () => {
  it("applies tag fix and link fix in one pass", () => {
    writeFile("entities.org", [
      "* Alice                                                            :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
    ]);
    writeFile("concepts.org", [
      "* Page                                                             :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000002",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "Refers to [[id:9999][Alice]].",
      "",
    ]);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    const kinds = result.applied.map((a) => a.kind).sort();
    expect(kinds).toEqual(["broken-link", "tag-mismatch"]);

    const ent = readLines("entities.org");
    expect(ent[0]).toMatch(/:entity:\s*$/);
    const con = readLines("concepts.org");
    expect(con.some((l) => l.includes("[[id:20260101T000001][Alice]]"))).toBe(true);
  });
});

describe("runSafeFixes — duplicate :ID:", () => {
  it("drops the second copy of a duplicated heading, keeping the first", () => {
    const block = [
      "* Dup Heading                                                      :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000010",
      ":DATE:     [2026-01-01]",
      ":SOURCES:  raw/a.md",
      ":END:",
      "",
      "** Content",
      "shared body",
      "",
    ];
    writeFile("concepts.org", [
      "* Other Heading                                                    :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000001",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      ...block,
      ...block,
    ]);
    writeFile("entities.org", []);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied.some((a) => a.kind === "duplicate-id")).toBe(true);

    const lines = readLines("concepts.org");
    const idCount = lines.filter((l) => l.includes(":ID:       20260101T000010")).length;
    expect(idCount).toBe(1);
    expect(lines.filter((l) => l.startsWith("* Dup Heading")).length).toBe(1);
  });

  it("drops all but the first copy when a heading is triplicated", () => {
    const block = [
      "* Triplicate                                                       :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000020",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "body",
      "",
    ];
    writeFile("concepts.org", [...block, ...block, ...block]);
    writeFile("entities.org", []);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    const dedupFixes = result.applied.filter((a) => a.kind === "duplicate-id");
    expect(dedupFixes).toHaveLength(2);

    const lines = readLines("concepts.org");
    expect(lines.filter((l) => l.includes(":ID:       20260101T000020")).length).toBe(1);
  });

  it("leaves single-occurrence headings alone", () => {
    writeFile("concepts.org", [
      "* Solo                                                             :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000030",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "unique body",
      "",
    ]);
    writeFile("entities.org", []);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied.some((a) => a.kind === "duplicate-id")).toBe(false);
  });

  it("keeps the first occurrence and drops cross-file duplicates", () => {
    writeFile("concepts.org", [
      "* In Concepts                                                      :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000040",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "first",
      "",
    ]);
    writeFile("entities.org", [
      "* In Entities                                                      :entity:",
      ":PROPERTIES:",
      ":ID:       20260101T000040",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "second",
      "",
    ]);
    writeFile("sources.org", []);
    writeFile("analyses.org", []);

    const result = runSafeFixes(TMP);
    expect(result.applied.some((a) => a.kind === "duplicate-id")).toBe(true);

    const con = readLines("concepts.org");
    const ent = readLines("entities.org");
    expect(con.filter((l) => l.includes(":ID:       20260101T000040")).length).toBe(1);
    expect(ent.filter((l) => l.includes(":ID:       20260101T000040")).length).toBe(0);
  });
});
