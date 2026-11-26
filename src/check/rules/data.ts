import fs from "node:fs";
import path from "node:path";
import { isTodoOrEmpty } from "../../docs/adr.js";
import { definitionHash, expectedTarget, parseResults } from "../../rebuild/data.js";
import { isRecord, normalizeTable, text } from "../../rebuild/model.js";
import { validatePath } from "../../config.js";
import { sourceIds } from "../links.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, isRealDate } from "../text.js";
import type { Report, Severity } from "../types.js";

const NAME = /^[A-Za-z0-9_-]+$/;

/** The data plan: field mapping, cleaning rules, transformations and the verification by counts. */
export function checkDataPlan(project: Project, report: Report): void {
  const rebuild = project.rebuild;
  if (!rebuild?.paths.dataDir) return;
  const sources = sourceIds(project);
  const targets = new Map<string, string>();

  for (const doc of rebuild.data) {
    const add = (rule: string, severity: Severity, key: string, message: string, file = doc.file) =>
      report({ rule, severity, file, line: file === doc.file ? fieldLine(doc.text, key) : 1, message });
    const fail = (key: string, message: string) => add("data-plan", "error", key, message);
    if (!doc.fm) {
      report({ rule: "frontmatter", file: doc.file, line: 1, message: "Missing or invalid YAML frontmatter." });
      continue;
    }
    const data = doc.fm.data;
    for (const key of ["owner", "date"]) {
      if (isTodoOrEmpty(data[key])) add("todo-field", "error", key, `"${key}" is missing or TODO.`);
    }
    const date = str(data["date"]);
    if (date !== null && date.toUpperCase() !== "TODO" && !isRealDate(date)) add("status-date", "error", "date", `"date" must be a real date in YYYY-MM-DD format (found: ${date}).`);

    const target = text(data["target"]);
    if (target === null) fail("target", '"target" (the destination table) is missing.');
    else {
      const key = normalizeTable(target);
      const first = targets.get(key);
      if (first) fail("target", `the table ${target} already has a data plan in ${first}.`);
      else targets.set(key, doc.file);
    }
    const from = data["sources"];
    if (!Array.isArray(from) || from.length === 0 || !from.every((s) => text(s) !== null)) fail("sources", '"sources" must list the origin tables.');

    /** A list of `{ id, rule, source? }`; returns the declared IDs. */
    const rules = (key: "cleaning" | "transformations", prefix: "C" | "T"): Set<string> => {
      const ids = new Set<string>();
      const list = data[key] ?? [];
      if (!Array.isArray(list)) {
        fail(key, `"${key}" must be a list.`);
        return ids;
      }
      for (const entry of list) {
        const id = isRecord(entry) ? text(entry["id"]) : null;
        if (!isRecord(entry) || id === null || !new RegExp(`^${prefix}-\\d+$`).test(id) || text(entry["rule"]) === null) {
          fail(key, `every entry of "${key}" needs an id (${prefix}-1, ${prefix}-2, ...) and a "rule".`);
          continue;
        }
        if (ids.has(id)) fail(key, `${id} is declared twice.`);
        ids.add(id);
        const source = text(entry["source"]);
        if (source !== null && !sources?.has(source)) add("broken-ref", "error", key, `${id}: source ${source} does not exist.`);
      }
      return ids;
    };
    const cleaning = rules("cleaning", "C");
    const transformations = rules("transformations", "T");
    const declared = new Set([...cleaning, ...transformations]);

    const fields = data["fields"];
    if (!Array.isArray(fields) || fields.length === 0) fail("fields", '"fields" must list the field mapping.');
    else {
      fields.forEach((field, i) => {
        const f = isRecord(field) ? field : {};
        const name = text(f["from"]) ?? text(f["to"]) ?? `entry ${i + 1}`;
        if (text(f["to"]) === null && text(f["dropped"]) === null) fail("fields", `field ${name}: give it a "to", or "dropped" with the reason.`);
        const source = text(f["source"]);
        if (source !== null && !sources?.has(source)) add("broken-ref", "error", "fields", `field ${name}: source ${source} does not exist.`);
      });
    }

    const totals = new Map<string, string | null>();
    const declaredTotals = data["totals"] ?? [];
    if (!Array.isArray(declaredTotals)) fail("totals", '"totals" must be a list.');
    else {
      for (const total of declaredTotals) {
        const name = isRecord(total) ? text(total["name"]) : null;
        if (!isRecord(total) || name === null || !NAME.test(name)) {
          fail("totals", 'every total needs a "name" made of letters, numbers, "-" or "_".');
          continue;
        }
        if (totals.has(name)) fail("totals", `the total "${name}" is declared twice.`);
        const rule = text(total["difference"]);
        if (rule !== null && !declared.has(rule)) fail("totals", `total "${name}": "difference: ${rule}" is not a declared C- or T- rule.`);
        totals.set(name, rule !== null && declared.has(rule) ? rule : null);
      }
    }

    const counts = data["counts"];
    const command = isRecord(counts) ? text(counts["command"]) : null;
    const resultsPath = isRecord(counts) ? text(counts["results"]) : null;
    if (command === null || resultsPath === null) {
      add("data-counts", "warning", "counts", 'No verification: add "counts" with the "command" that takes them and the "results" file it writes.');
      continue;
    }
    let file: string;
    try {
      file = validatePath("results", resultsPath, "counts.");
    } catch {
      fail("counts", '"counts.results" must be a relative path inside the project.');
      continue;
    }
    const abs = path.join(project.cwd, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      add("data-counts", "warning", "counts", `The counts were not taken: ${file} does not exist. Run ${command}.`);
      continue;
    }
    const parsed = parseResults(fs.readFileSync(abs, "utf-8"));
    if ("errors" in parsed) {
      for (const message of parsed.errors) add("data-results", "error", "counts", `Results file: ${message}`, file);
      continue;
    }
    const r = parsed.results;
    const bad = (message: string) => add("data-results", "error", "counts", message, file);

    const current = definitionHash(doc.fm);
    if (r.definition !== current) {
      add("data-stale", "warning", "counts", `The results are for another version of ${doc.file} (now ${current}). Run ${command} again.`, file);
    }
    let known = true;
    for (const id of Object.keys(r.excluded)) {
      if (!cleaning.has(id)) {
        known = false;
        bad(`"excluded" cites ${NAME.test(id) ? id : "a rule"} that is not a cleaning rule (C-x) of ${doc.file}.`);
      }
    }
    for (const id of Object.keys(r.adjustments)) {
      if (!declared.has(id)) {
        known = false;
        bad(`"adjustments" cites ${NAME.test(id) ? id : "a rule"} that is not a C- or T- rule of ${doc.file}.`);
      }
    }
    const expected = expectedTarget(r);
    if (known && expected !== BigInt(r.target)) {
      bad(`The counts do not add up: source + adjustments - excluded = ${expected}, but target is ${r.target}.`);
    }
    for (const [name, rule] of totals) {
      const total = r.totals[name];
      if (!total) bad(`The declared total "${name}" is not in the results.`);
      else if (total.source !== total.target && rule === null) {
        bad(`The total "${name}" differs between source and target and no rule explains it ("difference: C-x" or "T-x").`);
      }
    }
    if (Object.keys(r.totals).some((name) => !totals.has(name))) bad(`The results have a total that ${doc.file} does not declare.`);
  }
}
