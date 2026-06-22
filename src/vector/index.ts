import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";
import { readConfig } from "../config.js";
import { resolveVectorConfig, requireApiKey } from "./config.js";
import { openVectorDb, closeVectorDb, stats, listPages } from "./db.js";
import { indexPages } from "./indexer.js";
import { searchPages, similarPages } from "./search.js";
import { runCluster } from "./cluster.js";

export const VECTOR_HELP = `\
${pc.bold("ingest vector")}  Vector embedding, semantic search, and clustering.

${pc.bold("Usage")}
  ingest vector index [--force]     compute/update page embeddings
  ingest vector search <query>      semantic search over wiki pages
  ingest vector similar <id>        find pages semantically similar to <id>
  ingest vector cluster [--k N]     cluster pages and write clusters.org
  ingest vector stats               show vector index statistics

${pc.bold("Options")}
      --force     re-embed all pages (ignore cache)
      --k N       number of clusters (default 8)
      --limit N   max results for search/similar (default 10)
      --output P  output path for cluster export (default clusters.org)
`;

function findOrgRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "ingest-lock.json"))) {
      return realpathSync(dir);
    }
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error(
        "Could not find org root (directory with ingest-lock.json). " +
          "Run 'ingest init' to scaffold a new wiki.",
      );
    }
    dir = parent;
  }
}

function getOpt(args: string[], name: string): string | undefined {
  const eqPrefix = name + "=";
  const eq = args.find((a) => a.startsWith(eqPrefix));
  if (eq) return eq.slice(eqPrefix.length);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    const next = args[idx + 1];
    if (!next.startsWith("-")) return next;
  }
  return undefined;
}

function parseLimit(args: string[]): number {
  const s = getOpt(args, "--limit") ?? "10";
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

async function cmdVectorIndex(orgRoot: string, args: string[]): Promise<void> {
  const config = resolveVectorConfig(readConfig(orgRoot).vector, orgRoot);
  requireApiKey(config);
  const force = args.includes("--force");
  console.log(pc.cyan("•") + " Indexing wiki pages...");
  const result = await indexPages(orgRoot, config, {
    force,
    onProgress: (done, total, id) => {
      process.stdout.write(
        `\r${pc.cyan("•")} ${done}/${total} ${pc.dim(id)}`,
      );
    },
  });
  process.stdout.write("\n");
  console.log(
    pc.green("✓") +
      ` indexed ${result.indexed}, skipped ${result.skipped}, removed ${result.removed}` +
      (result.errors > 0 ? `, errors ${result.errors}` : ""),
  );
}

async function cmdVectorSearch(orgRoot: string, args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("-"));
  const query = positional.slice(2).join(" ");
  if (!query) {
    console.error(pc.red("✗") + " usage: ingest vector search <query>");
    process.exit(1);
  }
  const config = resolveVectorConfig(readConfig(orgRoot).vector, orgRoot);
  requireApiKey(config);
  const limit = parseLimit(args);
  const results = await searchPages(query, config, limit);
  printResults(config.dbPath, results);
}

function cmdVectorSimilar(orgRoot: string, args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("-"));
  const id = positional[2];
  if (!id) {
    console.error(pc.red("✗") + " usage: ingest vector similar <id>");
    process.exit(1);
  }
  const config = resolveVectorConfig(readConfig(orgRoot).vector, orgRoot);
  const limit = parseLimit(args);
  const results = similarPages(id, config, limit);
  printResults(config.dbPath, results);
  return Promise.resolve();
}

function printResults(dbPath: string, results: Array<{ id: string; score: number }>): void {
  const db = openVectorDb(dbPath);
  try {
    const pages = new Map(listPages(db).map((p) => [p.id, p]));
    for (const r of results) {
      const p = pages.get(r.id);
      const title = p?.title ?? r.id;
      const score = (r.score * 100).toFixed(1);
      console.log(`${pc.dim(score + "%")}  ${title} ${pc.dim(r.id)}`);
    }
  } finally {
    closeVectorDb(db);
  }
}

async function cmdVectorCluster(orgRoot: string, args: string[]): Promise<void> {
  const config = resolveVectorConfig(readConfig(orgRoot).vector, orgRoot);
  const kStr = getOpt(args, "--k") ?? "8";
  const k = Number.parseInt(kStr, 10);
  if (!Number.isFinite(k) || k <= 0) {
    console.error(pc.red("✗") + " invalid --k");
    process.exit(1);
  }
  const outputPath = getOpt(args, "--output") ?? join(orgRoot, "clusters.org");
  const result = await runCluster(config, k, outputPath);
  console.log(
    pc.green("✓") +
      ` ${result.pageCount} pages clustered into ${result.k} groups → ${pc.cyan(result.outputPath)}`,
  );
}

function cmdVectorStats(orgRoot: string): void {
  const config = resolveVectorConfig(readConfig(orgRoot).vector, orgRoot);
  const db = openVectorDb(config.dbPath);
  try {
    const s = stats(db);
    console.log(`Vector DB: ${pc.cyan(config.dbPath)}`);
    console.log(`Provider:  ${config.provider}:${config.model} (${config.dimensions}d)`);
    console.log(`Pages:     ${s.pageCount}`);
  } finally {
    closeVectorDb(db);
  }
}

export async function cmdVector(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(VECTOR_HELP);
    return;
  }

  const positional = args.filter((a) => !a.startsWith("-"));
  const sub = positional[1];
  const orgRoot = findOrgRoot(process.cwd());

  switch (sub) {
    case "index":
      return cmdVectorIndex(orgRoot, args);
    case "search":
      return cmdVectorSearch(orgRoot, args);
    case "similar":
      return cmdVectorSimilar(orgRoot, args);
    case "cluster":
      return cmdVectorCluster(orgRoot, args);
    case "stats":
      return cmdVectorStats(orgRoot);
    default:
      console.error(pc.red("✗") + ` unknown vector subcommand: ${sub}`);
      console.error(pc.dim("  run 'ingest vector --help' for usage"));
      process.exit(1);
  }
}
