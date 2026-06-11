import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_FILES, EXPECTED_TAG, type CategoryFile } from "./wiki.js";

// Trailing tag block: optional whitespace, then `:tag1:` or `:tag1:tag2:...`
const TAG_BLOCK_RE = /(\s+)(:[a-zA-Z_]+(?::[a-zA-Z_]+)*:)\s*$/;

type Heading = {
  file: CategoryFile;
  lineIdx: number; // 0-indexed
  title: string;
  tags: string[];
  id: string | null;
};

type WikiState = {
  fileLines: Map<CategoryFile, string[]>;
  headings: Heading[];
  validIds: Set<string>;
  titleIndex: Map<string, Heading[]>;
};

function parseWiki(orgRoot: string): WikiState {
  const fileLines = new Map<CategoryFile, string[]>();
  const headings: Heading[] = [];

  for (const file of CATEGORY_FILES) {
    let content: string;
    try {
      content = readFileSync(join(orgRoot, file), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    fileLines.set(file, lines);

    let cur: { lineIdx: number; title: string; tags: string[] } | null = null;
    let curId: string | null = null;
    let inProps = false;

    const flush = () => {
      if (!cur) return;
      headings.push({
        file,
        lineIdx: cur.lineIdx,
        title: cur.title,
        tags: cur.tags,
        id: curId,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("* ")) {
        flush();
        const m = line.match(TAG_BLOCK_RE);
        let title = line.slice(2);
        let tags: string[] = [];
        if (m) {
          tags = m[2].split(":").filter((s) => s.length > 0);
          title = line.slice(2, m.index!).trimEnd();
        }
        cur = { lineIdx: i, title, tags };
        curId = null;
        inProps = false;
      } else if (line === ":PROPERTIES:") {
        inProps = true;
      } else if (line === ":END:") {
        inProps = false;
      } else if (inProps) {
        const idMatch = line.match(/^:ID:\s+(\S+)/);
        if (idMatch) curId = idMatch[1];
      }
    }
    flush();
  }

  const validIds = new Set<string>();
  const titleIndex = new Map<string, Heading[]>();
  for (const h of headings) {
    if (h.id) validIds.add(h.id);
    const arr = titleIndex.get(h.title) ?? [];
    arr.push(h);
    titleIndex.set(h.title, arr);
  }

  return { fileLines, headings, validIds, titleIndex };
}

export type AppliedFix = {
  kind: "tag-mismatch" | "broken-link" | "duplicate-id";
  file: CategoryFile;
  description: string;
};

export type FixResult = {
  applied: AppliedFix[];
};

export function runSafeFixes(orgRoot: string): FixResult {
  const state = parseWiki(orgRoot);
  const applied: AppliedFix[] = [];
  const dirty = new Set<CategoryFile>();

  // Fix 1: tag-file mismatch — heading lacks the expected tag for its file.
  // Replace the trailing tag block with `:expected:`. If no tag block exists,
  // skip (hook will still flag missing tag, LLM handles it).
  for (const h of state.headings) {
    const expected = EXPECTED_TAG[h.file];
    if (h.tags.includes(expected)) continue;
    const lines = state.fileLines.get(h.file);
    if (!lines) continue;
    const oldLine = lines[h.lineIdx];
    const m = oldLine.match(TAG_BLOCK_RE);
    if (!m) continue; // no tag block → unsafe to fabricate
    const newLine = oldLine.slice(0, m.index!) + m[1] + ":" + expected + ":";
    lines[h.lineIdx] = newLine;
    dirty.add(h.file);
    applied.push({
      kind: "tag-mismatch",
      file: h.file,
      description: `${h.file}:${h.lineIdx + 1} :${h.tags.join(":")}: → :${expected}:`,
    });
  }

  // Fix 2: broken `[[id:XXX][text]]` link where XXX is unknown but `text`
  // exactly matches exactly one heading title across all category files.
  // Only patch the id; leave 0-match and 2+-match cases for LLM/manual.
  const linkRe = /\[\[id:([0-9T]+)\]\[([^\]]+)\]\]/g;
  for (const file of CATEGORY_FILES) {
    const lines = state.fileLines.get(file);
    if (!lines) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let newLine = line;
      let changed = false;
      // Reset regex state per line.
      linkRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = linkRe.exec(line)) !== null) {
        const [, oldId, displayText] = match;
        if (state.validIds.has(oldId)) continue;
        const candidates = state.titleIndex.get(displayText);
        if (!candidates || candidates.length !== 1) continue;
        const newId = candidates[0].id;
        if (!newId) continue;
        const oldLink = `[[id:${oldId}][${displayText}]]`;
        const newLink = `[[id:${newId}][${displayText}]]`;
        // Replace only the first occurrence to avoid double-fixing if the
        // same broken link appears twice on one line (rare; safer this way).
        newLine = newLine.replace(oldLink, newLink);
        changed = true;
        applied.push({
          kind: "broken-link",
          file,
          description: `${file}:${i + 1} id:${oldId} → id:${newId} (${displayText})`,
        });
      }
      if (changed) {
        lines[i] = newLine;
        dirty.add(file);
      }
    }
  }

  // Fix 3: duplicate :ID: across the wiki. Keep the first occurrence (sorted
  // by file, then lineIdx) and drop later copies. Recovers from agent
  // `replace_all=true` mistakes that duplicated whole heading blocks. Splice
  // bottom-up within each file so earlier line indices stay valid.
  const fileLastIdx = new Map<CategoryFile, number>();
  for (const file of CATEGORY_FILES) {
    const lines = state.fileLines.get(file);
    if (lines) fileLastIdx.set(file, lines.length);
  }
  const headingEnd = new Map<number, number>();
  {
    const sorted = [...state.headings].sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.lineIdx - b.lineIdx;
    });
    for (let i = 0; i < sorted.length; i++) {
      const h = sorted[i];
      const next = sorted[i + 1];
      const end =
        next && next.file === h.file
          ? next.lineIdx
          : (fileLastIdx.get(h.file) ?? h.lineIdx + 1);
      headingEnd.set(h.lineIdx, end);
    }
  }
  const byId = new Map<string, Heading[]>();
  for (const h of state.headings) {
    if (!h.id) continue;
    const arr = byId.get(h.id) ?? [];
    arr.push(h);
    byId.set(h.id, arr);
  }
  for (const [id, hs] of byId) {
    if (hs.length <= 1) continue;
    hs.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.lineIdx - b.lineIdx;
    });
    const kept = hs[0];
    const byFile = new Map<CategoryFile, { h: Heading; end: number }[]>();
    for (let i = 1; i < hs.length; i++) {
      const h = hs[i];
      const end = headingEnd.get(h.lineIdx) ?? h.lineIdx + 1;
      const arr = byFile.get(h.file) ?? [];
      arr.push({ h, end });
      byFile.set(h.file, arr);
    }
    for (const [file, removals] of byFile) {
      const lines = state.fileLines.get(file);
      if (!lines) continue;
      removals.sort((a, b) => b.h.lineIdx - a.h.lineIdx);
      for (const r of removals) {
        lines.splice(r.h.lineIdx, r.end - r.h.lineIdx);
        applied.push({
          kind: "duplicate-id",
          file,
          description: `${file}:${r.h.lineIdx + 1} drop duplicate :ID: ${id} (kept ${kept.file}:${kept.lineIdx + 1})`,
        });
      }
      dirty.add(file);
    }
  }

  for (const file of dirty) {
    const lines = state.fileLines.get(file)!;
    writeFileSync(join(orgRoot, file), lines.join("\n"), "utf8");
  }

  return { applied };
}
