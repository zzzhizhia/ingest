export const CATEGORY_FILES = [
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
] as const;

export type CategoryFile = (typeof CATEGORY_FILES)[number];

export const EXPECTED_TAG: Record<CategoryFile, string> = {
  "entities.org": "entity",
  "concepts.org": "concept",
  "sources.org": "source",
  "analyses.org": "analysis",
};

export const WIKI_FILES = [
  ...CATEGORY_FILES,
  "summary.org",
  "ingest-lock.json",
];

export const SUBMODULE_WIKI_FILES = [...CATEGORY_FILES];
