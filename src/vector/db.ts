import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type DatabaseSync as Database } from "#sqlite";

export type StoredPage = {
  id: string;
  title: string;
  file: string;
  bodyHash: string;
  provider: string;
  model: string;
  dimensions: number;
  indexedAt: string;
};

export type SimilarPage = {
  id: string;
  score: number;
};

export type ClusterRow = {
  id: number;
  runAt: string;
  k: number;
  label: string | null;
  center: Float32Array;
};

export type ClusterMember = {
  clusterId: number;
  pageId: string;
  distance: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  page_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  k INTEGER NOT NULL,
  label TEXT,
  center BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS cluster_members (
  cluster_id INTEGER NOT NULL,
  page_id TEXT NOT NULL,
  distance REAL NOT NULL,
  PRIMARY KEY (cluster_id, page_id),
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
`;

export function openVectorDb(dbPath: string): Database {
  const dir = dirname(dbPath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

function float32ToBuffer(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function bufferToFloat32(b: Uint8Array): Float32Array {
  return new Float32Array(
    b.buffer,
    b.byteOffset,
    b.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * inv;
  return out;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function upsertPage(
  db: Database,
  page: StoredPage,
  embedding: Float32Array,
): void {
  const insertPage = db.prepare(
    `INSERT INTO pages (id, title, file, body_hash, provider, model, dimensions, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title,
       file=excluded.file,
       body_hash=excluded.body_hash,
       provider=excluded.provider,
       model=excluded.model,
       dimensions=excluded.dimensions,
       indexed_at=excluded.indexed_at`,
  );
  insertPage.run(
    page.id,
    page.title,
    page.file,
    page.bodyHash,
    page.provider,
    page.model,
    page.dimensions,
    page.indexedAt,
  );

  const insertEmb = db.prepare(
    `INSERT INTO embeddings (page_id, embedding) VALUES (?, ?)
     ON CONFLICT(page_id) DO UPDATE SET embedding=excluded.embedding`,
  );
  insertEmb.run(page.id, float32ToBuffer(embedding));
}

export function deletePage(db: Database, id: string): void {
  db.prepare("DELETE FROM pages WHERE id = ?").run(id);
}

export function getPage(db: Database, id: string): StoredPage | undefined {
  const row = db
    .prepare(
      "SELECT id, title, file, body_hash, provider, model, dimensions, indexed_at FROM pages WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        title: string;
        file: string;
        body_hash: string;
        provider: string;
        model: string;
        dimensions: number;
        indexed_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    title: row.title,
    file: row.file,
    bodyHash: row.body_hash,
    provider: row.provider,
    model: row.model,
    dimensions: row.dimensions,
    indexedAt: row.indexed_at,
  };
}

export function listPages(db: Database): StoredPage[] {
  const rows = db
    .prepare(
      "SELECT id, title, file, body_hash, provider, model, dimensions, indexed_at FROM pages",
    )
    .all() as Array<{
      id: string;
      title: string;
      file: string;
      body_hash: string;
      provider: string;
      model: string;
      dimensions: number;
      indexed_at: string;
    }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    file: r.file,
    bodyHash: r.body_hash,
    provider: r.provider,
    model: r.model,
    dimensions: r.dimensions,
    indexedAt: r.indexed_at,
  }));
}

export function getEmbedding(db: Database, id: string): Float32Array | undefined {
  const row = db
    .prepare("SELECT embedding FROM embeddings WHERE page_id = ?")
    .get(id) as { embedding: Uint8Array } | undefined;
  return row ? bufferToFloat32(row.embedding) : undefined;
}

export function getAllEmbeddings(
  db: Database,
): Array<{ id: string; embedding: Float32Array }> {
  const rows = db
    .prepare("SELECT page_id, embedding FROM embeddings")
    .all() as Array<{ page_id: string; embedding: Uint8Array }>;
  return rows.map((r) => ({ id: r.page_id, embedding: bufferToFloat32(r.embedding) }));
}

export function searchSimilar(
  db: Database,
  queryEmbedding: Float32Array,
  limit: number,
): SimilarPage[] {
  const q = normalize(queryEmbedding);
  const rows = getAllEmbeddings(db);
  const scored = rows
    .map(({ id, embedding }) => ({
      id,
      score: cosineSimilarity(q, embedding),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function stats(db: Database): { pageCount: number } {
  const row = db.prepare("SELECT COUNT(*) AS c FROM pages").get() as { c: number };
  return { pageCount: row.c };
}

export function clearClusters(db: Database): void {
  db.exec("DELETE FROM cluster_members");
  db.exec("DELETE FROM clusters");
}

export function insertCluster(
  db: Database,
  runAt: string,
  k: number,
  label: string | null,
  center: Float32Array,
): number {
  const result = db
    .prepare("INSERT INTO clusters (run_at, k, label, center) VALUES (?, ?, ?, ?)")
    .run(runAt, k, label, float32ToBuffer(center));
  return Number(result.lastInsertRowid);
}

export function insertClusterMember(
  db: Database,
  clusterId: number,
  pageId: string,
  distance: number,
): void {
  db.prepare(
    "INSERT INTO cluster_members (cluster_id, page_id, distance) VALUES (?, ?, ?)",
  ).run(clusterId, pageId, distance);
}

export function getClusters(db: Database): Array<{
  id: number;
  runAt: string;
  k: number;
  label: string | null;
  center: Float32Array;
  members: Array<{ pageId: string; distance: number }>;
}> {
  const clusterRows = db
    .prepare("SELECT id, run_at, k, label, center FROM clusters")
    .all() as Array<{
      id: number;
      run_at: string;
      k: number;
      label: string | null;
      center: Uint8Array;
    }>;

  const memberRows = db
    .prepare("SELECT cluster_id, page_id, distance FROM cluster_members")
    .all() as Array<{ cluster_id: number; page_id: string; distance: number }>;

  const membersByCluster = new Map<number, Array<{ pageId: string; distance: number }>>();
  for (const m of memberRows) {
    const arr = membersByCluster.get(m.cluster_id) ?? [];
    arr.push({ pageId: m.page_id, distance: m.distance });
    membersByCluster.set(m.cluster_id, arr);
  }

  return clusterRows.map((r) => ({
    id: r.id,
    runAt: r.run_at,
    k: r.k,
    label: r.label,
    center: bufferToFloat32(r.center),
    members: membersByCluster.get(r.id) ?? [],
  }));
}

export function closeVectorDb(db: Database): void {
  db.close();
}
