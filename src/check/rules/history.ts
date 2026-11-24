import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../../docs/frontmatter.js";
import { deletedFiles, fileHistory, shortSha, showAt, type GitState } from "../git.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, frontmatterLines } from "../text.js";
import type { Report } from "../types.js";

interface Version {
  /** Short commit id, or "working tree". */
  label: string;
  text: string;
}

/** Committed versions of a file (oldest first) plus the working-tree version when it differs. */
function versionsOf(cwd: string, file: string): { versions: Version[]; committed: number } {
  const versions: Version[] = [];
  for (const v of fileHistory(cwd, file)) {
    const text = showAt(cwd, v.sha, v.path);
    if (text !== null) versions.push({ label: shortSha(v.sha), text });
  }
  const committed = versions.length;
  const abs = path.join(cwd, file);
  if (fs.existsSync(abs)) {
    const work = fs.readFileSync(abs, "utf-8");
    if (committed === 0 || versions[committed - 1]!.text !== work) versions.push({ label: "working tree", text: work });
  }
  return { versions, committed };
}

const norm = (v: unknown): string | null => {
  const s = str(v);
  return s === null ? null : JSON.stringify(v);
};

interface Violation {
  message: string;
  line: number;
}

/** Whether going from `prev` to `curr` is a change an accepted ADR allows. */
function adrStepViolation(prevText: string, currText: string): Violation | null {
  const prev = parseFrontmatter(prevText);
  const curr = parseFrontmatter(currText);
  if (!prev || !curr) return { message: "The frontmatter is missing or invalid.", line: 1 };

  const keys = new Set([...Object.keys(prev.data), ...Object.keys(curr.data)]);
  for (const key of keys) {
    const before = norm(prev.data[key]);
    const after = norm(curr.data[key]);
    if (before === after) continue;
    const line = fieldLine(currText, key);
    const show = (v: unknown) => (str(v) === null ? "empty" : String(v));

    if (key === "status") {
      if (str(prev.data[key]) === "accepted" && str(curr.data[key]) === "superseded") continue;
      return {
        message: `"status" changed from ${show(prev.data[key])} to ${show(curr.data[key])}; an accepted ADR can only become superseded.`,
        line,
      };
    }
    if (key === "superseded_by") {
      if (str(prev.data[key]) === null && str(curr.data[key]) !== null) continue;
      return { message: `"superseded_by" changed from ${show(prev.data[key])} to ${show(curr.data[key])}.`, line };
    }
    return { message: `"${key}" changed from ${show(prev.data[key])} to ${show(curr.data[key])}.`, line };
  }

  const a = prev.body.replace(/\r\n/g, "\n").split("\n");
  const b = curr.body.replace(/\r\n/g, "\n").split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return { message: "The body changed; an accepted ADR is not edited, replace it with a new ADR.", line: frontmatterLines(currText) + i + 1 };
    }
  }
  return null;
}

/** `adr-immutable`: after acceptance, only status -> superseded and adding superseded_by are allowed. */
export function checkAdrImmutable(project: Project, report: Report): void {
  for (const adr of project.adrs) {
    const { versions, committed } = versionsOf(project.cwd, adr.file);
    const first = versions.findIndex((v) => parseFrontmatter(v.text)?.data["status"] === "accepted");
    if (first === -1) continue;

    if (first >= committed) {
      report({
        rule: "adr-immutable",
        severity: "warning",
        file: adr.file,
        line: fieldLine(adr.text, "status"),
        message: "Accepted but not committed yet: immutability cannot be verified until the acceptance is committed.",
      });
      continue;
    }

    for (let i = first + 1; i < versions.length; i++) {
      const violation = adrStepViolation(versions[i - 1]!.text, versions[i]!.text);
      if (violation) {
        report({
          rule: "adr-immutable",
          file: adr.file,
          line: violation.line,
          message: `${violation.message} (accepted in ${versions[first]!.label}, changed in ${versions[i]!.label})`,
        });
        break;
      }
    }
  }
}

/** `log-append-only`: every version of the log keeps all earlier lines unchanged. */
export function checkLogAppendOnly(project: Project, report: Report): void {
  const file = project.paths.log;
  const { versions } = versionsOf(project.cwd, file);
  const lines = (t: string) => {
    const l = t.replace(/\r\n/g, "\n").split("\n");
    if (l[l.length - 1] === "") l.pop();
    return l;
  };

  for (let i = 1; i < versions.length; i++) {
    const before = lines(versions[i - 1]!.text);
    const after = lines(versions[i]!.text);
    const at = `${versions[i - 1]!.label} -> ${versions[i]!.label}`;
    for (let n = 0; n < before.length; n++) {
      if (after[n] === undefined) {
        report({
          rule: "log-append-only",
          file,
          line: Math.max(1, after.length),
          message: `${before.length - after.length} line(s) removed from the end of the log; line ${n + 1} no longer exists (${at}).`,
        });
        return;
      }
      if (before[n] !== after[n]) {
        report({ rule: "log-append-only", file, line: n + 1, message: `Line ${n + 1} was edited; the log is append-only (${at}).` });
        return;
      }
    }
  }
}

/** `adr-deleted` (warning): ADR files that existed in the ADR folder and were deleted in history. */
export function checkAdrDeleted(project: Project, report: Report): void {
  const seen = new Set<string>();
  for (const del of deletedFiles(project.cwd, project.paths.adrDir)) {
    const name = path.posix.basename(del.path);
    const m = /^(\d{4})-.+\.md$/.exec(name);
    if (!m || Number(m[1]) === 0 || seen.has(del.path)) continue;
    seen.add(del.path);
    if (fs.existsSync(path.join(project.cwd, del.path))) continue;

    const old = showAt(project.cwd, `${del.sha}^`, del.path);
    const status = old ? str(parseFrontmatter(old)?.data["status"]) : null;
    report({
      rule: "adr-deleted",
      severity: "warning",
      file: del.path,
      line: null,
      message: `ADR file deleted in commit ${shortSha(del.sha)}${status ? ` (its status was ${status})` : ""}. Supersede an ADR instead of deleting it.`,
    });
  }
}

/** Why history-based rules cannot be trusted (or null when they can). */
export function gitLimitation(git: GitState): string | null {
  if (!git.available) {
    return "Not a git repository (or git is not installed): adr-immutable, log-append-only and adr-deleted were skipped.";
  }
  if (git.shallow) {
    return "Shallow clone: the history is incomplete, so adr-immutable, log-append-only and adr-deleted may miss violations. In CI use fetch-depth: 0.";
  }
  return null;
}
