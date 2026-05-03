import { execFileSync, spawnSync } from "node:child_process";
import { basename } from "node:path";
import pc from "picocolors";
import { extractReferencedFiles } from "./references.js";
import type { PendingFile } from "./scanner.js";
import { SUBMODULE_WIKI_FILES, WIKI_FILES } from "./wiki.js";

export function gitPull(orgRoot: string): void {
  process.stdout.write(pc.dim("↓ pulling..."));
  const stash = spawnSync("git", ["stash", "--include-untracked"], {
    cwd: orgRoot,
    encoding: "utf8",
  });
  const didStash = stash.status === 0 && !stash.stdout.includes("No local changes");

  const onInterrupt = () => {
    process.stdout.write(
      "\n" + pc.yellow("⚠ interrupted — restoring stashed changes...") + "\n",
    );
    spawnSync("git", ["stash", "pop"], { cwd: orgRoot, stdio: "inherit" });
    process.exit(130);
  };
  if (didStash) {
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
  }

  const result = spawnSync("git", ["pull", "--ff-only"], {
    cwd: orgRoot,
    encoding: "utf8",
  });

  if (didStash) {
    const pop = spawnSync("git", ["stash", "pop"], {
      cwd: orgRoot,
      encoding: "utf8",
    });
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    if (pop.status !== 0) {
      throw new Error(
        "stash pop failed after pull (likely conflict). " +
          "Your local changes remain in stash. " +
          "Resolve with `git stash pop` manually, then rerun.\n" +
          (pop.stderr?.trim() ?? ""),
      );
    }
  }

  if (result.status !== 0) throw new Error(result.stderr?.trim() ?? "git pull failed");
  const out = result.stdout.trim();
  const msg = out === "Already up to date." ? "already up to date" : out.split("\n")[0];
  process.stdout.write("\r" + pc.dim("↓ " + msg + (didStash ? " (stashed/popped)" : "")) + "\n");
}

export function gitSubmoduleUpdate(orgRoot: string): void {
  process.stdout.write(pc.dim("↓ updating subwikis..."));
  const result = spawnSync(
    "git",
    ["submodule", "update", "--remote", "--init"],
    { cwd: orgRoot, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr?.trim() ?? "git subwiki update failed");
  process.stdout.write("\r" + pc.dim("↓ subwikis up to date") + "\n");
}

export function gitPush(orgRoot: string, label?: string): void {
  execFileSync("git", ["push"], { cwd: orgRoot, stdio: "ignore" });
  const suffix = label ? ` (${label})` : "";
  console.log(pc.dim(`↑ pushed${suffix}`));
}

function sourcePathsToAdd(orgRoot: string, files: string[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file);
    for (const ref of extractReferencedFiles(orgRoot, file)) {
      if (ref.startsWith("..")) continue;
      paths.add(ref);
    }
  }
  return [...paths];
}

export type CommitResult = { ok: true } | { ok: false; error: string };

export function commitSubmodule(submoduleRoot: string, files: PendingFile[]): CommitResult {
  const label =
    files.length === 1
      ? basename(files[0].rel)
      : `${files.length} files`;

  execFileSync("git", ["add", ...SUBMODULE_WIKI_FILES], { cwd: submoduleRoot, stdio: "pipe" });

  const hasChanges =
    execFileSync("git", ["status", "--porcelain", ...SUBMODULE_WIKI_FILES], {
      cwd: submoduleRoot,
    })
      .toString()
      .trim().length > 0;

  if (!hasChanges) return { ok: true };

  const result = spawnSync("git", ["commit", "-m", `[ingest] ${label}`], {
    cwd: submoduleRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const error = ((result.stdout ?? "") + (result.stderr ?? "")).trim();
    return { ok: false, error };
  }
  console.log(pc.dim(`  committed (${basename(submoduleRoot)}): [ingest] ${label}`));
  return { ok: true };
}

export function commitIngest(orgRoot: string, files: string[], submodulePaths: string[] = []): CommitResult {
  const label =
    files.length === 1
      ? basename(files[0])
      : `${files.length} files`;

  const sources = sourcePathsToAdd(orgRoot, files);
  const allPaths = [...WIKI_FILES, ...sources, ...submodulePaths];

  execFileSync("git", ["add", ...allPaths], { cwd: orgRoot, stdio: "pipe" });

  const hasChanges =
    execFileSync("git", ["status", "--porcelain", ...allPaths], {
      cwd: orgRoot,
    })
      .toString()
      .trim().length > 0;

  if (!hasChanges) return { ok: true };

  const result = spawnSync("git", ["commit", "-m", `[ingest] ${label}`], {
    cwd: orgRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const error = ((result.stdout ?? "") + (result.stderr ?? "")).trim();
    return { ok: false, error };
  }
  console.log(pc.dim(`  committed: [ingest] ${label}`));
  return { ok: true };
}
