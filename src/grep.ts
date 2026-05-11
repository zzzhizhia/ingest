import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { CATEGORY_FILES } from "./wiki.js";

export function cmdGrep(orgRoot: string, positional: string[]): void {
  const pattern = positional.slice(1).join(" ");
  if (!pattern) {
    console.error(pc.red("✗") + " usage: ingest grep <pattern>");
    process.exit(1);
  }

  const files = CATEGORY_FILES
    .map((f) => join(orgRoot, f))
    .filter((f) => existsSync(f));

  if (files.length === 0) {
    console.error(pc.red("✗") + ` no pages matching "${pattern}"`);
    process.exit(1);
  }

  const rgPattern = `^\\* .*${pattern}.*\\n((?!^\\* ).*\\n)*`;

  let blocks: string;
  try {
    blocks = execFileSync("rg", [
      "-U", "-i", "--pcre2",
      "--no-heading", "--no-filename", "--no-line-number",
      "--color=never",
      rgPattern,
      "--",
      ...files,
    ], { encoding: "utf8" });
  } catch (e: any) {
    if (e.status === 1) {
      console.error(pc.red("✗") + ` no pages matching "${pattern}"`);
      process.exit(1);
    }
    if (e.code === "ENOENT") {
      console.error(pc.red("✗") + " rg (ripgrep) is required but not found in PATH");
      process.exit(1);
    }
    const stderr = e.stderr?.toString().trim() ?? e.message;
    console.error(pc.red("✗") + ` rg: ${stderr}`);
    process.exit(1);
  }

  const pages = blocks.split(/(?=^\* )/m).filter((s) => s.trim());
  const color = !!process.stdout.isTTY;

  let re: RegExp | null = null;
  if (color) {
    try {
      re = new RegExp(`(${pattern})`, "gi");
    } catch {
      // pattern not valid as JS regex — skip highlighting
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const lines = pages[i].split("\n");
    const title = lines[0]
      .replace(/^\*+\s+/, "")
      .replace(/\s+:[a-zA-Z_]+(?::[a-zA-Z_]+)*:\s*$/, "")
      .trim();
    const body = lines.slice(1).join("\n");

    if (i > 0) process.stdout.write("\n");
    process.stdout.write((color ? pc.magenta(title) : title) + "\n");
    process.stdout.write(re ? body.replace(re, (m) => pc.red(pc.bold(m))) : body);
  }
}
