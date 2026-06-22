import { closeVectorDb, getEmbedding, openVectorDb, searchSimilar } from "./db.js";
import type { ResolvedVectorConfig } from "./config.js";
import { embedQuery } from "./embed.js";

export type SearchResult = {
  id: string;
  score: number;
};

export async function searchPages(
  query: string,
  config: ResolvedVectorConfig,
  limit = 10,
): Promise<SearchResult[]> {
  const queryEmbedding = await embedQuery(query, config);
  const db = openVectorDb(config.dbPath);
  try {
    return searchSimilar(db, queryEmbedding, limit);
  } finally {
    closeVectorDb(db);
  }
}

export function similarPages(
  pageId: string,
  config: ResolvedVectorConfig,
  limit = 10,
): SearchResult[] {
  const db = openVectorDb(config.dbPath);
  try {
    const embedding = getEmbedding(db, pageId);
    if (!embedding) {
      throw new Error(`No embedding found for page ${pageId}. Run \`ingest vector index\` first.`);
    }
    const results = searchSimilar(db, embedding, limit + 1);
    return results.filter((r) => r.id !== pageId).slice(0, limit);
  } finally {
    closeVectorDb(db);
  }
}
