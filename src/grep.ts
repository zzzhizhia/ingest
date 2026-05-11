import pc from "picocolors";
import { loadPages } from "./export.js";

export function cmdGrep(orgRoot: string, positional: string[]): void {
  const pattern = positional.slice(1).join(" ");
  if (!pattern) {
    console.error(pc.red("✗") + " usage: ingest grep <pattern>");
    process.exit(1);
  }

  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch (e) {
    console.error(pc.red("✗") + ` invalid pattern: ${(e as Error).message}`);
    process.exit(1);
  }

  const pages = loadPages(orgRoot);
  const matches = pages.filter((p) => re.test(p.title));

  if (matches.length === 0) {
    console.error(pc.red("✗") + ` no pages matching "${pattern}"`);
    process.exit(1);
  }

  for (const p of matches) {
    const tags = p.tags.length > 0 ? " :" + p.tags.join(":") + ":" : "";
    process.stdout.write(`* ${p.title}${tags}\n`);
    process.stdout.write(`:PROPERTIES:\n:ID: ${p.id}\n:END:\n`);
    process.stdout.write(p.bodyOrg);
  }
}
