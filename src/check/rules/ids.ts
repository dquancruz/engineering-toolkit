import { parsePendingEntries } from "../../docs/pending.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, visibleText } from "../text.js";
import type { Report } from "../types.js";

/** `unique-id`: unique ADR numbers/ids, unique P-xx and unique document ids; an ADR id matches its file number. */
export function checkUniqueIds(project: Project, report: Report): void {
  const byNumber = new Map<number, string>();
  const byId = new Map<string, string>();
  for (const adr of project.adrs) {
    const first = byNumber.get(adr.number);
    if (first) {
      report({ rule: "unique-id", file: adr.file, line: 1, message: `ADR number ${adr.number} is also used by ${first}.` });
    } else {
      byNumber.set(adr.number, adr.file);
    }

    const id = str(adr.fm?.data["id"]);
    if (id === null) continue;
    const expected = `ADR-${String(adr.number).padStart(4, "0")}`;
    if (id !== expected) {
      report({
        rule: "unique-id",
        file: adr.file,
        line: fieldLine(adr.text, "id"),
        message: `The id (${id}) does not match the file number (${expected}).`,
      });
    }
    const firstId = byId.get(id);
    if (firstId) {
      report({ rule: "unique-id", file: adr.file, line: fieldLine(adr.text, "id"), message: `Duplicate id ${id} (also in ${firstId}).` });
    } else {
      byId.set(id, adr.file);
    }
  }

  const docIds = new Map<string, string>();
  for (const doc of project.docs) {
    const id = str(doc.fm?.data["id"]);
    if (id === null) continue;
    const first = docIds.get(id);
    if (first) {
      report({ rule: "unique-id", file: doc.file, line: fieldLine(doc.text, "id"), message: `Duplicate document id ${id} (also in ${first}).` });
    } else {
      docIds.set(id, doc.file);
    }
  }

  const pending = project.docs.find((d) => d.key === "pending");
  if (pending) {
    const seen = new Map<string, number>();
    for (const entry of parsePendingEntries(visibleText(pending.text))) {
      const first = seen.get(entry.id);
      if (first !== undefined) {
        report({ rule: "unique-id", file: pending.file, line: entry.line, message: `Duplicate ${entry.id} (first defined on line ${first}).` });
      } else {
        seen.set(entry.id, entry.line);
      }
    }
  }
}
