import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileHash } from "./lock.js";
import { parseOrgHeadings, type OrgHeading } from "./org-headings.js";
import { CATEGORY_FILES } from "./wiki.js";

// ── types ────────────────────────────────────────────────────────────────────

export type HeadingDiffKind = "only-a" | "only-b" | "modified" | "identical";

export interface HeadingDiffEntry {
  kind: HeadingDiffKind;
  id: string | null;
  title: string;
  a?: OrgHeading;
  b?: OrgHeading;
}

export type FileDiffKind = "only-a" | "only-b" | "modified" | "identical";

export interface FileDiffEntry {
  kind: FileDiffKind;
  relPath: string; // relative to its own root (e.g. "entities.org" or "raw/foo.md")
  absA?: string;
  absB?: string;
  isOrgWiki: boolean;
  headingDiff?: HeadingDiffEntry[];
}

export interface SyncPair {
  rootA: string;
  rootB: string;
  labelA: string;
  labelB: string;
}

// ── file discovery ───────────────────────────────────────────────────────────

const CATEGORY_SET = new Set<string>(CATEGORY_FILES);

function collectSyncableFiles(root: string): Set<string> {
  const results = new Set<string>();
  for (const cat of CATEGORY_FILES) {
    if (existsSync(join(root, cat))) results.add(cat);
  }
  const rawDir = join(root, "raw");
  if (existsSync(rawDir)) {
    walkRaw(rawDir, "raw", results);
  }
  return results;
}

function walkRaw(dir: string, prefix: string, out: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + "/" + entry.name;
    if (entry.isDirectory()) {
      walkRaw(join(dir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.add(rel);
    }
  }
}

// ── heading diff ─────────────────────────────────────────────────────────────

export function diffHeadings(
  headingsA: OrgHeading[],
  headingsB: OrgHeading[],
): HeadingDiffEntry[] {
  const result: HeadingDiffEntry[] = [];

  // Build index: prefer ID, fallback to title
  const indexB = new Map<string, OrgHeading>();
  const unmatchedB = new Set<string>();
  for (const h of headingsB) {
    const key = h.id ?? `__title__${h.title}`;
    indexB.set(key, h);
    unmatchedB.add(key);
  }

  for (const hA of headingsA) {
    const key = hA.id ?? `__title__${hA.title}`;
    const hB = indexB.get(key);
    if (!hB) {
      result.push({ kind: "only-a", id: hA.id, title: hA.title, a: hA });
    } else {
      unmatchedB.delete(key);
      if (hA.raw.trimEnd() === hB.raw.trimEnd()) {
        result.push({ kind: "identical", id: hA.id, title: hA.title, a: hA, b: hB });
      } else {
        result.push({ kind: "modified", id: hA.id, title: hA.title, a: hA, b: hB });
      }
    }
  }

  for (const key of unmatchedB) {
    const hB = indexB.get(key)!;
    result.push({ kind: "only-b", id: hB.id, title: hB.title, b: hB });
  }

  return result;
}

// ── file diff ────────────────────────────────────────────────────────────────

export interface DiffOptions {
  includeNew?: boolean; // include files only in one side (default: false)
}

export function diffFiles(pair: SyncPair, paths?: string[], opts?: DiffOptions): FileDiffEntry[] {
  const results: FileDiffEntry[] = [];
  const includeNew = opts?.includeNew ?? false;

  let targetPaths: string[];
  if (paths && paths.length > 0) {
    targetPaths = paths;
  } else {
    const filesA = collectSyncableFiles(pair.rootA);
    const filesB = collectSyncableFiles(pair.rootB);
    let selected: Set<string>;
    if (includeNew) {
      selected = new Set([...filesA, ...filesB]);
    } else {
      // Default: only same-name files (intersection)
      selected = new Set([...filesA].filter((f) => filesB.has(f)));
    }
    targetPaths = [...selected].sort();
  }

  for (const rel of targetPaths) {
    const absA = join(pair.rootA, rel);
    const absB = join(pair.rootB, rel);
    const existA = existsSync(absA);
    const existB = existsSync(absB);
    const isOrgWiki = CATEGORY_SET.has(basename(rel));

    if (existA && !existB) {
      const entry: FileDiffEntry = { kind: "only-a", relPath: rel, absA, isOrgWiki };
      if (isOrgWiki) {
        const headingsA = parseOrgHeadings(readFileSync(absA, "utf8"));
        entry.headingDiff = headingsA.map((h) => ({
          kind: "only-a" as const,
          id: h.id,
          title: h.title,
          a: h,
        }));
      }
      results.push(entry);
    } else if (!existA && existB) {
      const entry: FileDiffEntry = { kind: "only-b", relPath: rel, absB, isOrgWiki };
      if (isOrgWiki) {
        const headingsB = parseOrgHeadings(readFileSync(absB, "utf8"));
        entry.headingDiff = headingsB.map((h) => ({
          kind: "only-b" as const,
          id: h.id,
          title: h.title,
          b: h,
        }));
      }
      results.push(entry);
    } else if (existA && existB) {
      if (isOrgWiki) {
        const contentA = readFileSync(absA, "utf8");
        const contentB = readFileSync(absB, "utf8");
        const headingsA = parseOrgHeadings(contentA);
        const headingsB = parseOrgHeadings(contentB);
        const headingDiff = diffHeadings(headingsA, headingsB);
        const hasChanges = headingDiff.some((d) => d.kind !== "identical");
        results.push({
          kind: hasChanges ? "modified" : "identical",
          relPath: rel,
          absA,
          absB,
          isOrgWiki,
          headingDiff,
        });
      } else {
        const hashA = fileHash(absA);
        const hashB = fileHash(absB);
        results.push({
          kind: hashA === hashB ? "identical" : "modified",
          relPath: rel,
          absA,
          absB,
          isOrgWiki,
        });
      }
    }
  }

  return results;
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function buildSyncPair(
  orgRoot: string,
  pathA: string,
  pathB?: string,
): SyncPair {
  const rootA = resolveWikiRoot(orgRoot, pathA);
  const rootB = pathB ? resolveWikiRoot(orgRoot, pathB) : orgRoot;
  return {
    rootA,
    rootB,
    labelA: relative(orgRoot, rootA) || ".",
    labelB: relative(orgRoot, rootB) || ".",
  };
}

function resolveWikiRoot(orgRoot: string, path: string): string {
  if (path === ".") return orgRoot;
  const abs = join(orgRoot, path);
  if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
  // Could be a direct reference like "subs/math"
  const subPath = join(orgRoot, path);
  if (existsSync(subPath) && statSync(subPath).isDirectory()) return subPath;
  throw new Error(`Not a valid wiki root: ${path}`);
}

export function fileMtime(absPath: string): Date {
  return statSync(absPath).mtime;
}
