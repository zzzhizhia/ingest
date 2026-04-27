import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPreCommitHook, PRE_COMMIT_HOOK } from "../init.js";

const TMP = join(import.meta.dirname, "__tmp_init__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("PRE_COMMIT_HOOK content", () => {
  it("starts with bash shebang", () => {
    expect(PRE_COMMIT_HOOK.startsWith("#!/bin/bash\n")).toBe(true);
  });

  it("preserves literal ${...} parameter expansions", () => {
    expect(PRE_COMMIT_HOOK).toContain('${STAGED_CATEGORY_FILES# }');
    expect(PRE_COMMIT_HOOK).toContain('${ERRORS[@]}');
    expect(PRE_COMMIT_HOOK).toContain('${#ERRORS[@]}');
    expect(PRE_COMMIT_HOOK).toContain('${link#id:}');
  });

  it("preserves regex backslash escapes (\\*, \\[, \\])", () => {
    expect(PRE_COMMIT_HOOK).toContain('/^\\* /');
    expect(PRE_COMMIT_HOOK).toContain('\\[\\[id:[0-9T]*\\]');
    expect(PRE_COMMIT_HOOK).toContain('^\\[[0-9]{4}-[0-9]{2}-[0-9]{2}\\]$');
  });
});

describe("installPreCommitHook", () => {
  it("throws if .git is missing", () => {
    expect(() => installPreCommitHook(TMP)).toThrow(/not a git repository/i);
  });

  it("writes hook into a fresh .git/hooks", () => {
    mkdirSync(join(TMP, ".git"));
    const result = installPreCommitHook(TMP);
    expect(result.action).toBe("wrote");
    expect(result.path).toBe(join(TMP, ".git/hooks/pre-commit"));
    const content = readFileSync(result.path, "utf8");
    expect(content).toBe(PRE_COMMIT_HOOK);
    const mode = statSync(result.path).mode;
    expect(mode & 0o111).not.toBe(0); // some exec bit set
  });

  it("skips when hook content already matches", () => {
    mkdirSync(join(TMP, ".git/hooks"), { recursive: true });
    writeFileSync(join(TMP, ".git/hooks/pre-commit"), PRE_COMMIT_HOOK);
    const result = installPreCommitHook(TMP);
    expect(result.action).toBe("skipped");
    expect(result.backupPath).toBeUndefined();
  });

  it("backs up an existing differing hook before overwriting", () => {
    mkdirSync(join(TMP, ".git/hooks"), { recursive: true });
    const old = "#!/bin/bash\necho user-customized\n";
    writeFileSync(join(TMP, ".git/hooks/pre-commit"), old);
    const result = installPreCommitHook(TMP);
    expect(result.action).toBe("replaced-and-backed-up");
    expect(result.backupPath).toBeDefined();
    expect(readFileSync(result.backupPath!, "utf8")).toBe(old);
    expect(readFileSync(result.path, "utf8")).toBe(PRE_COMMIT_HOOK);
  });

  it("replaces a symlink without creating a backup", () => {
    mkdirSync(join(TMP, ".git/hooks"), { recursive: true });
    const target = join(TMP, "real-target");
    writeFileSync(target, "#!/bin/bash\necho old hook\n");
    symlinkSync(target, join(TMP, ".git/hooks/pre-commit"));
    const result = installPreCommitHook(TMP);
    expect(result.action).toBe("replaced-symlink");
    expect(result.backupPath).toBeUndefined();
    expect(readFileSync(result.path, "utf8")).toBe(PRE_COMMIT_HOOK);
  });
});
