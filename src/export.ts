import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import uniorg2rehype from "uniorg-rehype";
import uniorgParse from "uniorg-parse";
import { visit } from "unist-util-visit";

// Pure-TS port of org-wiki-export.el. Walks `[[id:...]]` links N hops out
// from a starting wiki page (BFS, optionally including backlinks), then
// renders every selected page into one consolidated HTML bundle with a
// sticky TOC and SPA-style hash navigation.

export const CATEGORY_FILES = [
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
] as const;

export type CategoryFile = (typeof CATEGORY_FILES)[number];

const CATEGORY_LABEL: Record<CategoryFile, string> = {
  "entities.org": "entity",
  "concepts.org": "concept",
  "sources.org": "source",
  "analyses.org": "analysis",
};

// Order used when sorting non-start pages within the bundle.
const CATEGORY_ORDER: CategoryFile[] = [
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
];

// ── parsing ────────────────────────────────────────────────────────────────

const HEADING_TAG_RE = /(\s+)(:[a-zA-Z_]+(?::[a-zA-Z_]+)*:)\s*$/;
const ID_PROP_RE = /^\s*:ID:\s+(\S+)/m;
const ID_LINK_RE = /\[\[id:([0-9T]+)\](?:\[([^\]]*)\])?\]/g;

export type Page = {
  id: string;
  file: CategoryFile;
  title: string;
  tags: string[];
  bodyOrg: string;
  forwards: string[];
};

function cleanTitle(headingLine: string): string {
  let s = headingLine.replace(/^\*+\s+/, "").trim();
  const m = s.match(HEADING_TAG_RE);
  if (m) s = s.slice(0, m.index).trimEnd();
  return s;
}

function extractTags(headingLine: string): string[] {
  const m = headingLine.match(HEADING_TAG_RE);
  if (!m) return [];
  return m[2].split(":").filter((t) => t.length > 0);
}

function collectIdLinks(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(ID_LINK_RE)) {
    seen.add(match[1]);
  }
  return [...seen];
}

function bodyWithoutDrawer(blockText: string): string {
  // blockText is the full block including heading line. Drop the heading
  // line, then strip the first :PROPERTIES:...:END: drawer (commonly the
  // first non-blank construct after the heading), then strip leading
  // blank lines.
  const lines = blockText.split("\n");
  // Skip heading line.
  let i = 1;
  // Skip blank lines after heading.
  while (i < lines.length && lines[i].trim() === "") i++;
  // Strip property drawer if present.
  if (i < lines.length && lines[i].trim() === ":PROPERTIES:") {
    while (i < lines.length && lines[i].trim() !== ":END:") i++;
    i++; // consume :END:
    while (i < lines.length && lines[i].trim() === "") i++;
  }
  return lines.slice(i).join("\n").replace(/\s+$/, "") + "\n";
}

function parseFile(orgRoot: string, file: CategoryFile): Page[] {
  let content: string;
  try {
    content = readFileSync(join(orgRoot, file), "utf8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const pages: Page[] = [];
  let blockStart = -1;
  let headingLine = "";
  for (let i = 0; i <= lines.length; i++) {
    const line = i < lines.length ? lines[i] : null;
    const isHeading = line !== null && /^\* /.test(line);
    if (isHeading || line === null) {
      if (blockStart !== -1) {
        const blockText = lines.slice(blockStart, i).join("\n");
        const idMatch = blockText.match(ID_PROP_RE);
        if (idMatch) {
          pages.push({
            id: idMatch[1],
            file,
            title: cleanTitle(headingLine),
            tags: extractTags(headingLine),
            bodyOrg: bodyWithoutDrawer(blockText),
            forwards: collectIdLinks(blockText),
          });
        }
      }
      if (line !== null) {
        blockStart = i;
        headingLine = line;
      }
    }
  }
  return pages;
}

export function loadPages(orgRoot: string): Page[] {
  return CATEGORY_FILES.flatMap((f) => parseFile(orgRoot, f));
}

export function buildById(pages: Page[]): Map<string, Page> {
  const m = new Map<string, Page>();
  for (const p of pages) m.set(p.id, p);
  return m;
}

export function buildBackIndex(pages: Page[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of pages) {
    for (const fid of p.forwards) {
      const arr = m.get(fid) ?? [];
      arr.push(p.id);
      m.set(fid, arr);
    }
  }
  return m;
}

// ── BFS ────────────────────────────────────────────────────────────────────

export function bfs(
  startId: string,
  byId: Map<string, Page>,
  backIndex: Map<string, string[]>,
  depth: number,
  useBacklinks: boolean,
): Set<string> {
  const selected = new Set<string>([startId]);
  let frontier = [startId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const pid of frontier) {
      const page = byId.get(pid);
      if (!page) continue;
      const neighbors = new Set<string>(page.forwards);
      if (useBacklinks) {
        for (const b of backIndex.get(pid) ?? []) neighbors.add(b);
      }
      for (const n of neighbors) {
        if (byId.has(n) && !selected.has(n)) {
          selected.add(n);
          next.push(n);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return selected;
}

// ── link rewriting ─────────────────────────────────────────────────────────

export function rewriteBodyForExport(
  bodyOrg: string,
  selected: Set<string>,
  byId: Map<string, Page>,
): string {
  return bodyOrg.replace(ID_LINK_RE, (_match, target: string, label?: string) => {
    const page = byId.get(target);
    const text = (label && label.length > 0)
      ? label
      : (page ? page.title : target);
    return selected.has(target)
      ? `[[#${target}][${text}]]`
      : `=${text}=`;
  });
}

// ── HTML rendering ─────────────────────────────────────────────────────────

const headingShifter = (options?: { amount?: number }) => {
  const amount = options?.amount ?? 1;
  return (tree: unknown) => {
    visit(tree as never, "element", (node: { tagName?: string }) => {
      const m = node.tagName ? /^h([1-6])$/.exec(node.tagName) : null;
      if (m) {
        const n = Math.min(6, parseInt(m[1], 10) + amount);
        node.tagName = `h${n}`;
      }
    });
  };
};

async function renderBodyHtml(bodyOrg: string): Promise<string> {
  if (bodyOrg.trim() === "") return "";
  const file = await unified()
    .use(uniorgParse)
    .use(uniorg2rehype)
    .use(headingShifter, { amount: 1 })
    .use(rehypeStringify)
    .process(bodyOrg);
  return String(file);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tagBadgeHtml(tags: string[]): string {
  if (tags.length === 0) return "";
  const inner = tags
    .map((t) => `<span>${escapeHtml(t)}</span>`)
    .join("");
  return ` <span class="tag">${inner}</span>`;
}

function backlinksHtml(
  page: Page,
  selected: Set<string>,
  byId: Map<string, Page>,
  backIndex: Map<string, string[]>,
): string {
  const back = (backIndex.get(page.id) ?? [])
    .filter((bid) => selected.has(bid));
  const unique = [...new Set(back)].sort();
  if (unique.length === 0) return "";
  const items = unique
    .map((bid) => {
      const bp = byId.get(bid);
      if (!bp) return "";
      const cat = CATEGORY_LABEL[bp.file] ?? bp.file;
      return `<li><a href="#${bid}">${escapeHtml(bp.title)}</a> (${escapeHtml(cat)})</li>`;
    })
    .join("");
  return `<div class="backlinks-block"><h3>Backlinks</h3><ul>${items}</ul></div>`;
}

function tocHtml(ordered: Page[]): string {
  const items = ordered
    .map(
      (p) =>
        `<li><a href="#${p.id}">${escapeHtml(p.title)}</a></li>`,
    )
    .join("");
  return `<div id="table-of-contents"><h2>Table of Contents</h2><ul>${items}</ul></div>`;
}

function pageSortKey(p: Page): [number, string] {
  const idx = CATEGORY_ORDER.indexOf(p.file);
  return [idx === -1 ? CATEGORY_ORDER.length : idx, p.title];
}

async function renderPageSection(
  page: Page,
  selected: Set<string>,
  byId: Map<string, Page>,
  backIndex: Map<string, string[]>,
): Promise<string> {
  const rewritten = rewriteBodyForExport(page.bodyOrg, selected, byId);
  const bodyHtml = await renderBodyHtml(rewritten);
  const heading = `<h2 id="${page.id}">${escapeHtml(page.title)}${tagBadgeHtml(page.tags)}</h2>`;
  const back = backlinksHtml(page, selected, byId, backIndex);
  return `<div class="outline-2">${heading}${bodyHtml}${back}</div>`;
}

// CSS lifted from org-wiki-export.el verbatim. Kept readable here; the
// emitted HTML uses the original whitespace-rich form without minifying.
const CSS = `* { box-sizing: border-box; }
html, body { background: #fff; }
body {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.8em 1.6em 4em;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', sans-serif;
  line-height: 1.75;
  color: #1f2328;
}
#content {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 2.6em;
  align-items: start;
}
h1.title {
  grid-column: 1 / -1;
  font-size: 1.4em;
  margin: 0 0 1.2em;
  padding-bottom: .8em;
  border-bottom: 1px solid #eaeef2;
  color: #1f2328;
}
#table-of-contents {
  grid-column: 1;
  position: sticky;
  top: 1.2em;
  max-height: calc(100vh - 2.4em);
  overflow-y: auto;
  background: #f6f8fa;
  border: 1px solid #eaeef2;
  border-radius: 8px;
  padding: 1em 1.1em;
  font-size: .9em;
}
#table-of-contents h2 {
  font-size: .72em;
  margin: 0 0 .8em;
  padding: 0 .5em;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: #6e7781;
  border: none;
}
#table-of-contents ul { list-style: none; padding: 0; margin: 0; }
#table-of-contents li { margin: .1em 0; }
#table-of-contents a {
  color: #424a53;
  display: block;
  padding: .35em .6em;
  border-radius: 5px;
  text-decoration: none;
  line-height: 1.4;
}
#table-of-contents a:hover { color: #0969da; background: rgba(255,255,255,.7); }
#table-of-contents a.active {
  color: #0969da;
  background: #fff;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(31,35,40,.08);
}
#main-pane { grid-column: 2; min-width: 0; }
.idx-meta {
  margin: 0 0 1.5em;
  font-size: .85em;
  color: #6e7781;
}
.idx-meta code { color: #6e7781; background: transparent; padding: 0; }
.idx-meta .star { color: #bf8700; }
.outline-2 { margin: 0; padding: 0; border: none; }
.outline-2 > h2 {
  font-size: 1.6em;
  margin: 0 0 .8em;
  padding-bottom: .35em;
  border-bottom: 1px solid #eaeef2;
}
h2 .tag {
  font-size: .5em;
  font-weight: normal;
  color: #57606a;
  vertical-align: middle;
  margin-left: .6em;
}
h2 .tag span {
  display: inline-block;
  padding: .2em .55em;
  background: #f6f8fa;
  border-radius: 3px;
  margin-left: .25em;
}
h3 { font-size: 1.15em; margin-top: 1.8em; color: #1f2328; }
h4 { font-size: 1em; color: #424a53; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
p { margin: .8em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: .25em 0; }
pre, code {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  background: #f6f8fa;
  border-radius: 3px;
}
code { padding: .15em .4em; font-size: .9em; }
pre { padding: 1em; overflow: auto; line-height: 1.4; }
pre code { padding: 0; background: transparent; font-size: .9em; }
blockquote {
  border-left: 3px solid #d1d9e0;
  color: #57606a;
  padding-left: 1em;
  margin: 1em 0 1em .2em;
}
.figure img, img { max-width: 100%; border-radius: 4px; }
.backlinks-block {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px dashed #d1d9e0;
}
.backlinks-block h3 {
  font-size: .8em;
  color: #6e7781;
  text-transform: uppercase;
  letter-spacing: .08em;
  margin-top: 0;
}
@media (max-width: 820px) {
  #content { grid-template-columns: 1fr; gap: 1.5em; }
  #table-of-contents { position: relative; max-height: none; top: auto; }
  #main-pane { grid-column: 1; }
}`;

const JS_TEMPLATE = `(function(){
var START_ID=__START_ID__;
function show(){
var t=(location.hash||'#'+START_ID).slice(1);
document.querySelectorAll('.outline-2').forEach(function(el){
var h=el.querySelector('h2[id]');
el.style.display=(h&&h.id===t)?'':'none';});
document.querySelectorAll('#table-of-contents a').forEach(function(a){
a.classList.toggle('active',a.getAttribute('href')==='#'+t);});
window.scrollTo(0,0);}
window.addEventListener('hashchange',show);
document.addEventListener('DOMContentLoaded',show);
})();`;

function buildIdxMetaHtml(
  startPage: Page,
  pageCount: number,
  depth: number,
  backlinks: boolean,
): string {
  return `<p class="idx-meta">起点 <span class="star">&#9733;</span> <a href="#${startPage.id}">${escapeHtml(startPage.title)}</a> &middot; depth=${depth} &middot; backlinks=${backlinks ? "on" : "off"} &middot; 共 ${pageCount} 页</p>`;
}

async function buildHtml(
  startPage: Page,
  ordered: Page[],
  selected: Set<string>,
  byId: Map<string, Page>,
  backIndex: Map<string, string[]>,
  depth: number,
  backlinks: boolean,
): Promise<string> {
  const sections: string[] = [];
  for (const p of ordered) {
    sections.push(await renderPageSection(p, selected, byId, backIndex));
  }
  const idxMeta = buildIdxMetaHtml(startPage, selected.size, depth, backlinks);
  const toc = tocHtml(ordered);
  const js = JS_TEMPLATE.replace("__START_ID__", JSON.stringify(startPage.id));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wiki Export · ${escapeHtml(startPage.title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<h1 class="title">Wiki Export · ${escapeHtml(startPage.title)}</h1>
<div id="content">
${toc}
<div id="main-pane">
${idxMeta}
${sections.join("\n")}
</div>
</div>
<script>
${js}
</script>
</body>
</html>
`;
}

// ── filename ───────────────────────────────────────────────────────────────

export function slugify(s: string): string {
  const out: string[] = [];
  let sep = false;
  for (const ch of (s ?? "").toLowerCase()) {
    const code = ch.codePointAt(0)!;
    const isAlnum =
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x30 && code <= 0x39); // 0-9
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff);
    if (isAlnum || isCjk) {
      out.push(ch);
      sep = false;
    } else if (!sep) {
      out.push("-");
      sep = true;
    }
  }
  return out.join("").replace(/^-+|-+$/g, "");
}

export function denoteStem(startPage: Page): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..*/, "")
    .replace("T", "T");
  // ISO output like 20260428T125930 already; isoString gives 2026-04-28T12:59:30.000Z
  const compact = ts.slice(0, 15); // YYYYMMDDTHHmmss
  const slug = slugify(startPage.title) || "untitled";
  const cat = CATEGORY_LABEL[startPage.file] ?? "page";
  return `${compact}--${slug}__${cat}_wiki_export`;
}

// ── public API ─────────────────────────────────────────────────────────────

export type ExportOptions = {
  startId: string;
  depth: number;
  backlinks: boolean;
  outputPath?: string;
};

export type ExportResult = {
  outputPath: string;
  pageCount: number;
};

export async function runExport(
  orgRoot: string,
  opts: ExportOptions,
): Promise<ExportResult> {
  const pages = loadPages(orgRoot);
  const byId = buildById(pages);
  const startPage = byId.get(opts.startId);
  if (!startPage) {
    throw new Error(`No wiki page with :ID: ${opts.startId}`);
  }
  const backIndex = buildBackIndex(pages);
  const selected = bfs(opts.startId, byId, backIndex, opts.depth, opts.backlinks);

  // Order: start page first, then others sorted by [categoryIndex, title].
  const others = [...selected]
    .filter((id) => id !== opts.startId)
    .map((id) => byId.get(id)!)
    .sort((a, b) => {
      const [ka1, ka2] = pageSortKey(a);
      const [kb1, kb2] = pageSortKey(b);
      if (ka1 !== kb1) return ka1 - kb1;
      return ka2 < kb2 ? -1 : ka2 > kb2 ? 1 : 0;
    });
  const ordered = [startPage, ...others];

  const html = await buildHtml(
    startPage,
    ordered,
    selected,
    byId,
    backIndex,
    opts.depth,
    opts.backlinks,
  );

  const outputPath = opts.outputPath ?? join(orgRoot, denoteStem(startPage) + ".html");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html);

  return { outputPath, pageCount: selected.size };
}

export function listPages(orgRoot: string): void {
  const pages = loadPages(orgRoot);
  for (const p of pages) {
    const cat = CATEGORY_LABEL[p.file] ?? p.file;
    process.stdout.write(`${p.id}\t${cat}\t${p.title}\n`);
  }
}
