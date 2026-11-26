import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBranch, type BranchOptions } from "../../src/commands/branch.js";
import { loadConfig } from "../../src/config.js";
import { matchesBranch } from "../../src/git/branches.js";
import { bash, repoOn } from "../agent/helpers.js";
import { emptyCommit, git, newRepo } from "../git-helpers.js";
import { tmpDir } from "../helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function repo(config?: object): string {
  const dir = newRepo();
  dirs.push(dir);
  emptyCommit(dir, "init");
  if (config) fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify(config));
  return dir;
}

function run(cwd: string, words: string[], options: BranchOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runBranch(words, { cwd, out: (l) => out.push(l), err: (l) => err.push(l), ...options });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const current = (dir: string) => git(dir, ["symbolic-ref", "--short", "HEAD"]).trim();

describe("engkit branch", () => {
  it("creates and switches to <type>/<TICKET>-<slug>", () => {
    const dir = repo();
    const r = run(dir, ["ABC-123", "Agregar paginación"], { type: "fix" });
    expect(r).toMatchObject({ code: 0, out: "fix/ABC-123-agregar-paginacion" });
    expect(current(dir)).toBe("fix/ABC-123-agregar-paginacion");
  });

  it("does not require a ticket by default: <type>/<slug>", () => {
    const dir = repo();
    expect(run(dir, ["Add", "login page"]).out).toBe("feature/add-login-page");
  });

  it('requires a ticket with "requireTicket": true', () => {
    const dir = repo({ branch: { requireTicket: true } });
    const r = run(dir, ["Add login page"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("requireTicket");
    expect(current(dir)).toBe("main");
    expect(run(dir, ["Add login page"], { ticket: "AB-1" }).out).toBe("feature/AB-1-add-login-page");
  });

  it("uses the configured types, default type and ticket pattern", () => {
    const dir = repo({ branch: { types: ["feat", "hotfix"], ticketPattern: "#?\\d+" } });
    expect(run(dir, ["42", "x y"], { dryRun: true }).out).toBe("feat/42-x-y");
    expect(run(dir, ["x"], { type: "fix" })).toMatchObject({ code: 2 });
    expect(run(dir, ["x"], { type: "hotfix", dryRun: true }).out).toBe("hotfix/x");
  });

  it.each([
    ["an explicit ticket that does not match", ["x"], { ticket: "abc" }],
    ["a ticket without a description", ["ABC-1"], {}],
    ["a description without letters or numbers", ["¡!"], {}],
    ["a ticket that makes an invalid ref name", ["x"], { ticket: "A..1" }],
  ])("rejects %s", (name, words, options) => {
    const dir = repo(name.includes("invalid ref") ? { branch: { ticketPattern: "A..1" } } : undefined);
    expect(run(dir, words, options).code).toBe(2);
    expect(current(dir)).toBe("main");
  });

  it.each([
    [["release/*"], "release"],
    [["main", "feature/*"], "feature"],
    [["Release/next-version"], "release"],
  ])("refuses a name that matches protectedBranches %j, also with --dry-run", (protectedBranches, type) => {
    const dir = repo({ protectedBranches, branch: { types: ["feature", "release"] } });
    for (const dryRun of [false, true]) {
      const r = run(dir, ["next version"], { type, dryRun });
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toContain("protected branch");
    }
    expect(git(dir, ["branch", "--format=%(refname:short)"]).trim()).toBe("main");
  });

  it("refuses an existing branch, ignoring case", () => {
    const dir = repo();
    git(dir, ["branch", "feature/Login"]);
    const r = run(dir, ["login"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("already exists");
  });

  it("--dry-run prints the name and creates nothing, even outside a repository", () => {
    const dir = tmpDir();
    dirs.push(dir);
    expect(run(dir, ["x"], { dryRun: true })).toMatchObject({ code: 0, out: "feature/x" });
    expect(run(dir, ["x"])).toMatchObject({ code: 2 });
  });

  it("--from picks the base without setting an upstream, and rejects options or unknown refs", () => {
    const dir = repo();
    const first = git(dir, ["rev-parse", "HEAD"]).trim();
    emptyCommit(dir, "second");
    git(dir, ["update-ref", "refs/remotes/origin/main", first]);
    git(dir, ["config", "remote.origin.url", "."]);
    git(dir, ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
    expect(run(dir, ["x"], { from: "--orphan" }).code).toBe(2);
    expect(run(dir, ["x"], { from: "nope" }).code).toBe(2);
    expect(run(dir, ["x"], { from: "origin/main" }).code).toBe(0);
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(first);
    expect(() => git(dir, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toThrow();
  });
});

describe("branch config", () => {
  it.each([
    [{ branch: [] }, /"branch" must be an object/],
    [{ branch: { types: [] } }, /branch.types/],
    [{ branch: { types: ["a/b"] } }, /branch.types/],
    [{ branch: { defaultType: "nope" } }, /branch.defaultType/],
    [{ branch: { ticketPattern: "(" } }, /not a valid regular expression/],
    [{ branch: { requireTicket: "yes" } }, /requireTicket/],
    [{ branch: { requiresTicket: true } }, /unknown key/],
  ])("rejects %j", (config, message) => {
    const dir = tmpDir();
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify(config));
    expect(() => loadConfig(dir)).toThrow(message);
  });
});

describe("branch matching", () => {
  it.each([
    ["release/1.0", "release/*", true],
    ["release", "release/*", false],
    ["main", "main", true],
    ["maintenance", "main", false],
    ["v1.0", "v1.0", true],
    ["v1x0", "v1.0", false],
  ])("%s against %s agrees with the guard script", (branch, pattern, expected) => {
    expect(matchesBranch(branch, [pattern])).toBe(expected);
    const dir = repoOn(branch, [pattern]);
    dirs.push(dir);
    expect(bash("git commit -m x", dir).status).toBe(expected ? 2 : 0);
  });
});
