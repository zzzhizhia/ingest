import { describe, expect, it } from "vitest";
import { buildPrompt, buildFixPrompt, SYSTEM_PROMPT, SUBMODULE_SYSTEM_PROMPT } from "../prompts.js";
import type { PendingFile } from "../scanner.js";

describe("SYSTEM_PROMPT", () => {
  it("contains wiki file references", () => {
    expect(SYSTEM_PROMPT).toContain("entities.org");
    expect(SYSTEM_PROMPT).toContain("sources.org");
    expect(SYSTEM_PROMPT).toContain("summary.org");
  });
});

describe("SUBMODULE_SYSTEM_PROMPT", () => {
  it("removes summary.org table row from wiki files section", () => {
    expect(SUBMODULE_SYSTEM_PROMPT).not.toContain("| summary.org");
  });

  it("says no need to update summary.org", () => {
    expect(SUBMODULE_SYSTEM_PROMPT).toContain("无需更新 summary.org");
  });
});

describe("buildPrompt", () => {
  const orgRoot = "/org";
  const emptyPdf = new Map<string, string>();

  it("lists files with [NEW] / [UPDATED] tags", () => {
    const files: PendingFile[] = [
      { rel: "raw/a.org", status: "new" },
      { rel: "raw/b.md", status: "updated" },
    ];
    const result = buildPrompt(orgRoot, files, emptyPdf);
    expect(result).toContain("[NEW] raw/a.org");
    expect(result).toContain("[UPDATED] raw/b.md");
  });

  it("includes PDF note for converted files", () => {
    const files: PendingFile[] = [
      { rel: "raw/doc.docx", status: "new" },
    ];
    const pdfMap = new Map([["raw/doc.docx", "/tmp/ingest/raw/doc.pdf"]]);
    const result = buildPrompt(orgRoot, files, pdfMap);
    expect(result).toContain("→ 读取 /tmp/ingest/raw/doc.pdf");
  });

  it("uses relative path for submodule files", () => {
    const files: PendingFile[] = [
      { rel: "subs/wiki/raw/a.org", status: "new", submoduleRoot: "/org/subs/wiki" },
    ];
    const result = buildPrompt(orgRoot, files, emptyPdf, "/org/subs/wiki");
    expect(result).toContain("raw/a.org");
    expect(result).not.toContain("subs/wiki/raw/a.org");
  });

  it("adds summary.org suffix for main repo only", () => {
    const files: PendingFile[] = [{ rel: "raw/a.org", status: "new" }];
    const main = buildPrompt(orgRoot, files, emptyPdf);
    const sub = buildPrompt(orgRoot, files, emptyPdf, "/org/subs/wiki");
    expect(main).toContain("summary.org");
    expect(sub).not.toContain("summary.org");
  });

  it("prepends userPrefix from config", () => {
    const files: PendingFile[] = [{ rel: "raw/a.org", status: "new" }];
    const config = {
      model: "sonnet",
      effort: "medium",
      allowedTools: [],
      prompt: { userPrefix: "CUSTOM PREFIX" },
    };
    const result = buildPrompt(orgRoot, files, emptyPdf, undefined, config);
    expect(result).toMatch(/^CUSTOM PREFIX/);
  });
});

describe("buildFixPrompt", () => {
  it("includes error output and file list", () => {
    const files: PendingFile[] = [
      { rel: "raw/a.org", status: "new" },
    ];
    const result = buildFixPrompt("LINK: broken id:XXX", files);
    expect(result).toContain("LINK: broken id:XXX");
    expect(result).toContain("[NEW] raw/a.org");
  });
});
