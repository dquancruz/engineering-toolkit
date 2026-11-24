import { isTodoOrEmpty } from "../../docs/adr.js";
import { parsePendingEntries } from "../../docs/pending.js";
import type { Project } from "../project.js";
import { isRealDate, visibleText } from "../text.js";
import type { Report } from "../types.js";

const TYPES = ["review", "question"];
const STATUSES = ["open", "closed"];

/** `pending-entry` (valid fields) and `pending-owner` (every open item has an owner). */
export function checkPending(project: Project, report: Report): void {
  const doc = project.docs.find((d) => d.key === "pending");
  if (!doc) return;

  for (const entry of parsePendingEntries(visibleText(doc.text))) {
    const at = (key: string) => entry.fields[key]?.line ?? entry.line;
    const type = entry.fields["type"]?.value;
    const status = entry.fields["status"]?.value;
    const date = entry.fields["date"]?.value;

    if (!type || !TYPES.includes(type)) {
      report({ rule: "pending-entry", file: doc.file, line: at("type"), message: `${entry.id}: "type" must be ${TYPES.join(" | ")} (found: ${type ?? "nothing"}).` });
    }
    if (!status || !STATUSES.includes(status)) {
      report({ rule: "pending-entry", file: doc.file, line: at("status"), message: `${entry.id}: "status" must be ${STATUSES.join(" | ")} (found: ${status ?? "nothing"}).` });
    }
    if (date !== undefined && !isRealDate(date)) {
      report({ rule: "pending-entry", file: doc.file, line: at("date"), message: `${entry.id}: "date" must be a real date in YYYY-MM-DD format (found: ${date}).` });
    }
    if (status === "open" && isTodoOrEmpty(entry.fields["owner"]?.value)) {
      report({ rule: "pending-owner", file: doc.file, line: at("owner"), message: `${entry.id} is open and has no owner.` });
    }
  }
}
