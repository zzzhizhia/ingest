import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractReferencedFiles } from "../references.js";

const TMP = join(import.meta.dirname, "__tmp_refs__");

function make(rel: string, content = ""): void {
  const full = join(TMP, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("extractReferencedFiles", () => {
  it("returns empty when no refs", () => {
    make("raw/drafts/note.org", "plain text, no links.\n");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([]);
  });

  it("extracts org-mode [[file:...]] links", () => {
    make("raw/drafts/note.org", "See [[file:image.png][pic]].\n");
    make("raw/drafts/image.png");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([
      "raw/drafts/image.png",
    ]);
  });

  it("extracts bare [[path]] links", () => {
    make("raw/drafts/pkg/session.org", "ref [[01-shot.png]] here\n");
    make("raw/drafts/pkg/01-shot.png");
    expect(extractReferencedFiles(TMP, "raw/drafts/pkg/session.org")).toEqual([
      "raw/drafts/pkg/01-shot.png",
    ]);
  });

  it("extracts markdown images and links", () => {
    make("raw/drafts/note.md", "![pic](./img.png)\n[link](data.txt)\n");
    make("raw/drafts/img.png");
    make("raw/drafts/data.txt");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.md")).toEqual([
      "raw/drafts/data.txt",
      "raw/drafts/img.png",
    ]);
  });

  it("skips external URLs and id: links", () => {
    make(
      "raw/drafts/note.org",
      "[[https://example.com][site]] [[id:20260101T000000][page]] [[mailto:x@y.z]]\n",
    );
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([]);
  });

  it("skips anchors and non-existent files", () => {
    make("raw/drafts/note.org", "[[#section]] [[file:missing.png]]\n");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([]);
  });

  it("rejects paths that escape the repo", () => {
    make("raw/drafts/note.org", "[[../../../etc/passwd]]\n");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([]);
  });

  it("strips org heading anchors (file.org::*heading)", () => {
    make("raw/drafts/note.org", "[[file:other.org::*intro][see]]\n");
    make("raw/drafts/other.org");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([
      "raw/drafts/other.org",
    ]);
  });

  it("deduplicates multiple references to same file", () => {
    make("raw/drafts/note.org", "[[img.png]] and [[./img.png]] again\n");
    make("raw/drafts/img.png");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([
      "raw/drafts/img.png",
    ]);
  });

  it("does not include the source file itself", () => {
    make("raw/drafts/note.org", "self link [[./note.org]]\n");
    expect(extractReferencedFiles(TMP, "raw/drafts/note.org")).toEqual([]);
  });
});
