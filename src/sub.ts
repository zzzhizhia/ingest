import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import pc from "picocolors";
import { scaffoldWiki } from "./init.js";
import { readLock } from "./lock.js";
import { scanPendingFiles } from "./scanner.js";

interface SubwikiInfo {
  name: string;
  path: string;
  url: string | null;
  pendingCount: number;
}

function getSubmoduleUrl(orgRoot: string, subPath: string): string | null {
  const result = spawnSync(
    "git",
    ["config", "--file", ".gitmodules", `submodule.${subPath}.url`],
    { cwd: orgRoot, encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function listSubwikis(orgRoot: string): SubwikiInfo[] {
  const subsDir = join(orgRoot, "subs");
  if (!existsSync(subsDir)) return [];

  const entries = readdirSync(subsDir, { withFileTypes: true });
  const results: SubwikiInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(subsDir, entry.name);

    const subPath = `subs/${entry.name}`;
    const url = getSubmoduleUrl(orgRoot, subPath);
    const lock = readLock(orgRoot);
    const pending = scanPendingFiles(orgRoot, lock).filter(
      (f) => f.submoduleRoot === fullPath,
    );

    results.push({
      name: entry.name,
      path: subPath,
      url,
      pendingCount: pending.length,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function cmdSubList(orgRoot: string): void {
  const subs = listSubwikis(orgRoot);
  if (subs.length === 0) {
    console.log(pc.dim("no subwikis in subs/"));
    return;
  }

  for (const sub of subs) {
    const pending =
      sub.pendingCount > 0
        ? pc.yellow(` (${sub.pendingCount} pending)`)
        : pc.green(" (up to date)");
    console.log(pc.bold(sub.name) + pending);
    if (sub.url) console.log(pc.dim(`  ${sub.url}`));
  }
}

export function cmdSubAdd(orgRoot: string, url: string, name?: string): void {
  const subsDir = join(orgRoot, "subs");
  const resolvedName = name ?? basename(url).replace(/\.git$/, "");
  const targetPath = join(subsDir, resolvedName);

  if (existsSync(targetPath)) {
    console.error(pc.red("✗") + ` subs/${resolvedName} already exists`);
    process.exit(1);
  }

  const subPath = `subs/${resolvedName}`;
  const result = spawnSync(
    "git",
    ["-c", "protocol.file.allow=always", "submodule", "add", url, subPath],
    { cwd: orgRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    const err = (result.stderr ?? result.stdout ?? "").trim();
    console.error(pc.red("✗") + " failed to add subwiki");
    if (err) console.error(pc.dim("  " + err));
    process.exit(1);
  }

  console.log(pc.green("✓") + " added subwiki " + pc.cyan(resolvedName));
  console.log(pc.dim(`  ${subPath} → ${url}`));
}

export function cmdSubNew(orgRoot: string, name: string): void {
  const subsDir = join(orgRoot, "subs");
  const targetPath = join(subsDir, name);

  if (existsSync(targetPath)) {
    console.error(pc.red("✗") + ` subs/${name} already exists`);
    process.exit(1);
  }

  execFileSync("git", ["init", targetPath], { stdio: "pipe" });

  const scaffold = scaffoldWiki(targetPath);
  console.log(pc.green("✓") + " created subwiki " + pc.cyan(name));
  for (const f of scaffold.created) console.log(pc.dim("  + " + f));

  execFileSync("git", ["add", "."], { cwd: targetPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial scaffold"], {
    cwd: targetPath,
    stdio: "pipe",
  });

  const subPath = `subs/${name}`;
  execFileSync("git", ["submodule", "add", `./${subPath}`, subPath], {
    cwd: orgRoot,
    stdio: "pipe",
  });

  console.log(pc.dim("  registered as subwiki"));
}

export function cmdSubRemove(orgRoot: string, names: string[]): void {
  for (const name of names) {
    const subPath = `subs/${name}`;

    if (!existsSync(join(orgRoot, subPath))) {
      console.error(pc.red("✗") + ` subs/${name} does not exist`);
      process.exit(1);
    }

    execFileSync("git", ["submodule", "deinit", "-f", subPath], { cwd: orgRoot, stdio: "pipe" });
    execFileSync("git", ["rm", "-rf", subPath], { cwd: orgRoot, stdio: "pipe" });
    execFileSync("rm", ["-rf", join(orgRoot, ".git", "modules", subPath)], { stdio: "pipe" });

    console.log(pc.green("✓") + " removed subwiki " + pc.cyan(name));
  }

  const label = names.length === 1 ? names[0] : `${names.length} subwikis`;
  execFileSync("git", ["commit", "-m", `[ingest] remove ${label}`], { cwd: orgRoot, stdio: "pipe" });
  console.log(pc.dim(`  committed: [ingest] remove ${label}`));
}
