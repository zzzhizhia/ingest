import { readFileSync } from "node:fs";

export interface OrgHeading {
  id: string | null;
  title: string;
  tags: string[];
  raw: string; // full text including heading line, properties, body
}

const TAG_BLOCK_RE = /(\s+)(:[a-zA-Z_]+(?::[a-zA-Z_]+)*:)\s*$/;
const ID_PROP_RE = /^\s*:ID:\s+(\S+)/m;

function extractTitle(headingLine: string): string {
  let s = headingLine.replace(/^\*+\s+/, "").trim();
  const m = s.match(TAG_BLOCK_RE);
  if (m) s = s.slice(0, m.index).trimEnd();
  return s;
}

function extractTags(headingLine: string): string[] {
  const m = headingLine.match(TAG_BLOCK_RE);
  if (!m) return [];
  return m[2].split(":").filter((t) => t.length > 0);
}

export function parseOrgHeadings(content: string): OrgHeading[] {
  const lines = content.split("\n");
  const headings: OrgHeading[] = [];
  let blockStart = -1;
  let headingLine = "";

  for (let i = 0; i <= lines.length; i++) {
    const line = i < lines.length ? lines[i] : null;
    const isTopHeading = line !== null && /^\* /.test(line);

    if (isTopHeading || line === null) {
      if (blockStart !== -1) {
        const raw = lines.slice(blockStart, i).join("\n");
        const idMatch = raw.match(ID_PROP_RE);
        headings.push({
          id: idMatch ? idMatch[1] : null,
          title: extractTitle(headingLine),
          tags: extractTags(headingLine),
          raw,
        });
      }
      if (line !== null) {
        blockStart = i;
        headingLine = line;
      }
    }
  }

  return headings;
}

export function parseOrgFile(path: string): OrgHeading[] {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseOrgHeadings(content);
}

export function serializeHeadings(headings: OrgHeading[]): string {
  if (headings.length === 0) return "";
  return headings.map((h) => h.raw).join("\n") + "\n";
}
