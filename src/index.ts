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

const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Bash(date *)",
  "Bash(date)",
  "Bash(grep *)",
  "Bash(git status)",
  "Bash(git log *)",
].join(",");

// Self-contained ingest system prompt — no dependency on CLAUDE.md.
const SYSTEM_PROMPT = `\
你是一个 org-mode 知识库的消化引擎。将源文件内容提取并写入以下 wiki 分类文件：

## Wiki 文件

- entities.org   — 实体（人物、组织、产品、地点），每页标签 :entity:
- concepts.org   — 概念（理念、理论、框架、方法），每页标签 :concept:
- sources.org    — 单篇源材料摘要，每页标签 :source:
- analyses.org   — 综合分析，每页标签 :analysis:
- summary.org    — 元文件，包含仪表盘统计和日志，末尾追加条目

## 页面模板（每个顶级 heading 必须遵循）

\`\`\`org
* 页面标题                                                       :TAG:
:PROPERTIES:
:ID:       YYYYMMDDTHHMMSS
:DATE:     [YYYY-MM-DD]
:SOURCES:  raw/path/to/source.ext
:END:

** 概述

一段话定义或摘要。

** 内容

主体内容，按子主题分 heading。
每个事实声明附来源标注：
  [source: raw/path/to/file.org § 章节名 | HIGH]

置信度：HIGH = 直接引用，MED = 摘要推断，LOW = 跨源综合

** 矛盾

:PROPERTIES:
:CONTRADICTS: id:ID1, id:ID2
:END:

（仅在存在矛盾时填写）
- 与 [[id:IDENTIFIER][页面标题]] 矛盾：说明

** 交叉引用

- [[id:IDENTIFIER][页面标题]] — 关系描述
\`\`\`

## ID 生成

运行 \`date +%Y%m%dT%H%M%S\` 获取当前时间戳作为 :ID:。同秒内多个 ID 递增 1 秒。

## 链接格式

\`[[id:YYYYMMDDTHHMMSS][显示文本]]\`

## 消化步骤（每个源文件依次执行）

1. 用 Read 工具读取源文件。文件 > 200KB 分段读取。
2. 验证：文件不存在或为空则跳过并报告。
3. 检查重复：\`grep -l "SOURCES:.*{path}" entities.org concepts.org sources.org analyses.org\`
   — 找到则 re-ingest（合并更新），否则新建。
4. 提取：实体、概念、关键论点，记录每个论点所在章节。
5. 匹配已有 heading：\`grep -n "^\\* .*{name}" entities.org concepts.org sources.org analyses.org\`
   — 匹配则更新，否则在对应文件末尾追加新 heading。
6. 写入页面：按模板写内容，每条论点带来源标注和置信度，添加交叉引用。
7. 检查矛盾：与已有 wiki 内容比对，发现矛盾则在双方页面都标注 :CONTRADICTS:。

## 完成所有文件后

更新 summary.org：
- 仪表盘：统计各分类文件的 heading 数量（\`grep -c "^\\* " *.org\`），更新数字。
- 日志：在当前月份标题下追加一行：\`** [YYYY-MM-DD DDD] ingest | 标题 | +N ~M\`

## 禁止事项

- 不执行 git commit
- 不运行 update-lock.js 或任何 lock 相关操作
- 不读取或依赖 CLAUDE.md
`;

function buildPrompt(files: string[]): string {
  const list = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
  return (
    `依次消化以下 ${files.length} 个源文件，每个文件完整执行消化步骤后再处理下一个，` +
    `全部完成后统一更新 summary.org。\n\n${list}`
  );
}

function runClaude(orgRoot: string, files: string[]): boolean {
  const result = spawnSync(
    "claude",
    [
      "-p",
      "--model", "sonnet",
      "--permission-mode", "dontAsk",
      "--allowedTools", ALLOWED_TOOLS,
      "--system-prompt", SYSTEM_PROMPT,
    ],
    {
      cwd: orgRoot,
      stdio: ["pipe", "inherit", "inherit"],
      input: buildPrompt(files),
    },
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

function commitIngest(orgRoot: string, files: string[]): void {
  const hasChanges =
    execFileSync("git", ["status", "--porcelain", ...WIKI_FILES], {
      cwd: orgRoot,
    })
      .toString()
      .trim().length > 0;

  if (!hasChanges) return;

  const label =
    files.length === 1
      ? basename(files[0])
      : `${files.length} files`;

  execFileSync("git", ["add", ...WIKI_FILES], { cwd: orgRoot });
  execFileSync("git", ["commit", "-m", `[ingest] ${label}`], { cwd: orgRoot });
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
  console.log(
    "─".repeat(60) + "\n" +
    toIngest.map((f, i) => pc.bold(`${i + 1}.`) + " " + f).join("\n") + "\n",
  );

  const ok = runClaude(orgRoot, toIngest);

  if (ok) {
    for (const file of toIngest) writeLockEntry(orgRoot, file, []);
    try {
      commitIngest(orgRoot, toIngest);
      console.log(pc.green("✓") + " 完成");
    } catch (e) {
      console.warn(pc.yellow("⚠") + " git commit 失败:", (e as Error).message);
    }
  } else {
    console.error(pc.red("✗") + " Claude 退出非零");
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
