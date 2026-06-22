import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { CATEGORY_FILES } from "./wiki.js";

export function cmdShow(orgRoot: string, positional: string[]): void {
  const id = positional[1];
  if (!id) {
    console.error(pc.red("✗") + " usage: ingest show <id>");
    process.exit(1);
  }

  for (const file of CATEGORY_FILES) {
    const path = join(orgRoot, file);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!/^\* /.test(lines[i])) continue;

      let end = i + 1;
      while (end < lines.length && !/^\* /.test(lines[end])) end++;
      const block = lines.slice(i, end).join("\n");

      const idRe = new RegExp(`^\\s*:ID:\\s+${id}\\s*$`, "m");
      if (idRe.test(block)) {
        process.stdout.write(pc.dim(`${file}  ${id}`) + "\n");
        process.stdout.write(block + "\n");
        return;
      }
    }
  }

  console.error(pc.red("✗") + ` no wiki page with :ID: ${id}`);
  process.exit(1);
}
