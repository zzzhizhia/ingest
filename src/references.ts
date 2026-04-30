import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

// Skip any link whose target starts with these schemes.
const EXTERNAL_SCHEME = /^(https?|ftp|mailto|id|file\+sys|doi|tel|news):/i;

// org-mode links:   [[target]]  [[target][desc]]  [[file:target][desc]]
const ORG_LINK = /\[\[(?:file:)?([^\]\[]+?)(?:\]\[[^\]]*)?\]\]/g;

// markdown links & images:  [text](target)  ![alt](target)
const MD_LINK = /!?\[[^\]]*\]\(([^)\s]+)\)/g;

// Binary formats: can't parse as text. No references to extract.
const BINARY_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

/**
 * Parse a source file for references to other local files.
 * Returns repo-relative paths of existing sibling/descendant files only.
 * External URLs, org-id links, anchors are excluded.
 * Binary formats (e.g. PDF) return empty — they can't reference other files.
 */
export function extractReferencedFiles(
  orgRoot: string,
  sourceRel: string,
): string[] {
  if (BINARY_EXT.has(extname(sourceRel).toLowerCase())) return [];

  const absSource = join(orgRoot, sourceRel);
  const content = readFileSync(absSource, "utf8");
  const sourceDir = dirname(absSource);

  const refs = new Set<string>();

  for (const re of [ORG_LINK, MD_LINK]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let target = m[1].trim();
      if (!target) continue;
      if (EXTERNAL_SCHEME.test(target)) continue;
      if (target.startsWith("#")) continue;

      // strip anchor fragment, e.g. "file.org::*heading"
      target = target.split(/::/)[0];
      if (!target) continue;

      const abs = resolve(sourceDir, target);
      if (abs === absSource) continue;
      if (!existsSync(abs)) continue;

      refs.add(relative(orgRoot, abs));
    }
  }

  return [...refs].sort();
}
