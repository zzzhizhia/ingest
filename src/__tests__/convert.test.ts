import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convertedPdfPath, isOfficeFile } from "../convert.js";

describe("isOfficeFile", () => {
  it("returns true for Office extensions", () => {
    for (const ext of [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]) {
      expect(isOfficeFile(`raw/drafts/file${ext}`)).toBe(true);
    }
  });

  it("returns false for non-Office extensions", () => {
    for (const ext of [".org", ".md", ".txt", ".pdf", ".png"]) {
      expect(isOfficeFile(`raw/drafts/file${ext}`)).toBe(false);
    }
  });
});

describe("convertedPdfPath", () => {
  const base = join(tmpdir(), "ingest");

  it("replaces extension with .pdf under tmpdir/ingest", () => {
    expect(convertedPdfPath("raw/drafts/slides.pptx")).toBe(
      join(base, "raw/drafts/slides.pdf"),
    );
  });

  it("preserves directory structure", () => {
    expect(convertedPdfPath("raw/clips/sub/report.docx")).toBe(
      join(base, "raw/clips/sub/report.pdf"),
    );
  });
});
