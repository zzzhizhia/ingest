import { describe, expect, it } from "vitest";
import {
  CATEGORY_FILES,
  EXPECTED_TAG,
  SUBMODULE_WIKI_FILES,
  WIKI_FILES,
} from "../wiki.js";

describe("CATEGORY_FILES", () => {
  it("contains exactly four org files", () => {
    expect(CATEGORY_FILES).toEqual([
      "entities.org",
      "concepts.org",
      "sources.org",
      "analyses.org",
    ]);
  });
});

describe("EXPECTED_TAG", () => {
  it("maps each category file to its tag", () => {
    expect(EXPECTED_TAG["entities.org"]).toBe("entity");
    expect(EXPECTED_TAG["concepts.org"]).toBe("concept");
    expect(EXPECTED_TAG["sources.org"]).toBe("source");
    expect(EXPECTED_TAG["analyses.org"]).toBe("analysis");
  });

  it("has exactly the CATEGORY_FILES as keys", () => {
    expect(Object.keys(EXPECTED_TAG).sort()).toEqual([...CATEGORY_FILES].sort());
  });
});

describe("WIKI_FILES", () => {
  it("includes category files plus summary.org and ingest-lock.json", () => {
    expect(WIKI_FILES).toContain("entities.org");
    expect(WIKI_FILES).toContain("summary.org");
    expect(WIKI_FILES).toContain("ingest-lock.json");
    expect(WIKI_FILES).toHaveLength(CATEGORY_FILES.length + 2);
  });
});

describe("SUBMODULE_WIKI_FILES", () => {
  it("equals CATEGORY_FILES (no summary.org or lock)", () => {
    expect(SUBMODULE_WIKI_FILES).toEqual([...CATEGORY_FILES]);
  });
});
