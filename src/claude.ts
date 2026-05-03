import { spawn } from "node:child_process";
import { basename } from "node:path";
import pc from "picocolors";
import type { IngestConfig } from "./config.js";
import { printMarkdown } from "./markdown.js";
import {
  buildFixPrompt,
  buildPrompt,
  FIX_SYSTEM_PROMPT,
  SUBMODULE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "./prompts.js";
import type { PendingFile } from "./scanner.js";

export type ClaudeRunOpts = {
  orgRoot: string;
  systemPrompt: string;
  prompt: string;
  label: string;
  doneLabel?: string;
  config: IngestConfig;
  verbose?: boolean;
  /** When true, suppress all output framing and return raw text. */
  captureOutput?: boolean;
};

export type ClaudeResult = {
  ok: boolean;
  output: string;
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

export async function invokeClaude(opts: ClaudeRunOpts): Promise<ClaudeResult> {
  const systemPrompt = opts.config.prompt?.systemAppend
    ? opts.systemPrompt + "\n\n" + opts.config.prompt.systemAppend
    : opts.systemPrompt;

  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--model", opts.config.model,
        "--effort", opts.config.effort,
        "--permission-mode", "dontAsk",
        "--allowedTools", opts.config.allowedTools.join(","),
        "--system-prompt", systemPrompt,
      ],
      { cwd: opts.orgRoot, stdio: ["pipe", "pipe", "inherit"] },
    );

    child.stdin?.end(opts.prompt);

    const startTime = Date.now();
    let output = "";
    let spinnerInterval: ReturnType<typeof setInterval> | undefined;
    const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinIdx = 0;

    if (opts.verbose && !opts.captureOutput) {
      const W = 60;
      const header = `┌─ ${opts.label} `;
      const padding = Math.max(0, W - header.length + 1);
      console.log(pc.dim(header + "─".repeat(padding) + "┐"));
    } else if (!opts.verbose) {
      spinnerInterval = setInterval(() => {
        const elapsed = formatElapsed(Date.now() - startTime);
        const spin = spinChars[spinIdx++ % spinChars.length];
        process.stdout.write(`\r${pc.cyan(spin)} ${pc.dim(opts.label)} ${pc.dim(elapsed)}`);
      }, 100);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (opts.verbose) {
        for (const line of text.split("\n")) {
          if (line) process.stdout.write(pc.dim("│ ") + line + "\n");
        }
      }
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

      const doneLabel = opts.doneLabel ?? opts.label;
      if (opts.captureOutput) {
        if (spinnerInterval) process.stdout.write(`\r${pc.green("✓")} ${pc.dim(doneLabel)} ${pc.dim(elapsed)}\n`);
      } else if (opts.verbose) {
        const W = 60;
        console.log(pc.dim("└" + "─".repeat(W) + "┘") + pc.dim(` ${elapsed}`));
      } else {
        process.stdout.write(`\r${pc.green("✓")} ${pc.dim(doneLabel)} ${pc.dim(elapsed)}\n`);
        await printMarkdown(output);
      }

      if (interrupted) {
        console.error(pc.red("✗") + " aborted by user");
        process.exit(130);
      }

      resolve({ ok: code === 0, output });
    });

    child.on("error", (err) => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      if (spinnerInterval) clearInterval(spinnerInterval);
      process.stdout.write("\r");
      console.error(err.message);
      resolve({ ok: false, output: "" });
    });
  });
}

export async function runClaude(
  orgRoot: string,
  files: PendingFile[],
  convertedMap: Map<string, string>,
  config: IngestConfig,
  submoduleRoot?: string,
  verbose?: boolean,
): Promise<boolean> {
  const cwd = submoduleRoot ?? orgRoot;
  const name = submoduleRoot ? basename(submoduleRoot) : undefined;
  const result = await invokeClaude({
    orgRoot: cwd,
    systemPrompt: submoduleRoot ? SUBMODULE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    prompt: buildPrompt(orgRoot, files, convertedMap, submoduleRoot, config),
    label: name ?? "ingesting",
    doneLabel: name ?? "ingested",
    config,
    verbose,
  });
  return result.ok;
}

export async function runClaudeFix(
  orgRoot: string,
  errorOutput: string,
  files: PendingFile[],
  config: IngestConfig,
  verbose?: boolean,
): Promise<boolean> {
  const result = await invokeClaude({
    orgRoot,
    systemPrompt: FIX_SYSTEM_PROMPT,
    prompt: buildFixPrompt(errorOutput, files),
    label: "claude (fix)",
    config,
    verbose,
  });
  return result.ok;
}
