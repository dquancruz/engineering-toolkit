import { isTodoOrEmpty } from "../../docs/adr.js";
import { parseRegister } from "../../docs/register.js";
import {
  CATEGORIES,
  CONSTRAINT_KINDS,
  NUMERIC_CATEGORIES,
  REQUIREMENT_STATUSES,
  VERIFIED_CATEGORIES,
  isCommand,
  splitIds,
} from "../../requirements/model.js";
import { adrStatuses, sourceIds } from "../links.js";
import type { Project } from "../project.js";
import { isRealDate } from "../text.js";
import type { Report, Severity } from "../types.js";

/** Non-functional requirements (RNF) and fixed constraints (RES). */
export function checkRequirements(project: Project, report: Report): void {
  const doc = project.docs.find((d) => d.key === "requirements");
  if (!doc) return;
  const sources = sourceIds(project);
  const adrs = adrStatuses(project);
  const tests = new Set(project.legacy?.items.test.map((t) => t.id));
  const requirements = parseRegister(doc.text, "RNF");
  const constraints = parseRegister(doc.text, "RES");

  const seen = new Map<string, number>();
  for (const entry of [...requirements, ...constraints]) {
    const first = seen.get(entry.id);
    if (first !== undefined) report({ rule: "unique-id", file: doc.file, line: entry.line, message: `Duplicate ${entry.id} (first defined on line ${first}).` });
    else seen.set(entry.id, entry.line);
  }

  const reader = (entry: (typeof requirements)[number]) => {
    const value = (key: string) => {
      const v = entry.fields[key]?.value;
      return isTodoOrEmpty(v) ? undefined : v;
    };
    const add = (rule: string, severity: Severity, key: string, message: string) =>
      report({ rule, severity, file: doc.file, line: entry.fields[key]?.line ?? entry.line, message: `${entry.id}: ${message}` });
    const date = value("date");
    if (date === undefined) add("todo-field", "error", "date", '"date" is missing or TODO.');
    else if (!isRealDate(date)) add("status-date", "error", "date", `"date" must be a real date in YYYY-MM-DD format (found: ${date}).`);
    return { value, add };
  };

  /**
   * Every ID of `origin` / `source` is an F-xx or an ADR. That they exist is `broken-ref` on the whole document;
   * only F- IDs in a project without a sources register need their own finding.
   */
  const checkOrigins = (key: string, ids: string[], add: ReturnType<typeof reader>["add"]) => {
    for (const id of ids) {
      if (/^ADR-\d{4}$/.test(id)) {
        if (adrs.has(id) && adrs.get(id) !== "accepted") add("origin-adr", "warning", key, `${key}: ${id} is "${adrs.get(id) ?? "?"}", not accepted.`);
      } else if (/^F-\d{2,}$/.test(id)) {
        if (!sources) add("broken-ref", "error", key, `${key}: ${id} cannot be resolved: the project has no sources register. Run "engkit init --profile requirements".`);
      } else {
        add("broken-ref", "error", key, `${key}: "${id}" is not an F-xx or ADR-xxxx ID.`);
      }
    }
  };

  const covered = new Set<string>();
  for (const entry of requirements) {
    const { value, add } = reader(entry);
    const category = value("category");
    const status = value("status");
    if (entry.title === "") add("requirement-field", "error", "category", "it has no title.");
    if (category === undefined || !(CATEGORIES as readonly string[]).includes(category)) {
      add("requirement-field", "error", "category", `"category" must be one of ${CATEGORIES.join(" | ")} (found: ${category ?? "nothing"}).`);
    }
    if (status === undefined || !(REQUIREMENT_STATUSES as readonly string[]).includes(status)) {
      add("requirement-field", "error", "status", `"status" must be one of ${REQUIREMENT_STATUSES.join(" | ")} (found: ${status ?? "nothing"}).`);
    }
    if (value("owner") === undefined) {
      const why = category === "maintenance" ? " Say who will maintain the system." : "";
      add("requirement-field", "error", "owner", `"owner" is missing or TODO.${why}`);
    }
    if (status === "not-applicable") {
      if (value("reason") === undefined) add("requirement-field", "error", "status", 'a "not-applicable" requirement needs a "reason".');
      else if (category) covered.add(category);
      continue;
    }
    if (category) covered.add(category);
    if (status === "confirmed") {
      for (const key of ["measure", "target"]) {
        if (value(key) === undefined) add("requirement-field", "error", key, `a confirmed requirement needs "${key}".`);
      }
      if (splitIds(value("source")).length === 0) add("requirement-source", "warning", "status", 'it is confirmed and has no "source".');
      if (category && VERIFIED_CATEGORIES.includes(category) && value("verify") === undefined) {
        add("requirement-unverified", "warning", "status", `confirmed ${category} requirement without "verify" (a PA or a \`command\`).`);
      }
    }
    if (category && NUMERIC_CATEGORIES.includes(category) && !/\d/.test(value("target") ?? "")) {
      add("requirement-measurable", "warning", "target", `the target of a ${category} requirement has no number.`);
    }
    checkOrigins("source", splitIds(value("source")), add);
    const verify = value("verify");
    if (verify !== undefined && !isCommand(verify)) {
      if (!/^PA-\d{4}$/.test(verify)) add("requirement-field", "error", "verify", '"verify" must be a PA-xxxx or a command in `backticks`.');
      // with the legacy profile a missing PA is already `broken-ref`
      else if (!project.legacy && !tests.has(verify)) add("broken-ref", "error", "verify", `verify: ${verify} does not exist.`);
    }
  }

  for (const category of CATEGORIES) {
    if (!covered.has(category)) {
      report({
        rule: "requirement-coverage",
        severity: "warning",
        file: doc.file,
        line: 1,
        message: `No requirement for "${category}". Add one, or one with "status: not-applicable" and its reason.`,
      });
    }
  }

  for (const entry of constraints) {
    const { value, add } = reader(entry);
    const kind = value("kind");
    if (entry.title === "") add("requirement-field", "error", "kind", "it has no title.");
    if (kind === undefined || !(CONSTRAINT_KINDS as readonly string[]).includes(kind)) {
      add("requirement-field", "error", "kind", `"kind" must be one of ${CONSTRAINT_KINDS.join(" | ")} (found: ${kind ?? "nothing"}).`);
    }
    if (value("value") === undefined) add("requirement-field", "error", "value", '"value" is missing or TODO.');
    if (value("decided_by") === undefined) add("constraint-origin", "error", "decided_by", 'it has no "decided_by": say who decided it.');
    const origin = splitIds(value("origin"));
    if (origin.length === 0) add("constraint-origin", "error", "origin", 'it has no "origin": cite an F-xx source or an ADR.');
    checkOrigins("origin", origin, add);
  }
}
