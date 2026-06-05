import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRealBrokenIds, runSafeFixes } from "../fix.js";

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

describe("findRealBrokenIds", () => {
  function setupWiki(files: Record<string, string[]>): void {
    for (const [name, lines] of Object.entries(files)) writeFile(name, lines);
    for (const name of ["entities.org", "concepts.org", "sources.org", "analyses.org"]) {
      if (!(name in files)) writeFile(name, []);
    }
  }

  it("returns reported IDs that are missing from the wiki", () => {
    setupWiki({
      "entities.org": [
        "* Alice                                                            :entity:",
        ":PROPERTIES:",
        ":ID:       20260101T000001",
        ":DATE:     [2026-01-01]",
        ":END:",
        "",
      ],
    });
    const err = [
      "pre-commit: hook failed",
      "LINK: broken id:9999 in entities.org (no heading with :ID: 9999)",
      "LINK: broken id:8888 in concepts.org (no heading with :ID: 8888)",
    ].join("\n");
    const real = findRealBrokenIds(err, TMP);
    expect(real).toHaveLength(2);
    expect(real).toContainEqual({ id: "9999", file: "entities.org" });
    expect(real).toContainEqual({ id: "8888", file: "concepts.org" });
  });

  it("returns empty when every reported broken ID is actually valid (the bug scenario)", () => {
    setupWiki({
      "entities.org": [
        "* Alice                                                            :entity:",
        ":PROPERTIES:",
        ":ID:       20260101T000001",
        ":DATE:     [2026-01-01]",
        ":END:",
        "",
      ],
      "concepts.org": [
        "* Page                                                             :concept:",
        ":PROPERTIES:",
        ":ID:       20260101T000002",
        ":DATE:     [2026-01-01]",
        ":END:",
        "",
      ],
    });
    const err = [
      "pre-commit: hook failed",
      "LINK: broken id:20260101T000001 in entities.org (no heading with :ID: 20260101T000001)",
      "LINK: broken id:20260101T000002 in concepts.org (no heading with :ID: 20260101T000002)",
    ].join("\n");
    expect(findRealBrokenIds(err, TMP)).toEqual([]);
  });

  it("returns only the real broken IDs when error mixes valid and invalid", () => {
    setupWiki({
      "entities.org": [
        "* Alice                                                            :entity:",
        ":PROPERTIES:",
        ":ID:       20260101T000001",
        ":DATE:     [2026-01-01]",
        ":END:",
        "",
      ],
    });
    const err = [
      "LINK: broken id:20260101T000001 in entities.org (no heading with :ID: 20260101T000001)",
      "LINK: broken id:9999 in entities.org (no heading with :ID: 9999)",
    ].join("\n");
    expect(findRealBrokenIds(err, TMP)).toEqual([{ id: "9999", file: "entities.org" }]);
  });

  it("returns empty when error has no LINK: broken id: lines (other error type)", () => {
    setupWiki({});
    expect(findRealBrokenIds("ERROR: missing tag in entities.org:5", TMP)).toEqual([]);
  });

  it("returns empty for empty error string", () => {
    expect(findRealBrokenIds("", TMP)).toEqual([]);
  });

  it("ignores malformed LINK: broken id: lines with no id or file", () => {
    setupWiki({});
    const err = "LINK: broken id: in entities.org\nLINK: broken id:9999";
    expect(findRealBrokenIds(err, TMP)).toEqual([]);
  });

  it("ignores unrelated noise and only parses LINK: broken id: lines", () => {
    setupWiki({});
    const err = [
      "pre-commit: starting",
      "  checking entities.org...",
      "LINK: broken id:1234 in entities.org (no heading with :ID: 1234)",
      "  done in 0.2s",
    ].join("\n");
    expect(findRealBrokenIds(err, TMP)).toEqual([{ id: "1234", file: "entities.org" }]);
  });

  it("does not match the explanatory tail '(no heading with :ID: XXX)'", () => {
    setupWiki({});
    expect(findRealBrokenIds("(no heading with :ID: 9999)", TMP)).toEqual([]);
  });
});
