import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pc from "picocolors";
import { serializeHeadings, type OrgHeading } from "./org-headings.js";
import {
  fileMtime,
  type FileDiffEntry,
  type HeadingDiffEntry,
  type SyncPair,
} from "./sync-diff.js";

// ── types ────────────────────────────────────────────────────────────────────

export type Resolution = "accept-a" | "accept-b" | "accept-both" | "skip" | "edit";

export type Strategy = "a" | "b" | "newest" | "larger";

export interface SyncOptions {
  interactive: boolean;
  strategy?: Strategy;
  oneWay: boolean;
  includeNew?: boolean;
}


// ── interactive resolution ───────────────────────────────────────────────────

function formatDiffHeader(relPath: string, _pair: SyncPair, stats: { conflicts: number; additions: number }): string {
  const parts: string[] = [];
  if (stats.conflicts > 0) parts.push(`${stats.conflicts} conflicts`);
  if (stats.additions > 0) parts.push(`${stats.additions} additions`);
  return `\n${pc.dim("──")} ${pc.bold(relPath)} (${parts.join(", ")}) ${pc.dim("──")}\n`;
}

function showHeadingDiff(entry: HeadingDiffEntry, pair: SyncPair): string {
  const lines: string[] = [];
  const label = entry.id ? `* ${entry.title}  (${pc.dim(entry.id)})` : `* ${entry.title}`;
  lines.push("");
  lines.push(`  ${pc.bold(label)}`);
  lines.push("");

  if (entry.kind === "modified" && entry.a && entry.b) {
    const aLines = entry.a.raw.split("\n").slice(1); // skip heading line
    const bLines = entry.b.raw.split("\n").slice(1);
    lines.push(`  ${pc.dim(`--- A: ${pair.labelA}`)}`);
    for (const l of aLines) {
      if (l.trim()) lines.push(`  ${pc.red("- " + l)}`);
    }
    lines.push(`  ${pc.dim(`+++ B: ${pair.labelB}`)}`);
    for (const l of bLines) {
      if (l.trim()) lines.push(`  ${pc.green("+ " + l)}`);
    }
  } else if (entry.kind === "only-a" && entry.a) {
    lines.push(`  ${pc.dim(`only in A: ${pair.labelA}`)}`);
    for (const l of entry.a.raw.split("\n").slice(0, 5)) {
      if (l.trim()) lines.push(`  ${pc.green("+ " + l)}`);
    }
  } else if (entry.kind === "only-b" && entry.b) {
    lines.push(`  ${pc.dim(`only in B: ${pair.labelB}`)}`);
    for (const l of entry.b.raw.split("\n").slice(0, 5)) {
      if (l.trim()) lines.push(`  ${pc.green("+ " + l)}`);
    }
  }

  return lines.join("\n");
}

function promptResolution(
  pair: SyncPair,
  allowBoth: boolean,
): Promise<Resolution> {
  const options: Array<{ key: string; label: string; value: Resolution }> = [
    { key: "1", label: `Accept A (${pair.labelA})`, value: "accept-a" },
    { key: "2", label: `Accept B (${pair.labelB})`, value: "accept-b" },
  ];
  if (allowBoth) {
    options.push({ key: "3", label: "Accept both", value: "accept-both" });
    options.push({ key: "4", label: "Skip", value: "skip" });
    options.push({ key: "5", label: "Edit in $EDITOR", value: "edit" });
  } else {
    options.push({ key: "3", label: "Skip", value: "skip" });
    options.push({ key: "4", label: "Edit in $EDITOR", value: "edit" });
  }

  for (const o of options) {
    process.stdout.write(`  ${pc.cyan(o.key)}) ${o.label}\n`);
  }

  return new Promise((resolve) => {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    const onData = (buf: Buffer) => {
      const ch = buf.toString();
      const match = options.find((o) => o.key === ch);
      if (match) {
        stdin.off("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stdout.write(match.label + "\n");
        resolve(match.value);
      }
      // 'q' to quit
      if (ch === "q" || ch === "\x03") {
        stdin.off("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.exit(0);
      }
    };
    stdin.on("data", onData);
  });
}

// ── non-interactive strategy ─────────────────────────────────────────────────

function resolveByStrategy(
  entry: HeadingDiffEntry | FileDiffEntry,
  strategy: Strategy,
  _pair: SyncPair,
): Resolution {
  switch (strategy) {
    case "a":
      return "accept-a";
    case "b":
      return "accept-b";
    case "newest": {
      if ("absA" in entry && entry.absA && "absB" in entry && entry.absB) {
        const mtA = fileMtime(entry.absA);
        const mtB = fileMtime(entry.absB);
        return mtA >= mtB ? "accept-a" : "accept-b";
      }
      return "accept-a";
    }
    case "larger": {
      if ("a" in entry && "b" in entry) {
        const hEntry = entry as HeadingDiffEntry;
        const lenA = hEntry.a?.raw.length ?? 0;
        const lenB = hEntry.b?.raw.length ?? 0;
        return lenA >= lenB ? "accept-a" : "accept-b";
      }
      return "accept-a";
    }
  }
}

// ── apply resolution ─────────────────────────────────────────────────────────

function openInEditor(content: string): string {
  const tmp = `${process.env.TMPDIR ?? "/tmp"}/ingest-sync-${Date.now()}.org`;
  writeFileSync(tmp, content, "utf8");
  const editor = process.env.EDITOR ?? "vi";
  execFileSync(editor, [tmp], { stdio: "inherit" });
  return readFileSync(tmp, "utf8");
}

export async function resolveOrgFile(
  fileDiff: FileDiffEntry,
  pair: SyncPair,
  opts: SyncOptions,
): Promise<{ contentA: string; contentB: string } | null> {
  if (!fileDiff.headingDiff || fileDiff.kind === "identical") return null;

  const includeNew = opts.includeNew ?? false;
  const actionable = fileDiff.headingDiff.filter((d) => {
    if (d.kind === "identical") return false;
    if (!includeNew && (d.kind === "only-a" || d.kind === "only-b")) return false;
    return true;
  });
  if (actionable.length === 0) return null;

  const conflicts = actionable.filter((d) => d.kind === "modified").length;
  const additions = actionable.filter((d) => d.kind === "only-a" || d.kind === "only-b").length;

  if (opts.interactive) {
    process.stdout.write(formatDiffHeader(fileDiff.relPath, pair, { conflicts, additions }));
  }

  const resolvedForA: OrgHeading[] = [];
  const resolvedForB: OrgHeading[] = [];

  // Keep unchanged headings in their respective sides
  for (const d of fileDiff.headingDiff) {
    if (d.kind === "identical") {
      resolvedForA.push(d.a!);
      resolvedForB.push(d.b!);
    } else if (!includeNew && (d.kind === "only-a" || d.kind === "only-b")) {
      // Not included: keep each where it is
      if (d.a) resolvedForA.push(d.a);
      if (d.b) resolvedForB.push(d.b);
    }
  }

  let idx = 0;
  for (const d of actionable) {
    idx++;
    let resolution: Resolution;

    if (opts.interactive) {
      process.stdout.write(showHeadingDiff(d, pair));
      process.stdout.write(`\n  ${pc.dim(`[${idx}/${actionable.length}]`)}\n`);
      const allowBoth = d.kind !== "modified" || includeNew;
      resolution = await promptResolution(pair, allowBoth);
    } else {
      if (d.kind === "only-a") {
        resolution = opts.oneWay ? "accept-a" : "accept-both";
      } else if (d.kind === "only-b") {
        resolution = opts.oneWay ? "skip" : "accept-both";
      } else {
        resolution = resolveByStrategy(d, opts.strategy ?? "a", pair);
      }
    }

    switch (resolution) {
      case "accept-a":
        if (d.a) {
          resolvedForA.push(d.a);
          resolvedForB.push(d.a);
        }
        break;
      case "accept-b":
        if (d.b) {
          resolvedForA.push(d.b);
          resolvedForB.push(d.b);
        }
        break;
      case "accept-both":
        if (d.a) {
          resolvedForA.push(d.a);
          resolvedForB.push(d.a);
        }
        if (d.b) {
          resolvedForA.push(d.b);
          resolvedForB.push(d.b);
        }
        break;
      case "edit": {
        const combined = [d.a, d.b].filter(Boolean).map((h) => h!.raw).join("\n");
        const edited = openInEditor(combined);
        const fakeHeading: OrgHeading = { id: d.id, title: d.title, tags: [], raw: edited.trimEnd() };
        resolvedForA.push(fakeHeading);
        resolvedForB.push(fakeHeading);
        break;
      }
      case "skip":
        if (d.a) resolvedForA.push(d.a);
        if (d.b) resolvedForB.push(d.b);
        break;
    }
  }

  return {
    contentA: serializeHeadings(resolvedForA),
    contentB: serializeHeadings(resolvedForB),
  };
}

export async function resolveRawFile(
  fileDiff: FileDiffEntry,
  pair: SyncPair,
  opts: SyncOptions,
): Promise<{ writeToA?: string; writeToB?: string } | null> {
  if (fileDiff.kind === "identical") return null;

  let resolution: Resolution;

  if (opts.interactive) {
    process.stdout.write(`\n${pc.dim("──")} ${pc.bold(fileDiff.relPath)} (${fileDiff.kind}) ${pc.dim("──")}\n\n`);

    if (fileDiff.kind === "modified" && fileDiff.absA && fileDiff.absB) {
      const statA = fileMtime(fileDiff.absA);
      const statB = fileMtime(fileDiff.absB);
      process.stdout.write(`  A: ${pair.labelA}/${fileDiff.relPath}  ${pc.dim(`(${statA.toISOString().slice(0, 10)})`)}\n`);
      process.stdout.write(`  B: ${pair.labelB}/${fileDiff.relPath}  ${pc.dim(`(${statB.toISOString().slice(0, 10)})`)}\n\n`);

      // Show text diff for text files
      try {
        const contentA = readFileSync(fileDiff.absA, "utf8");
        const contentB = readFileSync(fileDiff.absB, "utf8");
        const linesA = contentA.split("\n").length;
        const linesB = contentB.split("\n").length;
        process.stdout.write(`  ${pc.dim(`A: ${linesA} lines, B: ${linesB} lines`)}\n\n`);
      } catch {
        // binary file, skip text diff
        process.stdout.write(`  ${pc.dim("(binary file)")}\n\n`);
      }
    } else if (fileDiff.kind === "only-a") {
      process.stdout.write(`  ${pc.dim(`only in A: ${pair.labelA}`)}\n\n`);
    } else if (fileDiff.kind === "only-b") {
      process.stdout.write(`  ${pc.dim(`only in B: ${pair.labelB}`)}\n\n`);
    }

    resolution = await promptResolution(pair, false);
  } else {
    if (fileDiff.kind === "only-a") {
      resolution = opts.oneWay ? "accept-a" : "accept-a";
    } else if (fileDiff.kind === "only-b") {
      resolution = opts.oneWay ? "skip" : "accept-b";
    } else {
      resolution = resolveByStrategy(fileDiff, opts.strategy ?? "a", pair);
    }
  }

  switch (resolution) {
    case "accept-a":
      return { writeToB: fileDiff.absA };
    case "accept-b":
      return { writeToA: fileDiff.absB };
    case "skip":
      return null;
    case "edit": {
      if (fileDiff.absA) {
        const content = readFileSync(fileDiff.absA, "utf8");
        const edited = openInEditor(content);
        const tmp = `${process.env.TMPDIR ?? "/tmp"}/ingest-sync-raw-${Date.now()}`;
        writeFileSync(tmp, edited, "utf8");
        return { writeToA: tmp, writeToB: tmp };
      }
      return null;
    }
    default:
      return null;
  }
}

export function applyFileWrite(sourcePath: string, destRoot: string, relPath: string): void {
  const dest = `${destRoot}/${relPath}`;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(sourcePath, dest);
}

export function applyOrgContent(content: string, destRoot: string, relPath: string): void {
  const dest = `${destRoot}/${relPath}`;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
}
