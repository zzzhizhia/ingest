import { writeFileSync } from "node:fs";
import {
  clearClusters,
  closeVectorDb,
  getAllEmbeddings,
  insertCluster,
  insertClusterMember,
  listPages,
  normalize,
  openVectorDb,
} from "./db.js";
import type { ResolvedVectorConfig } from "./config.js";

type Point = { id: string; embedding: Float32Array };
type Cluster = {
  id?: number;
  center: Float32Array;
  members: Array<{ id: string; distance: number }>;
};

function vectorAdd(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + b[i]!;
  return out;
}

function vectorDivScalar(v: Float32Array, s: number): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / s;
  return out;
}

function squaredDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

function kmeans(points: Point[], k: number, maxIter = 100): Cluster[] {
  if (points.length === 0) return [];
  if (k > points.length) k = points.length;
  if (k <= 0) return [];

  const dim = points[0]!.embedding.length;
  const normalized = points.map((p) => ({ id: p.id, embedding: normalize(p.embedding) }));

  // Deterministic init: first k points as initial centroids.
  let centroids: Float32Array[] = normalized
    .slice(0, k)
    .map((p) => new Float32Array(p.embedding));

  let assignments = new Int32Array(normalized.length);
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    let changed = false;
    for (let i = 0; i < normalized.length; i++) {
      const p = normalized[i]!.embedding;
      let best = 0;
      let bestDist = squaredDistance(p, centroids[0]!);
      for (let c = 1; c < k; c++) {
        const d = squaredDistance(p, centroids[c]!);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    // Recompute centroids
    const sums = Array.from({ length: k }, () => new Float32Array(dim));
    const counts = new Int32Array(k);
    for (let i = 0; i < normalized.length; i++) {
      const c = assignments[i]!;
      sums[c] = vectorAdd(sums[c]!, normalized[i]!.embedding);
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = normalize(vectorDivScalar(sums[c]!, counts[c]));
      }
    }

    if (!changed) break;
  }

  const clusters: Cluster[] = Array.from({ length: k }, () => ({
    center: new Float32Array(dim),
    members: [],
  }));
  for (let c = 0; c < k; c++) clusters[c]!.center = centroids[c]!;

  for (let i = 0; i < normalized.length; i++) {
    const c = assignments[i]!;
    const dist = Math.sqrt(squaredDistance(normalized[i]!.embedding, centroids[c]!));
    clusters[c]!.members.push({ id: normalized[i]!.id, distance: dist });
  }

  // Sort members by distance ascending
  for (const c of clusters) {
    c.members.sort((a, b) => a.distance - b.distance);
  }

  return clusters;
}

function formatOrgTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatClusterOrg(
  runAt: string,
  k: number,
  clusters: Cluster[],
  titles: Map<string, string>,
): string {
  const id = formatOrgTimestamp();
  const lines: string[] = [
    `* Vector Clusters (k=${k})                                            :analysis:`,
    `:PROPERTIES:`,
    `:ID:       ${id}`,
    `:DATE:     [${runAt.slice(0, 10)}]`,
    `:SOURCES:  ingest vector cluster`,
    `:END:`,
    "",
  ];

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    lines.push(`** Cluster ${i} — ${c.members.length} pages`);
    for (const m of c.members) {
      const title = titles.get(m.id) || "Untitled";
      lines.push(`- [[id:${m.id}][${title}]] — distance ${m.distance.toFixed(4)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export type ClusterResult = {
  outputPath: string;
  k: number;
  pageCount: number;
};

export async function runCluster(
  config: ResolvedVectorConfig,
  k: number,
  outputPath: string,
): Promise<ClusterResult> {
  const db = openVectorDb(config.dbPath);
  try {
    const rows = getAllEmbeddings(db);
    if (rows.length === 0) {
      throw new Error("No embeddings found. Run `ingest vector index` first.");
    }

    const clusters = kmeans(rows, k);
    const runAt = new Date().toISOString();

    clearClusters(db);
    const titles = new Map<string, string>();

    // Save clusters to DB
    for (const c of clusters) {
      const clusterId = insertCluster(db, runAt, k, null, c.center);
      for (const m of c.members) {
        insertClusterMember(db, clusterId, m.id, m.distance);
      }
    }

    for (const p of listPages(db)) titles.set(p.id, p.title);

    const org = formatClusterOrg(runAt, k, clusters, titles);
    writeFileSync(outputPath, org);

    return { outputPath, k, pageCount: rows.length };
  } finally {
    closeVectorDb(db);
  }
}
