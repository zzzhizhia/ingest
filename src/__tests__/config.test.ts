import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../config.js";

const TMP = join(import.meta.dirname, "__tmp_config__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("readConfig", () => {
  it("returns defaults when no config file exists", () => {
    const cfg = readConfig(TMP);
    expect(cfg.model).toBe("sonnet");
    expect(cfg.effort).toBe("medium");
    expect(cfg.allowedTools).toContain("Read");
    expect(cfg.prompt).toBeUndefined();
  });

  it("reads model and effort from ingest.json", () => {
    writeFileSync(
      join(TMP, "ingest.json"),
      JSON.stringify({ model: "haiku", effort: "low" }),
    );
    const cfg = readConfig(TMP);
    expect(cfg.model).toBe("haiku");
    expect(cfg.effort).toBe("low");
  });

  it("merges partial config with defaults", () => {
    writeFileSync(
      join(TMP, "ingest.json"),
      JSON.stringify({ model: "opus" }),
    );
    const cfg = readConfig(TMP);
    expect(cfg.model).toBe("opus");
    expect(cfg.effort).toBe("medium");
    expect(cfg.allowedTools).toContain("Read");
  });

  it("reads allowedTools override", () => {
    writeFileSync(
      join(TMP, "ingest.json"),
      JSON.stringify({ allowedTools: ["Read", "Write"] }),
    );
    const cfg = readConfig(TMP);
    expect(cfg.allowedTools).toEqual(["Read", "Write"]);
  });

  it("reads prompt config", () => {
    writeFileSync(
      join(TMP, "ingest.json"),
      JSON.stringify({ prompt: { systemAppend: "extra", userPrefix: "prefix" } }),
    );
    const cfg = readConfig(TMP);
    expect(cfg.prompt?.systemAppend).toBe("extra");
    expect(cfg.prompt?.userPrefix).toBe("prefix");
  });

  it("throws on invalid JSON", () => {
    writeFileSync(join(TMP, "ingest.json"), "not json{");
    expect(() => readConfig(TMP)).toThrow("invalid JSON");
  });

  it("throws on non-object JSON", () => {
    writeFileSync(join(TMP, "ingest.json"), '"string"');
    expect(() => readConfig(TMP)).toThrow("expected object");
  });

  it("ignores unknown fields", () => {
    writeFileSync(
      join(TMP, "ingest.json"),
      JSON.stringify({ model: "haiku", unknownField: true }),
    );
    const cfg = readConfig(TMP);
    expect(cfg.model).toBe("haiku");
    expect((cfg as unknown as Record<string, unknown>).unknownField).toBeUndefined();
  });
});
