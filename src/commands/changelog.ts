import fs from "node:fs";
import path from "node:path";
import { parseCommit, type Commit } from "../changelog/commits.js";
import { SectionExists, insertSection } from "../changelog/file.js";
import { renderSection } from "../changelog/render.js";
import { isCommit, isRepository, runGit } from "../git/exec.js";
import type { Lang } from "../i18n/index.js";

export const CHANGELOG_FILE = "CHANGELOG.md";

export interface ChangelogOptions {
  /** Name of the release in the heading (default: `to` when it is a tag, else "Unreleased"). */
  release?: string;
  /** Include the whole history up to `to` (for the first release); `from` must be omitted. */
  fromStart?: boolean;
  /** Print the section instead of writing the file. */
  stdout?: boolean;
  /** Rewrite the section when the release is already in the file. */
  force?: boolean;
  all?: boolean;
  cwd?: string;
  out?: (text: string) => void;
  err?: (line: string) => void;
}

/** Non-merge commits of `range`, oldest first. */
function readCommits(cwd: string, range: string): Commit[] | null {
  const r = runGit(cwd, ["log", "--no-merges", "--reverse", "-z", "--format=%H%n%B", "--end-of-options", range, "--"]);
  if (!r.ok) return null;
  return r.stdout
    .split("\0")
    .filter((chunk) => chunk !== "")
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      return { sha: chunk.slice(0, nl), message: chunk.slice(nl + 1) };
    });
}

/** `engkit changelog`. Returns the exit code: 0 ok, 1 the release is already in the file, 2 bad input. */
export function runChangelog(lang: Lang, refs: string[], options: ChangelogOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((t: string) => void process.stdout.write(t));
  const err = options.err ?? ((l: string) => console.error(l));
  const fail = (message: string): 2 => {
    err(`error: ${message}`);
    return 2;
  };

  const expected = options.fromStart ? 1 : 2;
  if (refs.length !== expected) {
    return fail(options.fromStart ? "--from-start takes one ref: engkit changelog <to> --from-start" : "two refs are needed: engkit changelog <from> <to>");
  }
  const to = refs[refs.length - 1]!;
  const from = options.fromStart ? null : refs[0]!;

  if (!isRepository(cwd)) return fail("not a git repository.");
  if (runGit(cwd, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") {
    return fail("this is a shallow clone, so commits would be missing. Fetch the full history (fetch-depth: 0 in CI).");
  }
  for (const ref of refs) if (!isCommit(cwd, ref)) return fail(`"${ref}" is not a commit, tag or branch.`);

  const commits = readCommits(cwd, from === null ? to : `${from}..${to}`);
  // the date of the newest commit, not of today: the same history always gives the same text
  const date = runGit(cwd, ["log", "-1", "--format=%cd", "--date=short", "--end-of-options", to, "--"]).stdout.trim();
  if (commits === null || date === "") return fail("git log failed.");

  const isTag = runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/tags/${to}`]).ok;
  const release = options.release?.trim() || (isTag ? to : "Unreleased");
  if (/[\[\]\r\n]/.test(release)) return fail("--release cannot contain brackets or line breaks.");

  const section = renderSection(commits.map(parseCommit), { lang, release, date, all: options.all === true });
  if (section.omitted > 0) err(`note: ${section.omitted} commit(s) of other types were left out (use --all to include them).`);

  if (options.stdout) {
    out(section.text);
    return 0;
  }

  const file = path.join(cwd, CHANGELOG_FILE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
  let next: string;
  try {
    next = insertSection(existing, section.text, options.force === true);
  } catch (e) {
    if (!(e instanceof SectionExists)) throw e;
    err(`error: ${CHANGELOG_FILE} already has "${e.message}". Use --force to rewrite that section.`);
    return 1;
  }
  fs.writeFileSync(file, next, "utf-8");
  err(`${existing === null ? "created" : "updated"}  ${CHANGELOG_FILE}  (${release}, ${commits.length} commit(s) read)`);
  return 0;
}
