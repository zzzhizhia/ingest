import { homedir } from "node:os";
import { join } from "node:path";
import type { VectorConfig } from "../config.js";

export type ResolvedVectorConfig = {
  provider: string;
  model: string;
  apiKey: string;
  apiBase: string;
  dimensions: number;
  dbPath: string;
};

const PROVIDER_DEFAULTS: Record<string, { model: string; dimensions: number; apiBase: string }> = {
  dashscope: {
    model: "text-embedding-v4",
    dimensions: 1024,
    apiBase: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  openai: {
    model: "text-embedding-3-small",
    dimensions: 1536,
    apiBase: "https://api.openai.com/v1",
  },
  zeroentropyai: {
    model: "zembed-1",
    dimensions: 2560,
    apiBase: "https://api.zeroentropy.dev/v1",
  },
  ollama: {
    model: "nomic-embed-text",
    dimensions: 768,
    apiBase: "http://localhost:11434/v1",
  },
};

function stateDir(): string {
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "ingest",
  );
}

function apiKeyForProvider(provider: string): string | undefined {
  switch (provider) {
    case "dashscope":
      return process.env.DASHSCOPE_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "zeroentropyai":
      return process.env.ZEROENTROPY_API_KEY;
    case "ollama":
      return process.env.OLLAMA_API_KEY || "ollama";
    default:
      return process.env.EMBEDDING_API_KEY;
  }
}

export function resolveVectorConfig(
  raw: VectorConfig | undefined,
  orgRoot: string,
): ResolvedVectorConfig {
  const provider = raw?.provider || "dashscope";
  const defaults = PROVIDER_DEFAULTS[provider] ?? {
    model: raw?.model || "unknown",
    dimensions: raw?.dimensions || 1024,
    apiBase: raw?.apiBase || "",
  };

  const model = raw?.model || defaults.model;
  const dimensions = raw?.dimensions ?? defaults.dimensions;
  const apiBase = raw?.apiBase || defaults.apiBase;
  const apiKey = raw?.apiKey || apiKeyForProvider(provider) || "";
  const dbPath = raw?.dbPath || join(stateDir(), "vector.db");

  return {
    provider,
    model,
    apiKey,
    apiBase,
    dimensions,
    dbPath,
  };
}

export function requireApiKey(config: ResolvedVectorConfig): string {
  if (!config.apiKey) {
    throw new Error(
      `No API key for embedding provider "${config.provider}". Set it in ingest.json (vector.apiKey) or via env var.`,
    );
  }
  return config.apiKey;
}

export function embeddingSignature(config: ResolvedVectorConfig): string {
  return `${config.provider}:${config.model}:${config.dimensions}`;
}
