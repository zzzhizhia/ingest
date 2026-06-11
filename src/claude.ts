import { spawn } from "node:child_process";
import { basename } from "node:path";
import pc from "picocolors";
import type { IngestConfig } from "./config.js";
import { printMarkdown } from "./markdown.js";
import {
  buildFixPrompt,
  buildPrompt,
  SUBMODULE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "./prompts.js";
import type { PendingFile } from "./scanner.js";

export type ClaudeRunOpts = {
  orgRoot: string;
  /** Omit on resume to keep the session's original system prompt. */
  systemPrompt?: string;
  prompt: string;
  label: string;
  doneLabel?: string;
  config: IngestConfig;
  /** When set, resumes the given session ID instead of starting a new one. */
  resumeSessionId?: string;
  /** When true, suppress all output framing and return raw text. */
  captureOutput?: boolean;
};

export type ClaudeResult = {
  ok: boolean;
  output: string;
  sessionId: string;
  /**
   * True if the process was killed by SIGINT/SIGTERM (i.e. user abort).
   * `output` and `sessionId` may still be populated from the partial JSON
   * buffer, so callers can persist the sessionId for later `--resume` even
   * when ok=false.
   */
  aborted: boolean;
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

// claude -p --output-format json prints a single JSON object on stdout whose
// `result` field holds the assistant's final text and `session_id` is the
// conversation ID (which `--resume <id>` can later pick up). We capture the
// whole blob and split it back out so callers can pipe `result` to the
// markdown renderer and reuse `session_id` for the fix pass.
type ClaudeJsonOutput = {
  result?: string;
  session_id?: string;
  is_error?: boolean;
};

function parseClaudeJson(raw: string): { result: string; sessionId: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { result: "", sessionId: "" };
  try {
    const parsed = JSON.parse(trimmed) as ClaudeJsonOutput;
    return {
      result: typeof parsed.result === "string" ? parsed.result : "",
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : "",
    };
  } catch {
    // Some failure paths may print a non-JSON error to stdout; surface it
    // as the result so the caller still sees something.
    return { result: trimmed, sessionId: "" };
  }
}

export async function invokeClaude(opts: ClaudeRunOpts): Promise<ClaudeResult> {
  const systemPrompt =
    opts.systemPrompt && opts.config.prompt?.systemAppend
      ? opts.systemPrompt + "\n\n" + opts.config.prompt.systemAppend
      : opts.systemPrompt;

  return new Promise((resolve) => {
    const args = [
      "-p",
      "--bare",
      "--model", opts.config.model,
      "--effort", opts.config.effort,
      "--permission-mode", "dontAsk",
      "--allowedTools", opts.config.allowedTools.join(","),
      "--output-format", "json",
    ];
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

    const child = spawn("claude", args, {
      cwd: opts.orgRoot,
      stdio: ["pipe", "pipe", "inherit"],
    });

    child.stdin?.end(opts.prompt);

    const startTime = Date.now();
    let raw = "";
    let spinnerInterval: ReturnType<typeof setInterval> | undefined;
    const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinIdx = 0;

    const isTTY = process.stdout.isTTY;

    if (!opts.captureOutput && isTTY) {
      process.stdout.write("\n");
      spinnerInterval = setInterval(() => {
        const elapsed = formatElapsed(Date.now() - startTime);
        const spin = spinChars[spinIdx++ % spinChars.length];
        process.stdout.write(`\r${pc.cyan(spin)} ${pc.dim(opts.label)} ${pc.dim(elapsed)}`);
      }, 100);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });

    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      if (spinnerInterval) clearInterval(spinnerInterval);
      process.stdout.write(
        "\n" + pc.yellow("⚠ interrupting claude...") + "\n",
      );
      child.kill("SIGINT");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000).unref();
    };
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);

    child.on("close", async (code) => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);

      if (spinnerInterval) clearInterval(spinnerInterval);
      const elapsed = formatElapsed(Date.now() - startTime);

      const { result: output, sessionId } = parseClaudeJson(raw);
      const doneLabel = opts.doneLabel ?? opts.label;
      const prefix = isTTY ? "\r" : "";
      if (opts.captureOutput) {
        // captureOutput callers (e.g. ingest query) want clean stdout; just
        // emit a single line so the spinner line gets cleared on TTY.
        if (isTTY) process.stdout.write(`${prefix}${pc.green("✓")} ${pc.dim(doneLabel)} ${pc.dim(elapsed)}\n`);
      } else {
        process.stdout.write(`${prefix}${pc.green("✓")} ${pc.dim(doneLabel)} ${pc.dim(elapsed)}`);
        if (opts.resumeSessionId) process.stdout.write(pc.dim(" (resumed)"));
        process.stdout.write("\n");
        if (isTTY) await printMarkdown(output);
      }

      if (interrupted) {
        console.error(pc.red("✗") + " aborted by user");
      }

      resolve({ ok: code === 0 && !interrupted, output, sessionId, aborted: interrupted });
    });

    child.on("error", (err) => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      if (spinnerInterval) clearInterval(spinnerInterval);
      if (isTTY) process.stdout.write("\r");
      console.error(err.message);
      resolve({ ok: false, output: "", sessionId: "", aborted: false });
    });
  });
}

export async function runClaude(
  orgRoot: string,
  files: PendingFile[],
  convertedMap: Map<string, string>,
  config: IngestConfig,
  submoduleRoot?: string,
): Promise<{ ok: boolean; output: string; sessionId: string; aborted: boolean }> {
  const cwd = submoduleRoot ?? orgRoot;
  const name = submoduleRoot ? basename(submoduleRoot) : undefined;
  const result = await invokeClaude({
    orgRoot: cwd,
    systemPrompt: submoduleRoot ? SUBMODULE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    prompt: buildPrompt(orgRoot, files, convertedMap, submoduleRoot, config),
    label: name ?? "ingesting",
    doneLabel: name ?? "ingested",
    config,
  });
  return {
    ok: result.ok,
    output: result.output,
    sessionId: result.sessionId,
    aborted: result.aborted,
  };
}

export async function runClaudeFix(
  orgRoot: string,
  errorOutput: string,
  files: PendingFile[],
  config: IngestConfig,
  resumeSessionId: string,
): Promise<boolean> {
  // No systemPrompt on resume: the session already carries the original one.
  // Sending a fresh system prompt on top of a resumed session confuses the
  // model about its role mid-conversation.
  const result = await invokeClaude({
    orgRoot,
    prompt: buildFixPrompt(errorOutput, files),
    label: "claude (fix)",
    config,
    resumeSessionId,
  });
  return result.ok && !result.aborted;
}
