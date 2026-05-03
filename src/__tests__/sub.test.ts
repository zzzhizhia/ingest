import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cmdSubAdd, cmdSubList, cmdSubNew, cmdSubRemove } from "../sub.js";

const TMP = join(import.meta.dirname, "__tmp_sub__");

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initOrgRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(["init"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  // allow local file:// protocol for subwiki tests
  git(["config", "protocol.file.allow", "always"], dir);

  for (const f of ["entities.org", "concepts.org", "sources.org", "analyses.org"]) {
    writeFileSync(join(dir, f), "");
  }
  mkdirSync(join(dir, "raw"), { recursive: true });
  mkdirSync(join(dir, "subs"), { recursive: true });
  writeFileSync(join(dir, "ingest-lock.json"), JSON.stringify({ version: 1, files: {} }));
  writeFileSync(join(dir, ".gitignore"), "");
  git(["add", "."], dir);
  git(["commit", "-m", "init"], dir);
}

// Minimal subwiki scaffold that doesn't depend on __README__
function manualScaffoldSub(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(["init"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  for (const f of ["entities.org", "concepts.org", "sources.org", "analyses.org"]) {
    writeFileSync(join(dir, f), "");
  }
  mkdirSync(join(dir, "raw"), { recursive: true });
  writeFileSync(join(dir, "ingest-lock.json"), JSON.stringify({ version: 1, files: {} }));
  git(["add", "."], dir);
  git(["commit", "-m", "init sub"], dir);
}

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("cmdSubList", () => {
  it("reports no subwikis when subs/ is empty", () => {
    const orgRoot = join(TMP, "wiki");
    initOrgRepo(orgRoot);
    cmdSubList(orgRoot);
  });

  it("lists subwikis after one is added", () => {
    const orgRoot = join(TMP, "wiki");
    initOrgRepo(orgRoot);

    const remote = join(TMP, "remote");
    manualScaffoldSub(remote);

    cmdSubAdd(orgRoot, remote, "mysub");
    cmdSubList(orgRoot);
  });
});

describe("cmdSubAdd", () => {
  it("adds a remote repo as a subwiki", () => {
    const remote = join(TMP, "remote");
    manualScaffoldSub(remote);

    const orgRoot = join(TMP, "wiki");
    initOrgRepo(orgRoot);

    cmdSubAdd(orgRoot, remote, "imported");

    expect(existsSync(join(orgRoot, "subs", "imported"))).toBe(true);
    expect(existsSync(join(orgRoot, ".gitmodules"))).toBe(true);
  });

  it("derives name from URL when not specified", () => {
    const remote = join(TMP, "my-wiki.git");
    manualScaffoldSub(remote);

    const orgRoot = join(TMP, "wiki");
    initOrgRepo(orgRoot);

    cmdSubAdd(orgRoot, remote);

    expect(existsSync(join(orgRoot, "subs", "my-wiki"))).toBe(true);
  });
});

describe("cmdSubRemove", () => {
  it("removes an existing subwiki", () => {
    const remote = join(TMP, "remote");
    manualScaffoldSub(remote);

    const orgRoot = join(TMP, "wiki");
    initOrgRepo(orgRoot);

    cmdSubAdd(orgRoot, remote, "to-remove");
    git(["add", "."], orgRoot);
    git(["commit", "-m", "add sub"], orgRoot);

    cmdSubRemove(orgRoot, ["to-remove"]);
    expect(existsSync(join(orgRoot, "subs", "to-remove"))).toBe(false);
  });
});
