import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdShow } from "../show.js";

const TMP = join(import.meta.dirname, "__tmp_show__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function seed(name: string, content: string): void {
  writeFileSync(join(TMP, name), content);
}

function fixtureWiki(): void {
  seed(
    "entities.org",
    `* Alice                                                            :entity:
:PROPERTIES:
:ID:       20260101T000001
:DATE:     [2026-01-01]
:END:

** Overview

Alice knows [[id:20260101T000002][Bob]].
`,
  );
  seed(
    "concepts.org",
    `* Machine Learning                                                 :concept:
:PROPERTIES:
:ID:       20260101T000003
:DATE:     [2026-01-01]
:END:

A subset of AI.
`,
  );
  seed("sources.org", "");
  seed("analyses.org", "");
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

function withMockExit(fn: () => void): { error: Error | null; code: number | null } {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new Error(`exit:${code ?? ""}`);
  });
  let error: Error | null = null;
  let code: number | null = null;
  try {
    fn();
  } catch (e) {
    error = e as Error;
    const match = error.message.match(/^exit:(.*)$/);
    if (match && match[1] !== "") code = Number(match[1]);
  } finally {
    mockExit.mockRestore();
  }
  return { error, code };
}

describe("cmdShow", () => {
  it("prints the raw org block for a matching ID", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdShow(TMP, ["show", "20260101T000001"]));
    expect(out).toContain("entities.org  20260101T000001");
    expect(out).toContain("* Alice");
    expect(out).toContain(":ID:       20260101T000001");
    expect(out).toContain("Alice knows");
  });

  it("finds IDs in concepts.org", () => {
    fixtureWiki();
    const out = captureStdout(() => cmdShow(TMP, ["show", "20260101T000003"]));
    expect(out).toContain("concepts.org  20260101T000003");
    expect(out).toContain("* Machine Learning");
  });

  it("exits 1 when ID is missing", () => {
    fixtureWiki();
    const { error, code } = withMockExit(() => cmdShow(TMP, ["show", "99999999T999999"]));
    expect(error).not.toBeNull();
    expect(code).toBe(1);
  });

  it("exits 1 when no id is provided", () => {
    fixtureWiki();
    const { error, code } = withMockExit(() => cmdShow(TMP, ["show"]));
    expect(error).not.toBeNull();
    expect(code).toBe(1);
  });
});
