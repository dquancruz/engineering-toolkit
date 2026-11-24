import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/commands/check.js";
import { fixtures, tmpDir } from "../helpers.js";

// Every directory under fixtures/check/cases/<rule>/<case> holds only the files that differ from
// fixtures/check/base (a project created with `engkit init` + two ADRs + one pending item).
// expect.json lists the exact errors (rule, file, line); "valid/*" cases expect none.
const root = path.join(fixtures, "check");

function copyDir(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true });
}

function cases(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  const base = path.join(root, "cases");
  for (const group of fs.readdirSync(base).sort()) {
    for (const name of fs.readdirSync(path.join(base, group)).sort()) {
      out.push({ name: `${group}/${name}`, dir: path.join(base, group, name) });
    }
  }
  return out;
}

const key = (f: { rule: string; file: string; line: number | null }) => `${f.file}:${f.line ?? "-"} [${f.rule}]`;

describe("check fixtures", () => {
  it("the base project has no errors", () => {
    const dir = tmpDir();
    copyDir(path.join(root, "base"), dir);
    const result = runCheck("es", { cwd: dir });
    expect(result.errors).toEqual([]);
    // not a git repo: the only warning is the git one
    expect(result.warnings.map((w) => w.rule)).toEqual(["git-history"]);
  });

  for (const { name, dir: caseDir } of cases()) {
    it(name, () => {
      const dir = tmpDir();
      copyDir(path.join(root, "base"), dir);
      copyDir(caseDir, dir);
      fs.rmSync(path.join(dir, "expect.json"));
      const expected = (JSON.parse(fs.readFileSync(path.join(caseDir, "expect.json"), "utf-8")) as {
        errors: { rule: string; file: string; line: number | null }[];
      }).errors;

      const result = runCheck("es", { cwd: dir });
      expect(result.errors.map(key).sort()).toEqual(expected.map(key).sort());
      expect(result.ok).toBe(expected.length === 0);
    });
  }
});
