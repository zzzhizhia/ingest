import pc from "picocolors";

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
