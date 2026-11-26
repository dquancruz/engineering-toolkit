import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCommit } from "../../src/changelog/commits.js";
import { insertSection } from "../../src/changelog/file.js";
import { escapeText } from "../../src/changelog/render.js";
import { runChangelog, type ChangelogOptions } from "../../src/commands/changelog.js";
import type { Lang } from "../../src/i18n/index.js";
import { emptyCommit, git, newRepo } from "../git-helpers.js";
import { tmpDir } from "../helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** v1.0.0, then a mix of commits (with a merge) tagged v1.1.0. */
function history(): string {
  const dir = newRepo();
  dirs.push(dir);
  emptyCommit(dir, "feat: first version", "2026-01-01T12:00:00Z");
  git(dir, ["tag", "v1.0.0"]);
  emptyCommit(dir, "feat(api): add pagination");
  emptyCommit(dir, "fix: handle empty lists (reported by @octocat)");
  emptyCommit(dir, "docs: update readme");
  emptyCommit(dir, "chore: bump deps");
  git(dir, ["switch", "-q", "-c", "side"]);
  emptyCommit(dir, "perf: cache <lookups>");
  git(dir, ["switch", "-q", "main"]);
  emptyCommit(dir, "refactor!: drop the old config format");
  git(dir, ["merge", "-q", "--no-ff", "side", "-m", "Merge pull request #9 from x/side"], {
    GIT_COMMITTER_DATE: "2026-03-10T12:00:00Z",
  });
  emptyCommit(dir, "Quick patch without convention", "2026-03-11T12:00:00Z");
  git(dir, ["tag", "v1.1.0"]);
  return dir;
}

function run(cwd: string, refs: string[], options: ChangelogOptions = {}, lang: Lang = "en") {
  let out = "";
  const err: string[] = [];
  const code = runChangelog(lang, refs, { cwd, out: (t) => void (out += t), err: (l) => err.push(l), ...options });
  return { code, out, err: err.join("\n") };
}

const file = (dir: string) => fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf-8");
const withoutShas = (text: string) => text.replace(/ \([0-9a-f]{7}\)/g, "");

describe("engkit changelog", () => {
  it("groups the commits, skips merges and hidden types, and dates the section by the last commit", () => {
    const dir = history();
    const r = run(dir, ["v1.0.0", "v1.1.0"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("2 commit(s)");
    expect(withoutShas(file(dir))).toBe(`# Changelog

## [v1.1.0] - 2026-03-11

### Breaking changes

- drop the old config format

### Features

- **api:** add pagination

### Fixes

- handle empty lists (reported by \`@octocat\`)

### Performance

- cache &lt;lookups>

### Other

- Quick patch without convention
`);
  });

  it("--all lists the other types, and --lang es translates the headings", () => {
    const r = run(history(), ["v1.0.0", "v1.1.0"], { all: true, stdout: true }, "es");
    expect(r.out).toContain("### Documentación");
    expect(r.out).toContain("### Tareas");
    expect(r.out).not.toContain("Merge pull request");
    expect(r.err).not.toContain("left out");
  });

  it("--stdout writes nothing", () => {
    const dir = history();
    const r = run(dir, ["v1.0.0", "v1.1.0"], { stdout: true });
    expect(r.out.startsWith("## [v1.1.0] - 2026-03-11\n")).toBe(true);
    expect(fs.existsSync(path.join(dir, "CHANGELOG.md"))).toBe(false);
  });

  it('names the release after --release, a tag, or "Unreleased"', () => {
    const dir = history();
    expect(run(dir, ["v1.0.0", "HEAD"], { stdout: true }).out).toContain("## [Unreleased]");
    expect(run(dir, ["v1.0.0", "HEAD"], { stdout: true, release: "v2.0.0" }).out).toContain("## [v2.0.0]");
    expect(run(dir, ["v1.1.0"], { stdout: true, fromStart: true }).out).toContain("first version");
  });

  it("adds new releases on top, refuses a repeated one and rewrites it with --force", () => {
    const dir = history();
    expect(run(dir, ["v1.0.0"], { fromStart: true }).code).toBe(0);
    expect(run(dir, ["v1.0.0", "v1.1.0"]).code).toBe(0);
    const before = file(dir);
    expect(before.indexOf("[v1.1.0]")).toBeLessThan(before.indexOf("[v1.0.0]"));

    const again = run(dir, ["v1.0.0", "v1.1.0"], { release: "1.1.0" });
    expect(again.code).toBe(1);
    expect(file(dir)).toBe(before);

    emptyCommit(dir, "fix: late fix", "2026-03-12T12:00:00Z");
    expect(run(dir, ["v1.0.0", "HEAD"], { release: "v1.1.0", force: true }).code).toBe(0);
    const after = file(dir);
    expect(after.match(/^## /gm)).toHaveLength(2);
    expect(after).toContain("late fix");
    expect(after.slice(after.indexOf("## [v1.0.0]"))).toBe(before.slice(before.indexOf("## [v1.0.0]")));
  });

  it.each([
    ["one ref without --from-start", ["v1.0.0"], {}],
    ["two refs with --from-start", ["v1.0.0", "v1.1.0"], { fromStart: true }],
    ["an unknown ref", ["v1.0.0", "nope"], {}],
    ["a ref that looks like an option", ["--output=x", "v1.1.0"], {}],
    ["brackets in the release name", ["v1.0.0", "v1.1.0"], { release: "a]b" }],
  ])("rejects %s", (_name, refs, options) => {
    const dir = history();
    expect(run(dir, refs, options).code).toBe(2);
    expect(fs.existsSync(path.join(dir, "CHANGELOG.md"))).toBe(false);
  });

  it("refuses a shallow clone", () => {
    const source = history();
    const dir = tmpDir();
    dirs.push(dir);
    git(source, ["clone", "-q", "--depth", "1", `file://${source}`, dir]);
    const r = run(dir, ["HEAD", "HEAD"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("shallow");
  });

  it("says so when there is nothing to list", () => {
    expect(run(history(), ["v1.1.0", "v1.1.0"], { stdout: true }).out).toContain("No changes to list.");
  });
});

describe("parseCommit", () => {
  const parse = (message: string) => parseCommit({ sha: "a".repeat(40), message });

  it("reads type, scope and the BREAKING CHANGE footer (which may span lines)", () => {
    const e = parse("feat(cli): new flag\n\nbody\n\nBREAKING CHANGE: the old flag\nis gone\nReviewed-by: x\n");
    expect(e).toMatchObject({ type: "feat", scope: "cli", description: "new flag", breaking: { note: "the old flag is gone" } });
  });
  it("accepts BREAKING-CHANGE and upper-case types", () => {
    expect(parse("FIX: x\r\n\r\nBREAKING-CHANGE: y")).toMatchObject({ type: "fix", breaking: { note: "y" } });
  });
  it("keeps a non-conventional subject", () => {
    expect(parse("update things: more")).toMatchObject({ type: null, description: "update things: more", breaking: null });
  });
});

describe("escapeText", () => {
  it.each([
    ["ping @team/core and @bob.", "ping `@team/core` and `@bob`."],
    ["keep `@types/node` as is", "keep `@types/node` as is"],
    ["mail a@b.com", "mail a@b.com"],
    ["(@x) <!-- hidden", "(`@x`) &lt;!-- hidden"],
  ])("%s", (input, output) => expect(escapeText(input)).toBe(output));
});

describe("insertSection", () => {
  const section = "## [v2] - 2026-01-02\n\n- b\n";
  it("keeps the introduction and CRLF line endings", () => {
    const next = insertSection("# Log\r\n\r\nIntro\r\n\r\n## [v1] - 2026-01-01\r\n\r\n- a\r\n", section);
    expect(next).toBe("# Log\r\n\r\nIntro\r\n\r\n## [v2] - 2026-01-02\r\n\r\n- b\r\n\r\n## [v1] - 2026-01-01\r\n\r\n- a\r\n");
  });
  it("appends after a file that has no releases", () => {
    expect(insertSection("# Changelog\n", section)).toBe("# Changelog\n\n## [v2] - 2026-01-02\n\n- b\n");
  });
});
