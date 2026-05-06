import { describe, expect, it } from "vitest";
import { parseDelay } from "../schedule.js";

describe("parseDelay", () => {
  it("parses bare number as minutes", () => {
    expect(parseDelay("30")).toBe(1800);
    expect(parseDelay("1")).toBe(60);
    expect(parseDelay("120")).toBe(7200);
  });

  it("parses m suffix", () => {
    expect(parseDelay("30m")).toBe(1800);
    expect(parseDelay("1m")).toBe(60);
  });

  it("parses h suffix", () => {
    expect(parseDelay("2h")).toBe(7200);
    expect(parseDelay("1h")).toBe(3600);
  });

  it("parses HH:MM as seconds until that time", () => {
    const result = parseDelay("09:00");
    expect(result).toBeTypeOf("number");
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(86400);
  });

  it("rejects invalid HH:MM", () => {
    expect(parseDelay("25:00")).toBeNull();
    expect(parseDelay("12:60")).toBeNull();
  });

  it("rejects zero and negative", () => {
    expect(parseDelay("0")).toBeNull();
    expect(parseDelay("0m")).toBeNull();
    expect(parseDelay("0h")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseDelay("abc")).toBeNull();
    expect(parseDelay("")).toBeNull();
    expect(parseDelay("--at")).toBeNull();
    expect(parseDelay("10x")).toBeNull();
  });
});
