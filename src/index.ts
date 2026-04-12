import { checkbox } from "@inquirer/prompts";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { readLock, writeLockEntry } from "./lock.js";
import { scanPendingFiles, type PendingFile } from "./scanner.js";

// ── withQuit ──────────────────────────────────────────────────────────────────

function withQuit<C, T>(
  prompt: (config: C, context?: { signal?: AbortSignal }) => Promise<T>,
  config: C,
): Promise<T> {
  const ac = new AbortController();
  const onData = (chunk: Buffer) => {
    if (chunk.toString() === "q") ac.abort();
  };
  process.stdin.on("data", onData);
  return prompt(config, { signal: ac.signal }).finally(() => {
    process.stdin.off("data", onData);
  });
}

// ── org root detection ────────────────────────────────────────────────────────

function findOrgRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "raw")) && existsSync(join(dir, "CLAUDE.md"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error(
        "Could not find org root (directory with raw/ and CLAUDE.md). " +
          "Run org-ingest from inside your org directory.",
      );
    }
    dir = parent;
  }
}

// ── claude invocation ─────────────────────────────────────────────────────────

// Minimum tools needed: read files, edit wiki files, check date/git state.
// Git commit and lock update are handled by this package — not Claude.
const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Bash(date *)",
  "Bash(date)",
  "Bash(grep *)",
  "Bash(git status)",
  "Bash(git log *)",
].join(",");

function buildPrompt(file: string): string {
  return (
    `按 CLAUDE.md § 3.1 消化工作流，执行步骤 1-8 并更新 summary.org` +
    `（步骤 9 中的 3.0.1 仪表盘和 3.0.2 日志部分），` +
    `不要 git commit，不要运行 update-lock.js。消化以下源文件：\n\n${file}`
  );
}

function runClaude(orgRoot: string, file: string): boolean {
  const result = spawnSync(
    "claude",
    [
      "-p",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      ALLOWED_TOOLS,
      buildPrompt(file),
    ],
    { cwd: orgRoot, stdio: ["ignore", "inherit", "inherit"] },
  );
  return result.status === 0;
}

// ── git helpers ───────────────────────────────────────────────────────────────

function gitPull(orgRoot: string): void {
  execFileSync("git", ["pull", "--ff-only"], { cwd: orgRoot, stdio: "inherit" });
}

function gitPush(orgRoot: string): void {
  execFileSync("git", ["push"], { cwd: orgRoot, stdio: "inherit" });
}

// ── git commit ────────────────────────────────────────────────────────────────

const WIKI_FILES = [
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
  "summary.org",
  ".ingest-lock.json",
];

function commitIngest(orgRoot: string, file: string): void {
  const hasChanges =
    execFileSync("git", ["status", "--porcelain", ...WIKI_FILES], {
      cwd: orgRoot,
    })
      .toString()
      .trim().length > 0;

  if (!hasChanges) return;

  execFileSync("git", ["add", ...WIKI_FILES], { cwd: orgRoot });
  execFileSync(
    "git",
    ["commit", "-m", `[ingest] ${basename(file)}`],
    { cwd: orgRoot },
  );
}

// ── interactive selection ─────────────────────────────────────────────────────

function formatChoice(f: PendingFile) {
  const badge = f.status === "new" ? pc.green("+") : pc.yellow("~");
  return {
    name: `${badge} ${pc.bold(f.rel)}\n  ${pc.dim(f.status === "new" ? "new file" : "content changed")}`,
    value: f.rel,
    short: f.rel,
  };
}

async function selectFiles(pending: PendingFile[]): Promise<string[]> {
  return withQuit(checkbox, {
    message: `Select files to ingest  ${pc.dim("(space: toggle, a: all, enter: confirm, q: quit)")}`,
    choices: pending.map(formatChoice),
    pageSize: 25,
    loop: false,
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const orgRoot = findOrgRoot(process.cwd());

  gitPull(orgRoot);

  const explicitFiles = process.argv.slice(2);

  let toIngest: string[];

  if (explicitFiles.length > 0) {
    // Non-interactive: ingest specified files directly
    toIngest = explicitFiles;
  } else {
    const lock = readLock(orgRoot);
    const pending = scanPendingFiles(orgRoot, lock);

    if (pending.length === 0) {
      console.log(pc.green("✓") + " raw/ 下所有文件均已消化且内容未变");
      return;
    }

    console.log(
      pc.bold(`\n${pending.length} 个文件待消化`) +
        pc.dim("  (org: " + orgRoot + ")\n"),
    );

    toIngest = await selectFiles(pending);

    if (toIngest.length === 0) {
      console.log(pc.dim("已跳过"));
      return;
    }
  }

  console.log();
  let failed = 0;

  for (const file of toIngest) {
    console.log("─".repeat(60));
    console.log(pc.bold("▶") + " " + file + "\n");

    const ok = runClaude(orgRoot, file);

    if (ok) {
      writeLockEntry(orgRoot, file, []);
      try {
        commitIngest(orgRoot, file);
        console.log("\n" + pc.green("✓") + " 完成");
      } catch (e) {
        console.warn(pc.yellow("⚠") + " git commit 失败:", (e as Error).message);
      }
    } else {
      console.error("\n" + pc.red("✗") + " Claude 退出非零");
      failed++;
    }

    console.log();
  }

  if (failed > 0) {
    console.error(pc.red(`${failed} 个文件消化失败`));
    process.exit(1);
  }

  gitPush(orgRoot);
}

// ── entry guard ───────────────────────────────────────────────────────────────

const currentFile = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] != null &&
  resolve(realpathSync(process.argv[1])) === currentFile;

if (isDirectRun) {
  main().catch((err) => {
    if (err?.name === "ExitPromptError") process.exit(0);
    console.error(err.message ?? err);
    process.exit(1);
  });
}
