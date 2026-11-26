import { isTodoOrEmpty } from "../../docs/adr.js";
import { SOURCE_FIELDS, SOURCE_TYPES } from "../../sources/register.js";
import type { Project } from "../project.js";
import { isRealDate } from "../text.js";
import type { Report } from "../types.js";

/** `unique-id` and `source-entry`: every entry of the sources register says what it is and how it was obtained. */
export function checkSources(project: Project, report: Report): void {
  const sources = project.sources;
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
