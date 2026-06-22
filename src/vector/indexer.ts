import { createHash } from "node:crypto";
import type { Page } from "../export.js";
import { loadPages } from "../export.js";
import type { ResolvedVectorConfig } from "./config.js";
import {
  closeVectorDb,
  deletePage,
  listPages,
  openVectorDb,
  upsertPage,
  type StoredPage,
} from "./db.js";
import { embedBatch } from "./embed.js";

export type IndexProgress = {
  indexed: number;
  skipped: number;
  removed: number;
  errors: number;
};

export type IndexOptions = {
  force?: boolean;
  onProgress?: (done: number, total: number, id: string) => void;
  embedFn?: (texts: string[]) => Promise<Float32Array[]>;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function pageText(page: Page): string {
  // Include title for context, then body. DashScope v4 supports 8192 tokens;
  // 4 chars/token is a rough upper bound for CJK.
  const full = `${page.title}\n\n${page.bodyOrg}`;
  const maxChars = 8192 * 4;
  return full.length > maxChars ? full.slice(0, maxChars) : full;
}

export async function indexPages(
  orgRoot: string,
  config: ResolvedVectorConfig,
  opts?: IndexOptions,
): Promise<IndexProgress> {
  const db = openVectorDb(config.dbPath);
  try {
    const pages = loadPages(orgRoot);
    const existing = new Map(listPages(db).map((p) => [p.id, p]));
    const pageIds = new Set(pages.map((p) => p.id));

    // Remove stale DB entries whose pages no longer exist or use a different signature.
    let removed = 0;
    for (const [id, p] of existing) {
      const signatureChanged =
        p.provider !== config.provider ||
        p.model !== config.model ||
        p.dimensions !== config.dimensions;
      if (!pageIds.has(id) || (signatureChanged && !opts?.force)) {
        deletePage(db, id);
        removed++;
      }
    }

    const pending: Array<{ page: Page; bodyHash: string }> = [];
    for (const page of pages) {
      const bodyHash = sha256(page.bodyOrg);
      const ex = existing.get(page.id);
      if (!opts?.force && ex && ex.bodyHash === bodyHash && ex.provider === config.provider && ex.model === config.model && ex.dimensions === config.dimensions) {
        continue;
      }
      pending.push({ page, bodyHash });
    }

    const progress: IndexProgress = {
      indexed: 0,
      skipped: pages.length - pending.length,
      removed,
      errors: 0,
    };

    if (pending.length === 0) {
      return progress;
    }

    const texts = pending.map(({ page }) => pageText(page));
    const embedFn =
      opts?.embedFn ??
      ((texts: string[]) => embedBatch(texts, config).then((r) => r.embeddings));
    const embeddings = await embedFn(texts);

    const now = new Date().toISOString();
    for (let i = 0; i < pending.length; i++) {
      const { page, bodyHash } = pending[i]!;
      const embedding = embeddings[i];
      if (!embedding) {
        progress.errors++;
        continue;
      }
      const stored: StoredPage = {
        id: page.id,
        title: page.title,
        file: page.file,
        bodyHash,
        provider: config.provider,
        model: config.model,
        dimensions: config.dimensions,
        indexedAt: now,
      };
      upsertPage(db, stored, embedding);
      progress.indexed++;
      opts?.onProgress?.(progress.indexed, pending.length, page.id);
    }

    return progress;
  } finally {
    closeVectorDb(db);
  }
}
