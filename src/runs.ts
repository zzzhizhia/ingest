import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function stateDir(): string {
  // `||` (not `??`) so an explicitly-empty `XDG_STATE_HOME=` falls back to the
  // default. An empty string would produce a CWD-relative "ingest" path.
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "ingest",
  );
}

function runsFile(): string {
  return join(stateDir(), "runs.json");
}

// ── types ─────────────────────────────────────────────────────────────────────

export type RunStatus = "in-progress" | "completed" | "interrupted";

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  wikiRoot: string;
  mainSessionId?: string;
}

export interface RunsFile {
  version: number;
  runs: RunRecord[];
}

// ── ulid (Crockford base32, 48-bit ms timestamp + 80-bit randomness) ─────────

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(now: number): string {
  let out = "";
  let n = now;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 16; i++) {
    const mod = Number(bits & 31n);
    out = CROCKFORD[mod] + out;
    bits >>= 5n;
  }
  return out;
}

export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom();
}

// ── persistence ───────────────────────────────────────────────────────────────

export function runsPath(): string {
  return runsFile();
}

export function readRuns(): RunsFile {
  const p = runsFile();
  if (!existsSync(p)) return { version: 1, runs: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new Error(`invalid JSON in ${p}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${p}: expected object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    throw new Error(`${p}: missing or invalid "version" field`);
  }
  if (!Array.isArray(obj.runs)) {
    throw new Error(`${p}: missing or invalid "runs" field`);
  }
  return raw as RunsFile;
}

function persist(runs: RunsFile): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(runsFile(), JSON.stringify(runs, null, 2) + "\n", "utf8");
}

export function addRun(rec: RunRecord): RunRecord {
  const file = readRuns();
  file.runs.push(rec);
  persist(file);
  return rec;
}

export function updateRun(id: string, patch: Partial<RunRecord>): void {
  const file = readRuns();
  const idx = file.runs.findIndex((r) => r.id === id);
  if (idx < 0) {
    throw new Error(`run ${id} not found in ${runsFile()}`);
  }
  file.runs[idx] = { ...file.runs[idx], ...patch };
  persist(file);
}

/**
 * Persist a run-state transition with a single helper. Replaces the
 * 3-line `try { updateRun(...) } catch {}` pattern that was duplicated
 * across cmdIngest and cmdResume. Errors are silently swallowed -- a
 * failed disk write must not crash the calling flow; the worst case is
 * a stale runs.json entry that `findLatestResumable` will eventually
 * drop via the mainSessionId filter.
 *
 * @param opts.mainSessionId       When set (and non-empty), include the
 *                                 value in the patch. Empty/undefined
 *                                 values are dropped, preserving any
 *                                 existing mainSessionId.
 * @param opts.clearMainSessionId  When true, explicitly include
 *                                 `mainSessionId: undefined` in the
 *                                 patch, so the JSON serialization
 *                                 drops the field. Use this when the
 *                                 run can no longer be resumed (e.g.
 *                                 the fix loop was exhausted).
 */
export function setRunStatus(
  runId: string,
  status: RunStatus,
  opts?: { mainSessionId?: string; clearMainSessionId?: boolean },
): void {
  try {
    const patch: Partial<RunRecord> = {
      status,
      finishedAt: new Date().toISOString(),
    };
    if (opts?.clearMainSessionId) {
      patch.mainSessionId = undefined;
    } else if (opts?.mainSessionId) {
      patch.mainSessionId = opts.mainSessionId;
    }
    updateRun(runId, patch);
  } catch {}
}

export function getRun(id: string): RunRecord | undefined {
  return readRuns().runs.find((r) => r.id === id);
}

/**
 * Returns the most recent in-progress or interrupted run for the given wiki.
 * `in-progress` ranks above `interrupted` (a live run should be preferred
 * over a stale interruption record). Within each status, sort by startedAt
 * descending.
 *
 * Runs without a `mainSessionId` are excluded — without it the claude
 * `--resume` call has nothing to attach to, so the run cannot actually be
 * resumed. Re-run `ingest` to start a fresh session for the remaining
 * pending files.
 */
export function findLatestResumable(wikiRoot?: string): RunRecord | undefined {
  const all = readRuns().runs;
  const resumable = all.filter(
    (r) =>
      (r.status === "in-progress" || r.status === "interrupted") &&
      r.mainSessionId != null &&
      r.mainSessionId !== "" &&
      (wikiRoot === undefined || r.wikiRoot === wikiRoot),
  );
  if (resumable.length === 0) return undefined;
  const rank: Record<RunStatus, number> = { "in-progress": 0, interrupted: 1, completed: 2 };
  resumable.sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    // ISO-8601 is lexically sortable; avoid localeCompare's per-call locale lookup
    return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;
  });
  return resumable[0];
}
