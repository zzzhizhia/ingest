import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdGrep } from "../grep.js";

const TMP = join(import.meta.dirname, "__tmp_grep__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function seed(name: string, lines: string[]): void {
  writeFileSync(join(TMP, name), lines.join("\n") + "\n");
}

function fixtureWiki(): void {
  seed("entities.org", [
    "* Alice                                                            :entity:",
    ":PROPERTIES:",
    ":ID:       20260101T000001",
    ":END:",
    "",
    "Alice is a researcher.",
    "",
    "* Bob                                                              :entity:",
    ":PROPERTIES:",
    ":ID:       20260101T000002",
    ":END:",
    "",
    "Bob is an engineer.",
    "",
  ]);
  seed("concepts.org", [
    "* Alice in Wonderland                                              :concept:",
    ":PROPERTIES:",
    ":ID:       20260101T000003",
    ":END:",
    "",
    "A famous novel.",
    "",
  ]);
  seed("sources.org", []);
  seed("analyses.org", []);
}

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stdout.write;
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

describe("cmdGrep", () => {
  it("outputs full page for exact title match", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdGrep(TMP, ["grep", "Bob"]));
    expect(out).toContain("* Bob");
    expect(out).toContain(":ID: 20260101T000002");
    expect(out).toContain("Bob is an engineer.");
  });

  it("matches case-insensitively", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdGrep(TMP, ["grep", "bob"]));
    expect(out).toContain("* Bob");
  });

  it("returns multiple matches for partial pattern", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdGrep(TMP, ["grep", "Alice"]));
    expect(out).toContain(":ID: 20260101T000001");
    expect(out).toContain(":ID: 20260101T000003");
  });

  it("supports regex patterns", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdGrep(TMP, ["grep", "^Bob$"]));
    expect(out).toContain(":ID: 20260101T000002");
    expect(out).not.toContain("20260101T000001");
  });

  it("includes tags in output", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdGrep(TMP, ["grep", "Bob"]));
    expect(out).toContain(":entity:");
  });

  it("exits 1 when no match found", () => {
    fixtureWiki();
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    expect(() => cmdGrep(TMP, ["grep", "zzz_no_match"])).toThrow("exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("exits 1 when no pattern given", () => {
    fixtureWiki();
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    expect(() => cmdGrep(TMP, ["grep"])).toThrow("exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});
