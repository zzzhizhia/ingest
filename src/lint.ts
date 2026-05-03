import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_FILES, EXPECTED_TAG, type CategoryFile } from "./wiki.js";

export type LintError = {
  kind: "format" | "link" | "id";
  file: CategoryFile;
  line?: number;
  message: string;
};

export type LintResult = {
  errors: LintError[];
  headingCount: number;
};

type Heading = {
  file: CategoryFile;
  lineIdx: number;
  title: string;
  tags: string[];
  id: string | null;
  hasDate: boolean;
};

const TAG_BLOCK_RE = /(\s+)(:[a-zA-Z_]+(?::[a-zA-Z_]+)*:)\s*$/;
const ID_RE = /^[0-9]{8}T[0-9]{6}$/;
const DATE_RE = /^\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]$/;
const ID_LINK_RE = /\[\[id:([0-9T]+)\]/g;

export function lintWiki(orgRoot: string): LintResult {
  const errors: LintError[] = [];
  const headings: Heading[] = [];

  for (const file of CATEGORY_FILES) {
    let content: string;
    try {
      content = readFileSync(join(orgRoot, file), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const expected = EXPECTED_TAG[file];

    let cur: { lineIdx: number; title: string; tags: string[] } | null = null;
    let curId: string | null = null;
    let curHasDate = false;
    let inProps = false;
    let propsStartLine = -1;

    const flush = () => {
      if (!cur) return;
      if (cur.tags.length === 0) {
        errors.push({ kind: "format", file, line: cur.lineIdx + 1, message: `missing tag: ${cur.title}` });
      } else if (!cur.tags.includes(expected)) {
        errors.push({ kind: "format", file, line: cur.lineIdx + 1, message: `tag mismatch (expected :${expected}:): ${cur.title}` });
      }
      if (!curId) {
        errors.push({ kind: "format", file, line: cur.lineIdx + 1, message: `missing :ID:: ${cur.title}` });
      } else if (!ID_RE.test(curId)) {
        errors.push({ kind: "format", file, line: cur.lineIdx + 1, message: `malformed :ID: "${curId}": ${cur.title}` });
      }
      if (!curHasDate) {
        errors.push({ kind: "format", file, line: cur.lineIdx + 1, message: `missing :DATE:: ${cur.title}` });
      }
      headings.push({ file, lineIdx: cur.lineIdx, title: cur.title, tags: cur.tags, id: curId, hasDate: curHasDate });
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
        curHasDate = false;
        inProps = false;
      } else if (line === ":PROPERTIES:") {
        if (inProps) {
          errors.push({ kind: "format", file, line: i + 1, message: "nested :PROPERTIES:" });
        }
        inProps = true;
        propsStartLine = i;
      } else if (line === ":END:") {
        if (!inProps) {
          errors.push({ kind: "format", file, line: i + 1, message: "orphan :END:" });
        }
        inProps = false;
      } else if (inProps) {
        const idMatch = line.match(/^:ID:\s+(\S+)/);
        if (idMatch) curId = idMatch[1];
        const dateMatch = line.match(/^:DATE:\s+(\S+)/);
        if (dateMatch) {
          curHasDate = true;
          if (!DATE_RE.test(dateMatch[1])) {
            errors.push({ kind: "format", file, line: i + 1, message: `malformed :DATE: "${dateMatch[1]}"` });
          }
        }
      }
    }
    flush();
    if (inProps) {
      errors.push({ kind: "format", file, line: propsStartLine + 1, message: "unclosed :PROPERTIES:" });
    }
  }

  // Link integrity
  const validIds = new Set(headings.filter((h) => h.id).map((h) => h.id!));

  for (const file of CATEGORY_FILES) {
    let content: string;
    try {
      content = readFileSync(join(orgRoot, file), "utf8");
    } catch {
      continue;
    }
    ID_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ID_LINK_RE.exec(content)) !== null) {
      if (!validIds.has(m[1])) {
        errors.push({ kind: "link", file, message: `broken id:${m[1]}` });
      }
    }
  }

  // ID uniqueness
  const idCounts = new Map<string, number>();
  for (const h of headings) {
    if (!h.id) continue;
    idCounts.set(h.id, (idCounts.get(h.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ kind: "id", file: "entities.org", message: `duplicate :ID: ${id} (${count} occurrences)` });
    }
  }

  return { errors, headingCount: headings.length };
}
