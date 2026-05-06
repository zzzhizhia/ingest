import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pc from "picocolors";
import { buildSyncPair, diffFiles } from "./sync-diff.js";
import {
  applyFileWrite,
  applyOrgContent,
  resolveOrgFile,
  resolveRawFile,
  type Strategy,
  type SyncOptions,
} from "./sync-resolve.js";

function findOrgRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "ingest-lock.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error("Not inside an ingest wiki (no ingest-lock.json found).");
    }
    dir = parent;
  }
}

function getOpt(args: string[], name: string): string | undefined {
  const eqPrefix = name + "=";
  const eq = args.find((a) => a.startsWith(eqPrefix));
  if (eq) return eq.slice(eqPrefix.length);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    const next = args[idx + 1];
    if (!next.startsWith("-")) return next;
  }
  return undefined;
}

export async function cmdSync(args: string[], positional: string[]): Promise<void> {
  const orgRoot = findOrgRoot(process.cwd());

  // Parse flags
  const oneWay = args.includes("--one-way");
  const nonInteractive = args.includes("--non-interactive");
  const includeNew = args.includes("--all") || args.includes("-a");
  const strategy = getOpt(args, "--strategy") as Strategy | undefined;

  if (nonInteractive && !strategy) {
    console.error(pc.red("✗") + " --non-interactive requires --strategy (a, b, newest, larger)");
    process.exit(1);
  }

  // Parse positional: sync <pathA> [pathB] [specific files...]
  // positional[0] is "sync" itself
  const pathArgs = positional.slice(1);

  if (pathArgs.length === 0) {
    console.error(pc.red("✗") + " usage: ingest sync <source> [target] [files...]");
    console.error(pc.dim("  examples:"));
    console.error(pc.dim("    ingest sync subs/math              # math ↔ main wiki"));
    console.error(pc.dim("    ingest sync subs/math subs/physics # math ↔ physics"));
    console.error(pc.dim("    ingest sync subs/math --one-way    # math → main wiki"));
    process.exit(1);
  }

  // Determine roots
  let pathA = pathArgs[0];
  let pathB: string | undefined;
  let specificFiles: string[] = [];

  if (pathArgs.length >= 2) {
    // Check if second arg is a directory (another wiki root) or a file
    const candidate = join(orgRoot, pathArgs[1]);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      pathB = pathArgs[1];
      specificFiles = pathArgs.slice(2);
    } else {
      // second arg onwards are specific files
      specificFiles = pathArgs.slice(1);
    }
  }

  const pair = buildSyncPair(orgRoot, pathA, pathB);

  // Normalize specific file paths relative to wiki roots
  const relFiles = specificFiles.map((f) => {
    // If path starts with rootA or rootB prefix, strip it
    const relToOrg = relative(orgRoot, resolve(f));
    const relToA = relative(pair.rootA, resolve(orgRoot, f));
    const relToB = relative(pair.rootB, resolve(orgRoot, f));
    if (!relToA.startsWith("..")) return relToA;
    if (!relToB.startsWith("..")) return relToB;
    return relToOrg;
  });

  const opts: SyncOptions = {
    interactive: !nonInteractive,
    strategy,
    oneWay,
    includeNew,
  };

  // Run diff
  const diffs = diffFiles(pair, relFiles.length > 0 ? relFiles : undefined, { includeNew });
  const actionable = diffs.filter((d) => {
    if (d.kind === "identical") return false;
    // For org wiki files, check if there are actually resolvable heading diffs
    if (d.isOrgWiki && d.headingDiff) {
      const resolvable = d.headingDiff.some((h) => {
        if (h.kind === "identical") return false;
        if (!includeNew && (h.kind === "only-a" || h.kind === "only-b")) return false;
        return true;
      });
      return resolvable;
    }
    // For raw files: only-a/only-b require includeNew
    if (!includeNew && (d.kind === "only-a" || d.kind === "only-b")) return false;
    return true;
  });

  if (actionable.length === 0) {
    console.log(pc.green("✓") + " already in sync");
    return;
  }

  console.log(
    pc.dim(`comparing ${pair.labelA} ↔ ${pair.labelB}: `) +
    `${actionable.length} file(s) with differences\n`,
  );

  let applied = 0;

  for (const fileDiff of actionable) {
    if (fileDiff.isOrgWiki) {
      const result = await resolveOrgFile(fileDiff, pair, opts);
      if (result) {
        if (!oneWay) {
          applyOrgContent(result.contentA, pair.rootA, fileDiff.relPath);
        }
        applyOrgContent(result.contentB, pair.rootB, fileDiff.relPath);
        applied++;
      }
    } else {
      const result = await resolveRawFile(fileDiff, pair, opts);
      if (result) {
        if (result.writeToA && !oneWay) {
          applyFileWrite(result.writeToA, pair.rootA, fileDiff.relPath);
        }
        if (result.writeToB) {
          applyFileWrite(result.writeToB, pair.rootB, fileDiff.relPath);
        }
        applied++;
      }
    }
  }

  console.log(`\n${pc.green("✓")} synced ${applied} file(s)`);
}
