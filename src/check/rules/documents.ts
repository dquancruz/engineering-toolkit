import { isTodoOrEmpty } from "../../docs/adr.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, isRealDate } from "../text.js";
import type { Report } from "../types.js";

const ADR_STATUSES = ["proposed", "accepted", "superseded"];
const MARKER = /(\d{4}-\d{2}-\d{2})(?=\.? <!-- engkit:date -->)/;

/** `frontmatter`: every managed document has a parseable frontmatter with an id (and a valid ADR status). */
export function checkFrontmatter(project: Project, report: Report): void {
  for (const doc of [...project.docs, ...project.adrs]) {
    if (!doc.fm) {
      report({ rule: "frontmatter", file: doc.file, line: 1, message: "Missing or invalid YAML frontmatter." });
      continue;
    }
    if (str(doc.fm.data["id"]) === null) {
      report({ rule: "frontmatter", file: doc.file, line: fieldLine(doc.text, "id"), message: 'Missing "id" in the frontmatter.' });
    }
    if (doc.key === "adr") {
      const status = str(doc.fm.data["status"]);
      if (status === null || !ADR_STATUSES.includes(status)) {
        report({
          rule: "frontmatter",
          file: doc.file,
          line: fieldLine(doc.text, "status"),
          message: `"status" must be one of ${ADR_STATUSES.join(" | ")} (found: ${status ?? "nothing"}).`,
        });
      }
    }
  }
}

/** `todo-field`: owner and date are required (and not TODO) where the template defines them. */
export function checkTodoFields(project: Project, report: Report): void {
  for (const doc of [...project.docs, ...project.adrs]) {
    if (!doc.fm) continue;
    const required = doc.key === "log" ? ["owner"] : ["owner", "date"];
    for (const key of required) {
      const value = doc.fm.data[key];
      if (isTodoOrEmpty(value)) {
        const missing = str(value) === null;
        report({
          rule: "todo-field",
          file: doc.file,
          line: fieldLine(doc.text, key),
          message: missing ? `"${key}" is missing or empty.` : `"${key}" is still TODO.`,
        });
      }
    }
  }
}

/** `status-date`: status documents have a valid date, and the visible date matches the frontmatter. */
export function checkStatusDates(project: Project, report: Report): void {
  for (const doc of [...project.docs, ...project.adrs]) {
    if (!doc.fm || doc.key === "log") continue;
    const date = str(doc.fm.data["date"]);
    if (date === null || date.toUpperCase() === "TODO") continue; // reported by todo-field
    const line = fieldLine(doc.text, "date");
    if (!isRealDate(date)) {
      report({ rule: "status-date", file: doc.file, line, message: `"date" must be a real date in YYYY-MM-DD format (found: ${date}).` });
      continue;
    }
    if (doc.key === "adr") continue; // an ADR's date is its visible date

    const body = doc.text.replace(/\r\n/g, "\n");
    const marker = MARKER.exec(body);
    if (marker) {
      if (marker[1] !== date) {
        const markerLine = body.slice(0, marker.index).split("\n").length;
        report({
          rule: "status-date",
          file: doc.file,
          line: markerLine,
          message: `The visible date (${marker[1]}) differs from the frontmatter date (${date}).`,
        });
      }
    } else if (!(doc.fm.body.includes(date))) {
      report({ rule: "status-date", file: doc.file, line, message: `No visible date in the document body (expected ${date}).` });
    }
  }
}
