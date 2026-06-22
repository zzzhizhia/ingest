import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface VectorConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  apiBase?: string;
  dimensions?: number;
  dbPath?: string;
}

export interface IngestConfig {
  model: string;
  effort: string;
  noPull: boolean;
  allowedTools: string[];
  prompt?: {
    systemAppend?: string;
    userPrefix?: string;
  };
  vector?: VectorConfig;
}

const DEFAULT_ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Bash(date *)",
  "Bash(date)",
  "Bash(grep *)",
  "Bash(ingest grep *)",
  "Bash(ingest rg *)",
  "Bash(git status)",
  "Bash(git log *)",
];

const DEFAULTS: IngestConfig = {
  model: "sonnet",
  effort: "medium",
  noPull: false,
  allowedTools: DEFAULT_ALLOWED_TOOLS,
};

export function configPath(orgRoot: string): string {
  return join(orgRoot, "ingest.json");
}

export function readConfig(orgRoot: string): IngestConfig {
  const p = configPath(orgRoot);
  if (!existsSync(p)) return { ...DEFAULTS };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new Error(`invalid JSON in ${p}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${p}: expected object`);
  }
  const obj = raw as Record<string, unknown>;

  return {
    model: typeof obj.model === "string" ? obj.model : DEFAULTS.model,
    effort: typeof obj.effort === "string" ? obj.effort : DEFAULTS.effort,
    noPull: typeof obj.noPull === "boolean" ? obj.noPull : DEFAULTS.noPull,
    allowedTools: Array.isArray(obj.allowedTools)
      ? (obj.allowedTools as string[])
      : DEFAULTS.allowedTools,
    prompt:
      typeof obj.prompt === "object" && obj.prompt !== null
        ? (obj.prompt as IngestConfig["prompt"])
        : undefined,
    vector:
      typeof obj.vector === "object" && obj.vector !== null
        ? (obj.vector as VectorConfig)
        : undefined,
  };
}
