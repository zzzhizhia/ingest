import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRun,
  findLatestResumable,
  getRun,
  readRuns,
  type RunRecord,
  runsPath,
  ulid,
  updateRun,
} from "../runs.js";

const TMP = join(tmpdir(), "ingest-runs-test-" + Math.random().toString(36).slice(2, 8));

beforeEach(() => {
  process.env.XDG_STATE_HOME = TMP;
  mkdirSync(join(TMP, "ingest"), { recursive: true });
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.XDG_STATE_HOME;
});

describe("ulid", () => {
  it("returns 26 Crockford base32 chars", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is roughly monotonic across calls in the same ms", () => {
    const a = ulid();
    const b = ulid();
    // same time prefix, suffix differs
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a.slice(10)).not.toBe(b.slice(10));
  });
});

describe("runsPath", () => {
  it("honors XDG_STATE_HOME", () => {
    expect(runsPath()).toBe(join(TMP, "ingest", "runs.json"));
  });
});

describe("readRuns", () => {
  it("returns empty when file does not exist", () => {
    expect(readRuns()).toEqual({ version: 1, runs: [] });
  });

  it("parses an existing file", () => {
    const data = {
      version: 1,
      runs: [
        {
          id: "01HXY",
          startedAt: "2026-06-11T00:00:00.000Z",
          status: "completed",
          wikiRoot: "/x",
        },
      ],
    };
    writeFileSync(runsPath(), JSON.stringify(data));
    expect(readRuns()).toEqual(data);
  });

  it("throws on invalid JSON", () => {
    writeFileSync(runsPath(), "{not json");
    expect(() => readRuns()).toThrow(/invalid JSON/);
  });

  it("throws when runs is not an array", () => {
    writeFileSync(runsPath(), JSON.stringify({ version: 1, runs: {} }));
    expect(() => readRuns()).toThrow(/runs/);
  });
});

describe("addRun / updateRun", () => {
  it("accumulates records", () => {
    addRun({ id: "a", startedAt: "2026-01-01T00:00:00.000Z", status: "in-progress", wikiRoot: "/w" });
    addRun({ id: "b", startedAt: "2026-01-02T00:00:00.000Z", status: "completed", wikiRoot: "/w" });
    expect(readRuns().runs.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("updateRun merges fields", () => {
    addRun({ id: "a", startedAt: "2026-01-01T00:00:00.000Z", status: "in-progress", wikiRoot: "/w" });
    updateRun("a", { mainSessionId: "sess-1", status: "completed", finishedAt: "2026-01-01T00:01:00.000Z" });
    expect(getRun("a")).toEqual({
      id: "a",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      wikiRoot: "/w",
      mainSessionId: "sess-1",
      finishedAt: "2026-01-01T00:01:00.000Z",
    });
  });

  it("updateRun throws on unknown id", () => {
    expect(() => updateRun("nope", { status: "completed" })).toThrow(/nope/);
  });
});

describe("getRun", () => {
  it("returns undefined for unknown id", () => {
    expect(getRun("missing")).toBeUndefined();
  });
});

describe("findLatestResumable", () => {
  function rec(over: Partial<RunRecord>): RunRecord {
    return {
      id: ulid(),
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "in-progress",
      wikiRoot: "/w",
      ...over,
    };
  }

  it("returns undefined when no resumable runs", () => {
    addRun(rec({ status: "completed" }));
    expect(findLatestResumable("/w")).toBeUndefined();
  });

  it("filters by wikiRoot", () => {
    addRun(rec({ wikiRoot: "/other", status: "interrupted" }));
    addRun(rec({ wikiRoot: "/w", status: "interrupted" }));
    expect(findLatestResumable("/w")?.wikiRoot).toBe("/w");
  });

  it("prefers in-progress over interrupted", () => {
    const a = rec({ status: "interrupted", startedAt: "2026-01-02T00:00:00.000Z" });
    const b = rec({ status: "in-progress", startedAt: "2026-01-01T00:00:00.000Z" });
    addRun(a);
    addRun(b);
    expect(findLatestResumable()?.id).toBe(b.id);
  });

  it("sorts by startedAt desc within the same status", () => {
    const older = rec({ status: "interrupted", startedAt: "2026-01-01T00:00:00.000Z" });
    const newer = rec({ status: "interrupted", startedAt: "2026-01-02T00:00:00.000Z" });
    addRun(older);
    addRun(newer);
    expect(findLatestResumable()?.id).toBe(newer.id);
  });
});
