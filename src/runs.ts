import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function stateDir(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
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

export function getRun(id: string): RunRecord | undefined {
  return readRuns().runs.find((r) => r.id === id);
}

/**
 * Returns the most recent in-progress or interrupted run for the given wiki.
 * `in-progress` ranks above `interrupted` (a live run should be preferred
 * over a stale interruption record). Within each status, sort by startedAt
 * descending.
 */
export function findLatestResumable(wikiRoot?: string): RunRecord | undefined {
  const all = readRuns().runs;
  const resumable = all.filter(
    (r) =>
      (r.status === "in-progress" || r.status === "interrupted") &&
      (wikiRoot === undefined || r.wikiRoot === wikiRoot),
  );
  if (resumable.length === 0) return undefined;
  const rank: Record<RunStatus, number> = { "in-progress": 0, interrupted: 1, completed: 2 };
  resumable.sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    return b.startedAt.localeCompare(a.startedAt);
  });
  return resumable[0];
}
