import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintWiki } from "../lint.js";

const TMP = join(import.meta.dirname, "__tmp_lint__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function writeOrg(name: string, content: string) {
  writeFileSync(join(TMP, name), content);
}

const validHeading = `* Test Entity                                                    :entity:
:PROPERTIES:
:ID:       20260503T120000
:DATE:     [2026-05-03]
:SOURCES:  raw/test.org
:END:

** Overview

A test entity.
`;

describe("lintWiki", () => {
  it("passes on valid wiki files", () => {
    writeOrg("entities.org", validHeading);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors).toHaveLength(0);
    expect(result.headingCount).toBe(1);
  });

  it("detects missing tag", () => {
    writeOrg("entities.org", `* No Tag Here
:PROPERTIES:
:ID:       20260503T120000
:DATE:     [2026-05-03]
:END:
`);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.message.includes("missing tag"))).toBe(true);
  });

  it("detects tag mismatch", () => {
    writeOrg("entities.org", `* Wrong Tag                                                  :concept:
:PROPERTIES:
:ID:       20260503T120000
:DATE:     [2026-05-03]
:END:
`);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.message.includes("tag mismatch"))).toBe(true);
  });

  it("detects missing :ID:", () => {
    writeOrg("entities.org", `* No ID                                                      :entity:
:PROPERTIES:
:DATE:     [2026-05-03]
:END:
`);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.message.includes("missing :ID:"))).toBe(true);
  });

  it("detects malformed :ID:", () => {
    writeOrg("entities.org", `* Bad ID                                                     :entity:
:PROPERTIES:
:ID:       not-a-timestamp
:DATE:     [2026-05-03]
:END:
`);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.message.includes("malformed :ID:"))).toBe(true);
  });

  it("detects missing :DATE:", () => {
    writeOrg("entities.org", `* No Date                                                    :entity:
:PROPERTIES:
:ID:       20260503T120000
:END:
`);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.message.includes("missing :DATE:"))).toBe(true);
  });

  it("detects broken links", () => {
    writeOrg("entities.org", validHeading + "\n- [[id:99990101T000000][Nonexistent]]\n");
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.kind === "link")).toBe(true);
  });

  it("detects duplicate IDs", () => {
    writeOrg("entities.org", validHeading);
    writeOrg("concepts.org", `* Dupe                                                       :concept:
:PROPERTIES:
:ID:       20260503T120000
:DATE:     [2026-05-03]
:END:
`);
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.kind === "id")).toBe(true);
  });

  it("detects orphan :END:", () => {
    writeOrg("entities.org", `:END:
` + validHeading);
    writeOrg("concepts.org", "");
    writeOrg("sources.org", "");
    writeOrg("analyses.org", "");
    const result = lintWiki(TMP);
    expect(result.errors.some((e) => e.message.includes("orphan :END:"))).toBe(true);
  });

  it("handles missing files gracefully", () => {
    const result = lintWiki(TMP);
    expect(result.errors).toHaveLength(0);
    expect(result.headingCount).toBe(0);
  });
});
