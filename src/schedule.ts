import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import pc from "picocolors";

const STATE_HOME =
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
const STATE_DIR = join(STATE_HOME, "ingest");
const LOG_DIR = join(STATE_DIR, "logs");
const JOBS_FILE = join(STATE_DIR, "jobs.json");

// ── job tracking ──────────────────────────────────────────────────────────────

interface Job {
  pid: number;
  wiki: string;
  args: string[];
  scheduledAt: string;
  executeAt: string;
  log: string;
}

function loadJobs(): Job[] {
  if (!existsSync(JOBS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(JOBS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveJobs(jobs: Job[]): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2) + "\n");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pruneJobs(): Job[] {
  const alive = loadJobs().filter((j) => isAlive(j.pid));
  saveJobs(alive);
  return alive;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function findIngestBin(): string {
  try {
    return execFileSync("which", ["ingest"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return resolve(process.argv[1]);
  }
}

export function parseDelay(val: string): number | null {
  const timeMatch = val.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (hour > 23 || minute > 59) return null;
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return Math.ceil((target.getTime() - now.getTime()) / 1000);
  }

  const durMatch = val.match(/^(\d+)(m|h)?$/);
  if (!durMatch) return null;
  const num = parseInt(durMatch[1], 10);
  if (num < 1) return null;
  return (durMatch[2] ?? "m") === "h" ? num * 3600 : num * 60;
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.ceil(seconds / 60)}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── defer ─────────────────────────────────────────────────────────────────────

export function deferIngest(
  orgRoot: string,
  seconds: number,
  forwardArgs: string[],
): void {
  const bin = findIngestBin();

  mkdirSync(LOG_DIR, { recursive: true });
  const ts = Date.now();
  const logFile = join(LOG_DIR, `at-${ts}.log`);
  const logFd = openSync(logFile, "a");

  const quoted = forwardArgs.map((a) => `"${a}"`).join(" ");
  const cleanup = `_PID=$$ node -e 'var f=require("fs"),p=process.env._JOBS,j=JSON.parse(f.readFileSync(p));f.writeFileSync(p,JSON.stringify(j.filter(function(x){return x.pid!==+process.env._PID})))'`;
  const cmd = `sleep ${seconds} && "${bin}" ${quoted}; ${cleanup}`;

  const child = spawn("sh", ["-c", cmd], {
    cwd: orgRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, _JOBS: JOBS_FILE },
  });
  child.unref();
  closeSync(logFd);

  const now = new Date();
  const target = new Date(now.getTime() + seconds * 1000);

  const jobs = loadJobs().filter((j) => isAlive(j.pid));
  jobs.push({
    pid: child.pid!,
    wiki: orgRoot,
    args: forwardArgs,
    scheduledAt: now.toISOString(),
    executeAt: target.toISOString(),
    log: logFile,
  });
  saveJobs(jobs);

  const timeStr = formatTime(target.toISOString());
  console.log(
    pc.green("✓") +
      ` ingest scheduled at ${timeStr} (${formatDuration(seconds)})`,
  );
  console.log(pc.dim(`  pid:  ${child.pid}`));
  console.log(pc.dim(`  logs: ${logFile}`));
}

// ── schedule management ───────────────────────────────────────────────────────

function scheduleList(): void {
  const jobs = pruneJobs();
  if (jobs.length === 0) {
    console.log(pc.dim("no pending jobs"));
    return;
  }
  for (const j of jobs) {
    const remaining = Math.max(
      0,
      Math.ceil((new Date(j.executeAt).getTime() - Date.now()) / 1000),
    );
    const status =
      remaining > 0
        ? pc.dim(`in ${formatDuration(remaining)}`)
        : pc.yellow("running");
    console.log(
      `${pc.green("●")} ${j.pid}  ${formatTime(j.executeAt)}  ${status}  ${pc.dim(basename(j.wiki))}`,
    );
  }
}

function scheduleCancel(positional: string[]): void {
  const jobs = pruneJobs();
  if (jobs.length === 0) {
    console.log(pc.dim("no pending jobs"));
    return;
  }

  const pids = positional.slice(2).map((p) => parseInt(p, 10));
  const toCancel =
    pids.length > 0
      ? jobs.filter((j) => pids.includes(j.pid))
      : jobs;

  if (toCancel.length === 0) {
    console.error(pc.red("✗") + ` no matching jobs`);
    process.exit(1);
  }

  const cancelled = new Set<number>();
  for (const j of toCancel) {
    try {
      process.kill(j.pid);
      cancelled.add(j.pid);
    } catch {}
  }

  saveJobs(jobs.filter((j) => !cancelled.has(j.pid)));
  console.log(
    pc.green("✓") +
      ` cancelled ${cancelled.size} job${cancelled.size === 1 ? "" : "s"}`,
  );
}

export function cmdSchedule(positional: string[]): void {
  const sub = positional[1];

  if (!sub || sub === "list") return scheduleList();
  if (sub === "cancel") return scheduleCancel(positional);

  console.error(pc.red("✗") + ` unknown schedule command: ${sub}`);
  console.error(pc.dim("  available: list, cancel [pid]"));
  process.exit(1);
}
