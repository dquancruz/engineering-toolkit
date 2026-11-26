import fs from "node:fs";
import path from "node:path";
import { runCheck, type CheckOptions } from "../../src/commands/check.js";
import { runInitProfiles, type InitProfilesOptions, type Profile } from "../../src/commands/init.js";
import { runNewItem } from "../../src/commands/legacy.js";
import { runNewSlice, runTestPlan, type TestPlanOptions } from "../../src/commands/rebuild.js";
import { runIndex } from "../../src/commands/index-cmd.js";
import { runRulesIndex } from "../../src/commands/legacy.js";
import { captureConsole, tmpDir } from "../helpers.js";
import { edit, raw, read, source, write } from "../legacy/helpers.js";

export { edit, raw, read, write };
export const TODAY = "2026-03-09";

const dirs: string[] = [];
export const cleanup = () => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

export async function init(profiles: Profile[], options: InitProfilesOptions = {}, lang: "es" | "en" = "es"): Promise<string> {
  const dir = options.cwd ?? tmpDir();
  if (!options.cwd) dirs.push(dir);
  const log: string[] = [];
  const spy = console.log;
  console.log = (...a: unknown[]) => void log.push(a.join(" "));
  try {
    await runInitProfiles(lang, { cwd: dir, owner: "Jane Doe", today: TODAY, profiles, ...options });
  } finally {
    console.log = spy;
  }
  initLog = log.join("\n");
  return dir;
}
export let initLog = "";

/** Replaces a frontmatter field, including the indented lines of a list. */
export const field = (dir: string, file: string, key: string, value: string) =>
  edit(dir, file, new RegExp(`^${key}:.*(?:\n[ \t]+.*)*`, "m"), `${key}: ${value}`);

/** A rebuild project with a confirmed rule, a ready test and one complete slice: `check --strict` passes. */
export async function rebuildProject(extras: ("strangler" | "data")[] = []) {
  const dir = await init(["base", "rebuild"], extras.length ? { extras } : {});
  fs.appendFileSync(path.join(dir, "docs/fuentes.md"), source("F-01", "person"));
  const io = { cwd: dir, owner: "Jane Doe", today: TODAY, out: () => {} };
  const rule = runNewItem("rule", "Late fee", "es", io);
  edit(dir, rule, "status: draft", "status: confirmed");
  field(dir, rule, "evidence", "\n  - source: F-01");
  const test = runNewItem("test", "Day 31", "es", { ...io, rule: ["RN-0001"], source: ["F-01"] });
  edit(dir, test, "status: draft", "status: ready");
  const slice = runNewSlice("Charge the fee", "es", { ...io, rule: ["RN-0001"], test: ["PA-0001"] });
  field(dir, slice, "done", "\n  - text: The agreed cases pass\n    verify: PA-0001");
  requirements(dir, ALL_CATEGORIES);
  reindex(dir);
  return { dir, rule, test, slice };
}

export function reindex(dir: string): void {
  runRulesIndex("es", { cwd: dir, today: TODAY, out: () => {} });
  captureConsole(() => runIndex("es", { cwd: dir, today: TODAY }));
}

export const entry = (id: string, fields: Record<string, string | undefined>, title = `${id} title`) =>
  `\n### ${id}: ${title}\n\n${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;

export const requirement = (id: string, category: string, extra: Record<string, string | undefined> = {}) =>
  entry(id, { category, status: "confirmed", measure: "p95", target: "300", verify: "`npm run perf`", source: "F-01", owner: "Jane Doe", date: TODAY, ...extra });

export const ALL_CATEGORIES = ["users", "sensitive-data", "performance", "availability", "integrations", "maintenance"]
  .map((c, i) => requirement(`RNF-0${i + 1}`, c))
  .join("");

export function requirements(dir: string, text: string, file = "docs/requisitos.md"): void {
  fs.appendFileSync(path.join(dir, file), text);
}

export function check(dir: string, options: CheckOptions = {}) {
  const result = runCheck("es", { cwd: dir, today: TODAY, ...options });
  const short = (list: typeof result.errors) =>
    list.filter((f) => f.rule !== "git-history").map((f) => `${f.rule} ${path.posix.basename(f.file).replace(/^((RN|PA|D|SL)-\d+).*\.md$/, "$1")}`);
  return {
    result,
    errors: short(result.errors),
    warnings: short(result.warnings),
    messages: [...result.errors, ...result.warnings].map((f) => f.message).join("\n"),
  };
}

export function testplan(dir: string, options: TestPlanOptions = {}) {
  let out = "";
  const err: string[] = [];
  const code = runTestPlan("es", { cwd: dir, today: TODAY, out: (t) => void (out += t), err: (l) => err.push(l), ...options });
  return { code, out, err: err.join("\n") };
}
