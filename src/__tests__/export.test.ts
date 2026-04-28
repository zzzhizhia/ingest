import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bfs,
  buildBackIndex,
  buildById,
  denoteStem,
  loadPages,
  rewriteBodyForExport,
  runExport,
  slugify,
} from "../export.js";

const TMP = join(import.meta.dirname, "__tmp_export__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function seed(name: string, lines: string[]): void {
  writeFileSync(join(TMP, name), lines.join("\n") + "\n");
}

function fixtureWiki(): void {
  seed("entities.org", [
    "* Alice                                                            :entity:",
    ":PROPERTIES:",
    ":ID:       20260101T000001",
    ":DATE:     [2026-01-01]",
    ":END:",
    "",
    "** Overview",
    "",
    "Alice knows [[id:20260101T000002][Bob]] and [[id:20260101T000003][Carol]].",
    "",
    "** Content",
    "",
    "She also references [[id:99999999T999999][Outside]] which is not in the wiki.",
    "",
    "* Bob                                                              :entity:",
    ":PROPERTIES:",
    ":ID:       20260101T000002",
    ":DATE:     [2026-01-01]",
    ":END:",
    "",
    "** Overview",
    "",
    "Bob is a friend of [[id:20260101T000001][Alice]].",
    "",
  ]);
  seed("concepts.org", [
    "* Carol                                                            :concept:",
    ":PROPERTIES:",
    ":ID:       20260101T000003",
    ":DATE:     [2026-01-01]",
    ":END:",
    "",
    "Just a leaf concept page.",
    "",
  ]);
  seed("sources.org", []);
  seed("analyses.org", []);
}

describe("loadPages", () => {
  it("parses titles, tags, ids and forwards", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const ids = pages.map((p) => p.id).sort();
    expect(ids).toEqual([
      "20260101T000001",
      "20260101T000002",
      "20260101T000003",
    ]);
    const alice = pages.find((p) => p.id === "20260101T000001")!;
    expect(alice.title).toBe("Alice");
    expect(alice.tags).toEqual(["entity"]);
    expect(alice.file).toBe("entities.org");
    expect(alice.forwards.sort()).toEqual([
      "20260101T000002",
      "20260101T000003",
      "99999999T999999",
    ]);
    expect(alice.bodyOrg).not.toContain(":PROPERTIES:");
  });

  it("returns empty pages list when category files are absent", () => {
    expect(loadPages(TMP)).toEqual([]);
  });
});

describe("bfs", () => {
  it("collects start + N hops out", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const byId = buildById(pages);
    const back = buildBackIndex(pages);
    const sel = bfs("20260101T000001", byId, back, 1, false);
    expect([...sel].sort()).toEqual([
      "20260101T000001",
      "20260101T000002",
      "20260101T000003",
    ]);
  });

  it("ignores forward links to ids not in the wiki", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const byId = buildById(pages);
    const back = buildBackIndex(pages);
    const sel = bfs("20260101T000001", byId, back, 1, false);
    expect(sel.has("99999999T999999")).toBe(false);
  });

  it("with depth=0 returns just the start node", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const byId = buildById(pages);
    const back = buildBackIndex(pages);
    const sel = bfs("20260101T000003", byId, back, 0, false);
    expect([...sel]).toEqual(["20260101T000003"]);
  });

  it("backlinks=true pulls in pages that reference start", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const byId = buildById(pages);
    const back = buildBackIndex(pages);
    // Carol forwards: none. But Alice forwards to Carol → Carol's backlink includes Alice.
    const sel = bfs("20260101T000003", byId, back, 1, true);
    expect(sel.has("20260101T000001")).toBe(true);
  });
});

describe("rewriteBodyForExport", () => {
  it("rewrites in-selection links to internal anchors and out-of-selection to verbatim", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const byId = buildById(pages);
    const selected = new Set(["20260101T000001", "20260101T000002"]);
    const body = "See [[id:20260101T000002][Bob]] and [[id:20260101T000003][Carol]] and [[id:99999999T999999][Outside]].";
    const out = rewriteBodyForExport(body, selected, byId);
    expect(out).toContain("[[#20260101T000002][Bob]]");
    expect(out).toContain("=Carol=");
    expect(out).toContain("=Outside=");
  });

  it("uses page title when display text is empty", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const byId = buildById(pages);
    const selected = new Set(["20260101T000001", "20260101T000002"]);
    const out = rewriteBodyForExport("[[id:20260101T000002]]", selected, byId);
    expect(out).toBe("[[#20260101T000002][Bob]]");
  });
});

describe("slugify", () => {
  it("keeps lowercase ASCII alnum and CJK ideographs", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("巴菲特致股东信 1965")).toBe("巴菲特致股东信-1965");
  });
  it("collapses runs of non-allowed chars and trims hyphens", () => {
    expect(slugify("--Foo___Bar!!!")).toBe("foo-bar");
  });
  it("returns empty string when no allowed chars", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("denoteStem", () => {
  it("produces TS--slug__category_wiki_export", () => {
    fixtureWiki();
    const pages = loadPages(TMP);
    const alice = pages.find((p) => p.id === "20260101T000001")!;
    const stem = denoteStem(alice);
    expect(stem).toMatch(/^[0-9]{8}T[0-9]{6}--alice__entity_wiki_export$/);
  });
});

describe("runExport", () => {
  it("writes a self-contained HTML with TOC, idx-meta, page sections, anchors", async () => {
    fixtureWiki();
    const out = join(TMP, "out.html");
    const result = await runExport(TMP, {
      startId: "20260101T000001",
      depth: 1,
      backlinks: false,
      outputPath: out,
    });
    expect(result.outputPath).toBe(out);
    expect(result.pageCount).toBe(3);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="20260101T000001"'); // start anchor
    expect(html).toContain('id="20260101T000002"'); // bob anchor
    expect(html).toContain('id="table-of-contents"');
    expect(html).toContain('class="idx-meta"');
    expect(html).toContain("depth=1");
    expect(html).toContain("backlinks=off");
    expect(html).toContain("共 3 页");
    expect(html).toContain('<a href="#20260101T000002">'); // in-selection link
    // Out-of-selection link should NOT appear as anchor
    expect(html).not.toContain('href="#99999999T999999"');
    // Tag badge
    expect(html).toContain('<span class="tag">');
  });

  it("throws on unknown start id", async () => {
    fixtureWiki();
    await expect(
      runExport(TMP, {
        startId: "99999999T999999",
        depth: 1,
        backlinks: false,
        outputPath: join(TMP, "out.html"),
      }),
    ).rejects.toThrow(/No wiki page with :ID:/);
  });
});
