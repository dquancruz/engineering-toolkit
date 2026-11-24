import fs from "node:fs";
import path from "node:path";
import { generateIndex } from "../../commands/index-cmd.js";
import type { Lang } from "../../i18n/index.js";
import type { Project } from "../project.js";
import type { Report } from "../types.js";

const withoutDate = (text: string) => text.replace(/\r\n/g, "\n").replace(/^date:.*$/m, "date: -");

/** `index-stale` (warning): the generated ADR index no longer matches the ADRs (its own date is ignored). */
export function checkIndexStale(project: Project, lang: Lang, report: Report): void {
  const file = project.paths.decisions;
  const abs = path.join(project.cwd, file);
  if (!fs.existsSync(abs) || !fs.existsSync(path.join(project.cwd, project.paths.adrDir))) return;

  const expected = generateIndex(lang, path.join(project.cwd, project.paths.adrDir), project.paths, "-", () => {});
  if (withoutDate(expected) !== withoutDate(fs.readFileSync(abs, "utf-8"))) {
    report({
      rule: "index-stale",
      severity: "warning",
      file,
      line: 1,
      message: 'The ADR index is out of date. Run "engkit index" to regenerate it.',
    });
  }
}
