import { loadConfig } from "../config.js";
import { CheckSetupError, loadProject } from "../check/project.js";
import { gitState } from "../check/git.js";
import { checkFrontmatter, checkStatusDates, checkTodoFields } from "../check/rules/documents.js";
import { checkAdrDeleted, checkAdrImmutable, checkLogAppendOnly, gitLimitation } from "../check/rules/history.js";
import { checkUniqueIds } from "../check/rules/ids.js";
import { checkIndexStale } from "../check/rules/index-stale.js";
import { checkPending } from "../check/rules/pending.js";
import { checkReferences, checkSupersedeCoherence } from "../check/rules/refs.js";
import type { Finding, Report } from "../check/types.js";
import type { Lang } from "../i18n/index.js";

export { CheckSetupError };

export interface CheckOptions {
  cwd?: string;
  /** Warnings count as errors (for CI). */
  strict?: boolean;
}

export interface CheckResult {
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
  summary: { errors: number; warnings: number; files: number };
}

/** Runs every rule. Throws CheckSetupError when the project cannot be checked at all. */
export function runCheck(lang: Lang, options: CheckOptions = {}): CheckResult {
  const cwd = options.cwd ?? process.cwd();
  const project = loadProject(cwd);
  const storedLang = loadConfig(cwd).lang ?? lang;
  const findings: Finding[] = [];
  const report: Report = (f) => {
    findings.push({ severity: "error", ...f } as Finding);
  };

  for (const file of project.missing) {
    report({ rule: "missing-doc", severity: "warning", file, line: null, message: "Configured in .engkit.json but not found." });
  }

  checkFrontmatter(project, report);
  checkTodoFields(project, report);
  checkStatusDates(project, report);
  checkUniqueIds(project, report);
  checkReferences(project, report);
  checkSupersedeCoherence(project, report);
  checkPending(project, report);
  checkIndexStale(project, storedLang, report);

  const git = gitState(cwd);
  const limitation = gitLimitation(git);
  if (limitation) {
    report({ rule: "git-history", severity: "warning", file: ".", line: null, message: limitation });
  }
  if (git.available) {
    checkAdrImmutable(project, report);
    checkLogAppendOnly(project, report);
    checkAdrDeleted(project, report);
  }

  if (options.strict) {
    for (const f of findings) f.severity = "error";
  }

  const order = (f: Finding) => [f.file, f.line ?? 0, f.rule] as const;
  findings.sort((a, b) => {
    const [fa, la, ra] = order(a);
    const [fb, lb, rb] = order(b);
    return fa.localeCompare(fb) || la - lb || ra.localeCompare(rb);
  });

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { errors: errors.length, warnings: warnings.length, files: new Set(findings.map((f) => f.file)).size },
  };
}

export function formatReport(result: CheckResult): string {
  const all = [...result.errors, ...result.warnings].sort((a, b) =>
    a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule)
  );
  const lines: string[] = [];
  for (const f of all) {
    const where = f.line === null ? f.file : `${f.file}:${f.line}`;
    lines.push(`${where}  ${f.severity}  [${f.rule}]  ${f.message}`);
  }
  const { errors, warnings, files } = result.summary;
  if (all.length === 0) lines.push("✔ No problems found.");
  else lines.push("", `${errors} error(s), ${warnings} warning(s) in ${files} file(s).`);
  return lines.join("\n");
}
