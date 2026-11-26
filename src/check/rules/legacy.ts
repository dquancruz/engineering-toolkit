import fs from "node:fs";
import path from "node:path";
import { isTodoOrEmpty } from "../../docs/adr.js";
import { parsePendingEntries } from "../../docs/pending.js";
import type { Lang } from "../../i18n/index.js";
import { evidenceOf, listField, type Legacy, type LegacyItem } from "../../legacy/load.js";
import {
  DEFECT_DECISIONS,
  DIR_KEY,
  ITEM_KINDS,
  PREFIX,
  SOURCE_FIELDS,
  SOURCE_TYPES,
  STATUSES,
  itemFilePattern,
} from "../../legacy/model.js";
import { generateRulesIndex } from "../../legacy/rules-index.js";
import { adrStatuses, allQuestions as questionIds, openQuestions } from "../links.js";
import { deletedFiles, shortSha } from "../git.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, isRealDate, visibleText } from "../text.js";
import type { Report, Severity } from "../types.js";

/** A reference to code (`erp:src/x.cbl:10`) written inside a source entry. */
function codeReference(value: string, roots: string[]): boolean {
  return roots.some((root) => new RegExp(`(^|[^\\w-])${root}:[^\\s:]+:\\d+`).test(value));
}

/**
 * `frontmatter`, `todo-field`, `status-date`, `unique-id`, `legacy-field`, `legacy-file`: each item and
 * source entry is well formed.
 */
export function checkLegacyDocuments(legacy: Legacy, report: Report): void {
  for (const file of legacy.unexpected) {
    report({ rule: "legacy-file", severity: "warning", file, line: null, message: "Not checked: the name must be <ID>-description.md, e.g. RN-0001-late-fee.md." });
  }

  for (const kind of ITEM_KINDS) {
    const seen = new Map<string, string>();
    for (const item of legacy.items[kind]) {
      const at = (key: string) => fieldLine(item.text, key);
      const fail = (rule: string, key: string, message: string) => report({ rule, file: item.file, line: at(key), message });

      const first = seen.get(item.id);
      if (first) fail("unique-id", "id", `${item.id} is also used by ${first}.`);
      else seen.set(item.id, item.file);

      if (!item.fm) {
        report({ rule: "frontmatter", file: item.file, line: 1, message: "Missing or invalid YAML frontmatter." });
        continue;
      }
      const data = item.fm.data;
      const id = str(data["id"]);
      if (id === null) fail("frontmatter", "id", 'Missing "id" in the frontmatter.');
      else if (id !== item.id) fail("unique-id", "id", `The id (${id}) does not match the file name (${item.id}).`);

      const status = str(data["status"]);
      if (status === null || !STATUSES[kind].includes(status)) {
        fail("frontmatter", "status", `"status" must be one of ${STATUSES[kind].join(" | ")} (found: ${status ?? "nothing"}).`);
      }
      if (kind === "defect") {
        const decision = str(data["decision"]);
        if (decision === null || !(DEFECT_DECISIONS as readonly string[]).includes(decision)) {
          fail("frontmatter", "decision", `"decision" must be one of ${DEFECT_DECISIONS.join(" | ")} (found: ${decision ?? "nothing"}).`);
        }
      }

      for (const key of ["owner", "date"]) {
        if (isTodoOrEmpty(data[key])) fail("todo-field", key, str(data[key]) === null ? `"${key}" is missing or empty.` : `"${key}" is still TODO.`);
      }
      const date = str(data["date"]);
      if (date !== null && date.toUpperCase() !== "TODO" && !isRealDate(date)) {
        fail("status-date", "date", `"date" must be a real date in YYYY-MM-DD format (found: ${date}).`);
      }

      for (const key of ["rules", "defects", "questions", "expected_source"]) {
        if (listField(item, key) === null) fail("legacy-field", key, `"${key}" must be a list of IDs.`);
      }
      if (kind !== "test" && evidenceOf(item) === null) {
        fail("legacy-field", "evidence", '"evidence" must be a list where each entry has either "ref" (code) or "source" (F-xx).');
      }
    }
  }

  const sources = legacy.sources;
  if (!sources) return;
  const seen = new Map<string, number>();
  for (const entry of sources.entries) {
    const first = seen.get(entry.id);
    if (first !== undefined) report({ rule: "unique-id", file: sources.file, line: entry.line, message: `Duplicate ${entry.id} (first defined on line ${first}).` });
    else seen.set(entry.id, entry.line);

    for (const key of SOURCE_FIELDS) {
      const field = entry.fields[key];
      const line = field?.line ?? entry.line;
      const fail = (message: string) => report({ rule: "source-entry", file: sources.file, line, message: `${entry.id}: ${message}` });
      if (!field || isTodoOrEmpty(field.value)) fail(`"${key}" is missing or TODO.`);
      else if (key === "type" && !(SOURCE_TYPES as readonly string[]).includes(field.value)) fail(`"type" must be one of ${SOURCE_TYPES.join(" | ")} (found: ${field.value}).`);
      else if (key === "obtained_on" && !isRealDate(field.value)) fail(`"obtained_on" must be a real date in YYYY-MM-DD format (found: ${field.value}).`);
    }
  }
}

/** The relations between rules, tests, defects, sources, questions and ADRs. */
export function checkLegacyLinks(project: Project, legacy: Legacy, roots: string[], report: Report): void {
  const ids = {
    rule: new Map(legacy.items.rule.map((i) => [i.id, i])),
    test: new Map(legacy.items.test.map((i) => [i.id, i])),
    defect: new Map(legacy.items.defect.map((i) => [i.id, i])),
  };
  const sources = new Map((legacy.sources?.entries ?? []).map((e) => [e.id, e]));
  const questions = openQuestions(project);
  const allQuestions = questionIds(project);
  const adrs = adrStatuses(project);

  const tested = (key: "rules" | "defects", id: string) => legacy.items.test.some((t) => listField(t, key)?.includes(id));
  const finding = (rule: string, severity: Severity, item: LegacyItem, key: string, message: string) =>
    report({ rule, severity, file: item.file, line: fieldLine(item.text, key), message });

  /** `broken-ref` for the IDs of a frontmatter field. */
  const exists = (item: LegacyItem, key: string, values: string[], known: { has(id: string): boolean }, prefix: string) => {
    for (const value of values) {
      if (!new RegExp(`^${prefix}-\\d+$`).test(value)) finding("broken-ref", "error", item, key, `${key}: "${value}" is not an ID that starts with "${prefix}-".`);
      else if (!known.has(value)) finding("broken-ref", "error", item, key, `${key}: ${value} does not exist.`);
    }
  };

  for (const item of [...legacy.items.rule, ...legacy.items.defect]) {
    exists(item, "questions", listField(item, "questions") ?? [], allQuestions, "P");
    exists(item, "evidence", (evidenceOf(item) ?? []).flatMap((e) => (e.source !== undefined ? [e.source] : [])), sources, "F");
  }

  for (const rule of legacy.items.rule) {
    if (!rule.fm) continue;
    const status = str(rule.fm.data["status"]);
    const evidence = evidenceOf(rule);
    const open = (listField(rule, "questions") ?? []).filter((q) => questions.has(q));
    const decision = str(rule.fm.data["decision"]);
    const inForce = status === "confirmed" || status === "modified";

    if (inForce && evidence?.length === 0) {
      const why = status === "modified" ? " of the old behaviour" : "";
      finding("rule-evidence", "error", rule, "status", `${rule.id} is ${status} and has no evidence${why}.`);
    }
    if (status === "modified") {
      if (decision === null) finding("rule-decision", "error", rule, "status", `${rule.id} is modified and has no "decision: ADR-xxxx" that explains the change.`);
      else if (adrs.has(decision) && adrs.get(decision) !== "accepted") {
        finding("rule-decision", "warning", rule, "decision", `${rule.id}: ${decision} is "${adrs.get(decision) ?? "?"}", not accepted.`);
      }
    }
    if (decision !== null) exists(rule, "decision", [decision], adrs, "ADR");
    if (status === "disputed" && open.length === 0) {
      finding("rule-question", "error", rule, "status", `${rule.id} is disputed and has no open P-xx question.`);
    }
    if (inForce && open.length > 0) {
      finding("rule-question", "warning", rule, "questions", `${rule.id} is ${status} but still has open questions: ${open.join(", ")}.`);
    }
    if (inForce && !tested("rules", rule.id)) {
      finding("rule-untested", "warning", rule, "status", `${rule.id} is ${status} and no acceptance test (PA) covers it.`);
    }
  }

  for (const test of legacy.items.test) {
    if (!test.fm) continue;
    const rules = listField(test, "rules");
    exists(test, "rules", rules ?? [], ids.rule, "RN");
    exists(test, "defects", listField(test, "defects") ?? [], ids.defect, "D");
    if (rules?.length === 0) finding("test-rule", "error", test, "rules", `${test.id} does not point to any business rule.`);

    const discarded = (rules ?? []).filter((r) => str(ids.rule.get(r)?.fm?.data["status"]) === "discarded");
    if (discarded.length > 0) {
      const all = discarded.length === rules!.length;
      finding(
        "test-discarded-rule",
        "warning",
        test,
        "rules",
        all
          ? `${test.id} only covers discarded rules (${discarded.join(", ")}): remove the test or point it to a rule that applies.`
          : `${test.id} points to discarded rules (${discarded.join(", ")}): remove those links.`
      );
    }

    // The expected result must come from outside the code under test.
    const expected = listField(test, "expected_source");
    if (expected === null) continue;
    if (expected.length === 0) {
      finding("expected-source", "error", test, "expected_source", `${test.id} has no "expected_source": name the F-xx the expected result comes from.`);
    }
    for (const value of expected) {
      if (codeReference(value, roots)) {
        finding("expected-source", "error", test, "expected_source", `${test.id}: "${value}" is a code reference; the expected result cannot come from code.`);
      } else if (!/^F-\d+$/.test(value)) {
        finding("expected-source", "error", test, "expected_source", `${test.id}: "${value}" is not an F- ID.`);
      } else {
        const entry = sources.get(value);
        if (!entry) finding("broken-ref", "error", test, "expected_source", `expected_source: ${value} does not exist.`);
        else if (entry.fields["type"]?.value === "code") {
          finding("expected-source", "error", test, "expected_source", `${test.id}: ${value} is of type "code"; the expected result cannot come from code.`);
        } else if (Object.values(entry.fields).some((f) => codeReference(f.value, roots)) || codeReference(entry.title, roots)) {
          finding("expected-source", "error", test, "expected_source", `${test.id}: ${value} cites an evidence root, so it points to code.`);
        }
      }
    }
  }

  for (const defect of legacy.items.defect) {
    if (!defect.fm) continue;
    const status = str(defect.fm.data["status"]);
    const decision = str(defect.fm.data["decision"]);
    exists(defect, "rules", listField(defect, "rules") ?? [], ids.rule, "RN");
    if (status === "confirmed" && evidenceOf(defect)?.length === 0) {
      finding("defect-evidence", "error", defect, "status", `${defect.id} is confirmed and has no evidence.`);
    }
    if (status === "discarded") continue;
    if (decision === "undecided" && !(listField(defect, "questions") ?? []).some((q) => questions.has(q))) {
      finding("defect-question", "warning", defect, "decision", `${defect.id} is undecided and has no open P-xx question.`);
    }
    if (decision === "fix" && !tested("defects", defect.id)) {
      finding("defect-untested", "warning", defect, "decision", `${defect.id} will be fixed and no acceptance test (PA) describes the correct behaviour.`);
    }
  }
}

/** `index-stale` for the rule index. */
export function checkRulesIndexStale(project: Project, legacy: Legacy, lang: Lang, report: Report): void {
  const file = legacy.paths.rulesIndex;
  const abs = path.join(project.cwd, file);
  if (!fs.existsSync(abs)) {
    report({ rule: "missing-doc", severity: "warning", file, line: null, message: 'The rule index does not exist. Run "engkit index".' });
    return;
  }
  const withoutDate = (t: string) => t.replace(/\r\n/g, "\n").replace(/^date:.*$/m, "date: -");
  if (withoutDate(generateRulesIndex(lang, legacy, openQuestions(project), "-")) !== withoutDate(fs.readFileSync(abs, "utf-8"))) {
    report({ rule: "index-stale", severity: "warning", file, line: 1, message: 'The rule index is out of date. Run "engkit index" to regenerate it.' });
  }
}

/** `rule-deleted` (warning): rules are discarded, not deleted, so their ID and history stay. */
export function checkRuleDeleted(project: Project, legacy: Legacy, report: Report): void {
  const present = new Set(legacy.items.rule.map((r) => r.id));
  const seen = new Set<string>();
  for (const del of deletedFiles(project.cwd, legacy.paths[DIR_KEY.rule])) {
    const m = itemFilePattern("rule").exec(path.posix.basename(del.path));
    if (!m || seen.has(m[1]!) || present.has(m[1]!)) continue;
    seen.add(m[1]!);
    report({
      rule: "rule-deleted",
      severity: "warning",
      file: del.path,
      line: null,
      message: `${m[1]} (${PREFIX.rule}) was deleted in commit ${shortSha(del.sha)}. Set "status: discarded" instead of deleting a rule.`,
    });
  }
}
