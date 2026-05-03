import { spawn, spawnSync } from "node:child_process";

let _glowAvailable: boolean | null = null;

function isGlowAvailable(): boolean {
  if (_glowAvailable !== null) return _glowAvailable;
  try {
    const result = spawnSync("glow", ["--version"], { stdio: "ignore", timeout: 3000 });
    _glowAvailable = result.status === 0;
  } catch {
    _glowAvailable = false;
  }
  return _glowAvailable;
}

function renderViaGlow(markdown: string, width: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("glow", ["--style", "dark", "-w", String(width), "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: process.env.TERM || "xterm-256color",
        CLICOLOR_FORCE: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });

    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`glow failed (exit ${code}): ${stderr}`));
    });

    proc.on("error", (err) => { reject(err); });

    proc.stdin.write(markdown);
    proc.stdin.end();
  });
}

export async function printMarkdown(text: string): Promise<void> {
  const trimmed = text.trimEnd();
  if (!trimmed) return;
  if (process.stdout.isTTY) {
    process.stdout.write(await renderWithGlow(trimmed));
  } else {
    process.stdout.write(trimmed + "\n");
  }
}

export async function renderWithGlow(markdown: string, width?: number): Promise<string> {
  const w = width ?? Math.min(process.stdout.columns || 80, 100);
  if (isGlowAvailable()) {
    try {
      return await renderViaGlow(markdown, w);
    } catch {
      // fall through
    }
  }
  return markdown + "\n";
}
