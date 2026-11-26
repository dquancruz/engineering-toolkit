import fs from "node:fs";
import path from "node:path";
import { isTodoOrEmpty } from "../../docs/adr.js";
import type { Lang } from "../../i18n/index.js";
import { listField } from "../../legacy/load.js";
import { parseRegister } from "../../docs/register.js";
import { RISK_LEVELS, SLICE_STATUSES, isRecord, text } from "../../rebuild/model.js";
import { isCommand } from "../../requirements/model.js";
import { generateTestPlan } from "../../rebuild/testplan.js";
import { adrStatuses, allQuestions } from "../links.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, isRealDate } from "../text.js";
import type { Report, Severity } from "../types.js";

/** The rebuild plan, its risks and the vertical slices. */
export function checkRebuildPlan(project: Project, report: Report): void {
  const { rebuild, legacy } = project;
  if (!rebuild || !legacy) return;

  for (const file of rebuild.unexpected) {
    report({ rule: "legacy-file", severity: "warning", file, line: null, message: "Not checked: the name must be SL-01-description.md." });
  }

  const rules = new Map(legacy.items.rule.map((r) => [r.id, r]));
  const tests = new Map(legacy.items.test.map((t) => [t.id, t]));
  const requirementsDoc = project.docs.find((d) => d.key === "requirements");
  const known: Record<string, { has(id: string): boolean }> = {
    rules,
    tests,
    requirements: new Set(requirementsDoc ? parseRegister(requirementsDoc.text, "RNF").map((e) => e.id) : []),
    constraints: new Set(requirementsDoc ? parseRegister(requirementsDoc.text, "RES").map((e) => e.id) : []),
    decisions: adrStatuses(project),
    risks: new Set(rebuild.risks.map((r) => r.id)),
    questions: allQuestions(project),
  };

  /** Done criteria: each one says how it is verified, with a PA or a command. */
  const checkDone = (value: unknown, add: (rule: string, severity: Severity, key: string, message: string) => void) => {
    if (value === undefined || value === null) return 0;
    if (!Array.isArray(value)) {
      add("slice-done", "error", "done", '"done" must be a list of { text, verify }.');
      return 0;
    }
    value.forEach((criterion, i) => {
      const c = isRecord(criterion) ? criterion : {};
      const label = `done criterion ${i + 1}`;
      if (text(c["text"]) === null) add("slice-done", "error", "done", `${label} has no "text".`);
      const verify = text(c["verify"]);
      if (verify === null) add("slice-done", "error", "done", `${label} has no "verify" (a PA or a \`command\`).`);
      else if (!isCommand(verify)) {
        if (!/^PA-\d{4}$/.test(verify)) add("slice-done", "error", "done", `${label}: "verify" must be a PA-xxxx or a command in \`backticks\`.`);
        else if (!tests.has(verify)) add("broken-ref", "error", "done", `${label}: ${verify} does not exist.`);
      }
    });
    return value.length;
  };

  // plan: exclusions, global criteria and risks
  const excluded = new Set<string>();
  const plan = rebuild.plan;
  if (plan?.fm) {
    const add = (rule: string, severity: Severity, key: string, message: string) =>
      report({ rule, severity, file: plan.file, line: fieldLine(plan.text, key), message });
    const list = plan.fm.data["excluded"] ?? [];
    if (!Array.isArray(list)) add("plan-excluded", "error", "excluded", '"excluded" must be a list of { rule, reason }.');
    else {
      for (const entry of list) {
        const e = isRecord(entry) ? entry : {};
        const rule = text(e["rule"]);
        if (rule === null) add("plan-excluded", "error", "excluded", 'every exclusion needs a "rule".');
        else if (!rules.has(rule)) add("broken-ref", "error", "excluded", `excluded: ${rule} does not exist.`);
        else if (text(e["reason"]) === null) add("plan-excluded", "error", "excluded", `${rule} is excluded without a "reason".`);
        else excluded.add(rule);
        const decision = text(e["decision"]);
        if (decision !== null && !known["decisions"]!.has(decision)) add("broken-ref", "error", "excluded", `excluded: ${decision} does not exist.`);
      }
    }
    checkDone(plan.fm.data["done"], add);

    const seen = new Set<string>();
    for (const risk of rebuild.risks) {
      const at = (key: string) => risk.fields[key]?.line ?? risk.line;
      const fail = (key: string, message: string) => report({ rule: "risk-entry", file: plan.file, line: at(key), message: `${risk.id}: ${message}` });
      if (seen.has(risk.id)) report({ rule: "unique-id", file: plan.file, line: risk.line, message: `Duplicate ${risk.id}.` });
      seen.add(risk.id);
      for (const key of ["probability", "impact", "mitigation", "owner"]) {
        const value = risk.fields[key]?.value;
        if (isTodoOrEmpty(value)) fail(key, `"${key}" is missing or TODO.`);
        else if ((key === "probability" || key === "impact") && !(RISK_LEVELS as readonly string[]).includes(value!)) {
          fail(key, `"${key}" must be one of ${RISK_LEVELS.join(" | ")} (found: ${value}).`);
        }
      }
    }
  }

  // slices
  const ids = new Map<string, string>();
  const orders = new Map<number, string>();
  const planned = new Set<string>();
  for (const slice of rebuild.slices) {
    const add = (rule: string, severity: Severity, key: string, message: string) =>
      report({ rule, severity, file: slice.file, line: fieldLine(slice.text, key), message: `${slice.id}: ${message}` });
    const first = ids.get(slice.id);
    if (first) add("unique-id", "error", "id", `the ID is also used by ${first}.`);
    else ids.set(slice.id, slice.file);
    if (!slice.fm) {
      report({ rule: "frontmatter", file: slice.file, line: 1, message: "Missing or invalid YAML frontmatter." });
      continue;
    }
    const data = slice.fm.data;
    if (str(data["id"]) !== slice.id) add("unique-id", "error", "id", `the id (${str(data["id"]) ?? "nothing"}) does not match the file name.`);
    const status = str(data["status"]);
    if (status === null || !(SLICE_STATUSES as readonly string[]).includes(status)) {
      add("frontmatter", "error", "status", `"status" must be one of ${SLICE_STATUSES.join(" | ")} (found: ${status ?? "nothing"}).`);
    }
    for (const key of ["owner", "date"]) if (isTodoOrEmpty(data[key])) add("todo-field", "error", key, `"${key}" is missing or TODO.`);
    const date = str(data["date"]);
    if (date !== null && date.toUpperCase() !== "TODO" && !isRealDate(date)) add("status-date", "error", "date", `"date" must be a real date (found: ${date}).`);

    for (const [key, set] of Object.entries(known)) {
      const values = listField(slice, key);
      if (values === null) add("legacy-field", "error", key, `"${key}" must be a list of IDs.`);
      else for (const value of values) if (!set.has(value)) add("broken-ref", "error", key, `${key}: ${value} does not exist.`);
    }
    // a dropped slice keeps its links but plans nothing
    if (status === "dropped") continue;

    const order = data["order"];
    if (!Number.isInteger(order) || (order as number) < 1) add("slice-order", "error", "order", '"order" must be a whole number from 1.');
    else if (orders.has(order as number)) add("slice-order", "error", "order", `order ${order as number} is also used by ${orders.get(order as number)}.`);
    else orders.set(order as number, slice.id);

    const sliceRules = listField(slice, "rules") ?? [];
    const sliceTests = listField(slice, "tests") ?? [];
    for (const rule of sliceRules) planned.add(rule);
    if (sliceTests.length === 0) add("slice-untested", "warning", "tests", "it has no acceptance test (PA).");
    else {
      for (const rule of sliceRules) {
        if (rules.has(rule) && !sliceTests.some((t) => listField(tests.get(t) ?? { fm: null }, "rules")?.includes(rule))) {
          add("slice-rule-untested", "warning", "rules", `none of its tests covers ${rule}.`);
        }
      }
    }
    for (const rule of sliceRules) {
      if (str(rules.get(rule)?.fm?.data["status"]) === "discarded") add("slice-discarded-rule", "warning", "rules", `${rule} is discarded.`);
      if (excluded.has(rule)) add("plan-excluded", "warning", "rules", `${rule} is in this slice and also excluded in the plan.`);
    }
    if (checkDone(data["done"], add) === 0) add("slice-done", "error", "done", "it has no done criterion.");
    if (status === "done") {
      const drafts = sliceTests.filter((t) => tests.has(t) && str(tests.get(t)!.fm?.data["status"]) !== "ready");
      if (drafts.length > 0) add("slice-done", "error", "status", `it is done but these tests are not ready: ${drafts.join(", ")}.`);
    }
  }

  for (const rule of legacy.items.rule) {
    const status = str(rule.fm?.data["status"]);
    if ((status === "confirmed" || status === "modified") && !planned.has(rule.id) && !excluded.has(rule.id)) {
      report({
        rule: "rule-unplanned",
        severity: "warning",
        file: rule.file,
        line: fieldLine(rule.text, "status"),
        message: `${rule.id} is ${status} and is in no slice. Add it to one, or exclude it in ${rebuild.paths.plan} with its reason.`,
      });
    }
  }
}

/** `testplan-stale` (warning): the generated test plan no longer matches the documents. */
export function checkTestPlanStale(project: Project, lang: Lang, report: Report): void {
  const file = project.rebuild?.paths.testplan;
  if (!file) return;
  const abs = path.join(project.cwd, file);
  if (!fs.existsSync(abs)) return;
  const withoutDate = (t: string) => t.replace(/\r\n/g, "\n").replace(/^date:.*$/m, "date: -");
  if (withoutDate(generateTestPlan(project, lang, "-")) !== withoutDate(fs.readFileSync(abs, "utf-8"))) {
    report({ rule: "testplan-stale", severity: "warning", file, line: 1, message: 'The test plan is out of date. Run "engkit testplan" to regenerate it.' });
  }
}
