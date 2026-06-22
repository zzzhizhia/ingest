import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeVectorDb,
  getEmbedding,
  listPages,
  normalize,
  openVectorDb,
  searchSimilar,
  upsertPage,
} from "../vector/db.js";
import { resolveVectorConfig } from "../vector/config.js";
import { indexPages } from "../vector/indexer.js";
import { similarPages } from "../vector/search.js";
import { runCluster } from "../vector/cluster.js";
import { runExport } from "../export.js";

describe("vector similar", () => {
  it("finds similar pages", async () => {
    fixtureWiki();
    const dbPath = join(TMP, "vectors.db");
    const cfg = resolveVectorConfig({ dbPath }, TMP);
    const embedFn = (texts: string[]) =>
      Promise.resolve(
        texts.map((t) =>
          t.startsWith("Alice") || t.startsWith("Carol")
            ? new Float32Array([1, 0, 0, 0])
            : new Float32Array([0, 1, 0, 0]),
        ),
      );
    await indexPages(TMP, cfg, { embedFn });
    const results = similarPages("20260101T000001", cfg, 5);
    expect(results.map((r) => r.id)).toContain("20260101T000003");
  });
});

const TMP = join(import.meta.dirname, "__tmp_vector__");

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

function fakeEmbedding(text: string, dim = 4): Float32Array {
  // Deterministic but distinct vector per text.
  const v = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    v[i % dim] += text.charCodeAt(i);
  }
  return normalize(v);
}

describe("vector db", () => {
  it("stores and retrieves embeddings", () => {
    const dbPath = join(TMP, "vectors.db");
    const db = openVectorDb(dbPath);
    try {
      upsert(db, "20260101T000001", "Alice", "entities.org", "hash1", [1, 0, 0, 0]);
      const pages = listPages(db);
      expect(pages).toHaveLength(1);
      expect(pages[0]!.title).toBe("Alice");
      const emb = getEmbedding(db, "20260101T000001");
      expect(emb).toBeDefined();
      expect(emb!.length).toBe(4);
    } finally {
      closeVectorDb(db);
    }
  });

  it("returns cosine-similar pages", () => {
    const dbPath = join(TMP, "vectors.db");
    const db = openVectorDb(dbPath);
    try {
      upsert(db, "a", "A", "entities.org", "h1", [1, 0, 0, 0]);
      upsert(db, "b", "B", "entities.org", "h2", [0.9, 0.1, 0, 0]);
      upsert(db, "c", "C", "entities.org", "h3", [0, 0, 1, 0]);
      const q = new Float32Array([1, 0, 0, 0]);
      const results = searchSimilar(db, q, 2);
      expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    } finally {
      closeVectorDb(db);
    }
  });
});

describe("vector config", () => {
  it("defaults to dashscope", () => {
    const cfg = resolveVectorConfig(undefined, TMP);
    expect(cfg.provider).toBe("dashscope");
    expect(cfg.model).toBe("text-embedding-v4");
    expect(cfg.dimensions).toBe(1024);
  });

  it("uses explicit values", () => {
    const cfg = resolveVectorConfig(
      { provider: "openai", model: "text-embedding-3-small", dimensions: 512 },
      TMP,
    );
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("text-embedding-3-small");
    expect(cfg.dimensions).toBe(512);
  });
});

describe("vector indexer", () => {
  it("indexes pages and skips unchanged pages on second run", async () => {
    fixtureWiki();
    const dbPath = join(TMP, "vectors.db");
    const cfg = resolveVectorConfig({ dbPath }, TMP);

    const embedFn = (texts: string[]) =>
      Promise.resolve(texts.map((t) => fakeEmbedding(t, 8)));

    const first = await indexPages(TMP, cfg, { embedFn });
    expect(first.indexed).toBe(3);
    expect(first.skipped).toBe(0);

    const second = await indexPages(TMP, cfg, { embedFn });
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(3);
  });

  it("re-indexes changed pages", async () => {
    fixtureWiki();
    const dbPath = join(TMP, "vectors.db");
    const cfg = resolveVectorConfig({ dbPath }, TMP);
    const embedFn = (texts: string[]) =>
      Promise.resolve(texts.map((t) => fakeEmbedding(t, 8)));

    await indexPages(TMP, cfg, { embedFn });

    // Modify Carol's body.
    seed("concepts.org", [
      "* Carol                                                            :concept:",
      ":PROPERTIES:",
      ":ID:       20260101T000003",
      ":DATE:     [2026-01-01]",
      ":END:",
      "",
      "Updated content.",
      "",
    ]);

    const second = await indexPages(TMP, cfg, { embedFn });
    expect(second.indexed).toBe(1);
    expect(second.skipped).toBe(2);
  });
});

describe("vector clustering", () => {
  it("writes clusters.org", async () => {
    fixtureWiki();
    const dbPath = join(TMP, "vectors.db");
    const cfg = resolveVectorConfig({ dbPath }, TMP);
    const embedFn = (texts: string[]) =>
      Promise.resolve(texts.map((t) => fakeEmbedding(t, 8)));
    await indexPages(TMP, cfg, { embedFn });

    const output = join(TMP, "clusters.org");
    const result = await runCluster(cfg, 2, output);
    expect(result.pageCount).toBe(3);
    expect(result.k).toBe(2);
    const org = readFileSync(output, "utf8");
    expect(org).toContain("Vector Clusters");
    expect(org).toContain("[[id:20260101T000001][Alice]]");
  });
});

describe("export --semantic", () => {
  it("includes a semantically similar page not reachable by links", async () => {
    fixtureWiki();
    const dbPath = join(TMP, "vectors.db");
    writeFileSync(
      join(TMP, "ingest.json"),
      JSON.stringify({ vector: { dbPath } }),
    );
    const cfg = resolveVectorConfig({ dbPath }, TMP);

    // Give Alice and Carol identical embeddings so they are similar.
    const embedFn = (texts: string[]) =>
      Promise.resolve(
        texts.map((t) =>
          t.startsWith("Alice") || t.startsWith("Carol")
            ? new Float32Array([1, 0, 0, 0])
            : new Float32Array([0, 1, 0, 0]),
        ),
      );

    await indexPages(TMP, cfg, { embedFn });

    const out = join(TMP, "out.html");
    const result = await runExport(TMP, {
      startId: "20260101T000001",
      depth: 0,
      backlinks: false,
      semantic: 1,
      outputPath: out,
    });
    expect(result.pageCount).toBe(2); // Alice + Carol
    const html = readFileSync(out, "utf8");
    expect(html).toContain('id="20260101T000003"');
  });
});

function upsert(
  db: ReturnType<typeof openVectorDb>,
  id: string,
  title: string,
  file: string,
  bodyHash: string,
  vec: number[],
): void {
  upsertPage(
    db,
    {
      id,
      title,
      file,
      bodyHash,
      provider: "test",
      model: "test",
      dimensions: vec.length,
      indexedAt: new Date().toISOString(),
    },
    normalize(new Float32Array(vec)),
  );
}
