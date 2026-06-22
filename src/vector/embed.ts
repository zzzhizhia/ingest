import type { ResolvedVectorConfig } from "./config.js";

export type EmbeddingResult = {
  embeddings: Float32Array[];
  usage?: { prompt_tokens: number; total_tokens: number };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatchOnce(
  texts: string[],
  config: ResolvedVectorConfig,
): Promise<EmbeddingResult> {
  const body: Record<string, unknown> = {
    input: texts,
    model: config.model,
    encoding_format: "float",
  };
  // DashScope / OpenAI-compatible dimension parameter.
  if (config.dimensions) body.dimensions = config.dimensions;

  const res = await fetch(`${config.apiBase}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Embedding API error ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ embedding: number[]; index: number }>;
    usage?: { prompt_tokens: number; total_tokens: number };
  };

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Embedding API returned no data array");
  }

  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const dim = config.dimensions || sorted[0]?.embedding.length || 0;
  const embeddings = sorted.map((d) => {
    const arr = new Float32Array(dim);
    for (let i = 0; i < dim; i++) arr[i] = d.embedding[i] ?? 0;
    return arr;
  });

  return { embeddings, usage: json.usage };
}

export async function embedBatch(
  texts: string[],
  config: ResolvedVectorConfig,
  opts?: { batchSize?: number; retries?: number },
): Promise<EmbeddingResult> {
  const batchSize = opts?.batchSize ?? 10;
  const retries = opts?.retries ?? 2;

  const allEmbeddings: Float32Array[] = [];
  let totalPromptTokens = 0;
  let totalTokens = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await embedBatchOnce(batch, config);
        allEmbeddings.push(...result.embeddings);
        if (result.usage) {
          totalPromptTokens += result.usage.prompt_tokens;
          totalTokens += result.usage.total_tokens;
        }
        break;
      } catch (e) {
        lastErr = e as Error;
        if (attempt < retries) {
          await sleep(500 * (attempt + 1));
        }
      }
    }

    if (lastErr && allEmbeddings.length < i + batch.length) {
      throw new Error(
        `Failed to embed batch ${i / batchSize + 1}: ${lastErr.message}`,
      );
    }
  }

  return {
    embeddings: allEmbeddings,
    usage: { prompt_tokens: totalPromptTokens, total_tokens: totalTokens },
  };
}

export async function embedQuery(
  text: string,
  config: ResolvedVectorConfig,
): Promise<Float32Array> {
  const result = await embedBatch([text], config);
  return result.embeddings[0]!;
}
