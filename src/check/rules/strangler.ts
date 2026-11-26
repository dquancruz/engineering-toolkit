import { isRecord, normalizeTable, text, HANDOVER_STATUSES, WRITERS } from "../../rebuild/model.js";
import type { Project } from "../project.js";
import { fieldLine, isRealDate } from "../text.js";
import type { Report, Severity } from "../types.js";

/** The strangler plan: one writer per table at any time, with dated and owned handovers. */
export function checkStrangler(project: Project, report: Report, today: string): void {
  const doc = project.rebuild?.strangler;
  if (!doc?.fm) return; // a missing or invalid frontmatter is reported with the other documents
  const tables = doc.fm.data["tables"] ?? [];
  const lines = doc.text.split("\n");
  const add = (rule: string, severity: Severity, line: number, message: string) => report({ rule, severity, file: doc.file, line, message });
  if (!Array.isArray(tables)) {
    add("strangler-table", "error", fieldLine(doc.text, "tables"), '"tables" must be a list.');
    return;
  }

  const slices = new Map(project.rebuild!.slices.map((s) => [s.id, s]));
  const seen = new Map<string, string>();
  const moves: { table: string; order: number; date: string; line: number }[] = [];
  let from = 0;

  for (const entry of tables) {
    const name = isRecord(entry) ? text(entry["table"]) : null;
    if (!isRecord(entry) || name === null) {
      add("strangler-table", "error", fieldLine(doc.text, "tables"), 'every entry of "tables" needs a "table" name.');
      continue;
    }
    // the line of this entry, searching forward so a repeated table points to its second appearance
    const found = lines.findIndex((l, i) => i >= from && /\btable["']?\s*:/.test(l) && l.includes(name));
    const line = found === -1 ? fieldLine(doc.text, "tables") : found + 1;
    if (found !== -1) from = found + 1;
    const fail = (rule: string, message: string) => add(rule, "error", line, `${name}: ${message}`);
    const warn = (rule: string, message: string) => add(rule, "warning", line, `${name}: ${message}`);

    const key = normalizeTable(name);
    const first = seen.get(key);
    if (first !== undefined) fail("single-writer", `the table is listed twice (also as ${first}); each table has exactly one entry and one writer.`);
    else seen.set(key, name);

    const writer = entry["writer"];
    const validWriter = typeof writer === "string" && (WRITERS as readonly string[]).includes(writer);
    if (!validWriter) fail("single-writer", `"writer" must be exactly one of ${WRITERS.join(" | ")}.`);

    const order = entry["order"];
    if (!Number.isInteger(order) || (order as number) < 1) fail("strangler-table", '"order" must be a whole number from 1.');

    const handover = isRecord(entry["handover"]) ? entry["handover"] : {};
    const to = text(handover["to"]);
    const date = text(handover["date"]);
    const status = text(handover["status"]);
    const slice = text(handover["slice"]);
    if (to === null || !(WRITERS as readonly string[]).includes(to)) fail("handover", `"handover.to" must be one of ${WRITERS.join(" | ")}.`);
    if (date === null || !isRealDate(date)) fail("handover", '"handover.date" must be a real date (YYYY-MM-DD).');
    if (text(handover["owner"]) === null) fail("handover", '"handover.owner" is missing.');
    if (slice === null) fail("handover", '"handover.slice" is missing.');
    else if (!slices.has(slice)) add("broken-ref", "error", line, `${name}: handover.slice ${slice} does not exist.`);
    else if (slices.get(slice)!.fm?.data["status"] === "dropped") warn("handover", `its handover slice ${slice} is dropped.`);
    if (status === null || !(HANDOVER_STATUSES as readonly string[]).includes(status)) {
      fail("handover", `"handover.status" must be one of ${HANDOVER_STATUSES.join(" | ")}.`);
    } else if (validWriter && to !== null) {
      if (status === "done" && writer !== to) fail("single-writer", `the handover to "${to}" is done, but the writer is still "${writer as string}".`);
      if (status === "planned" && writer === to) fail("single-writer", `the writer is already "${to}", but the handover is only planned.`);
      if (status === "planned" && date !== null && isRealDate(date) && date < today) warn("handover-overdue", `the handover planned for ${date} has not happened.`);
    }
    if (text(entry["verify"]) === null) warn("handover-unverified", 'no "verify": add the test that proves nothing else writes the table (for example of its permissions).');
    if (Number.isInteger(order) && date !== null && isRealDate(date)) moves.push({ table: name, order: order as number, date, line });
  }

  // an unqualified name may be the same table as a qualified one
  for (const [key, name] of seen) {
    if (key.includes(".")) continue;
    const other = [...seen].find(([k]) => k.endsWith(`.${key}`));
    if (other) add("strangler-ambiguous", "warning", fieldLine(doc.text, "tables"), `"${name}" and "${other[1]}" may be the same table: write both with their schema.`);
  }

  moves.sort((a, b) => a.order - b.order);
  for (const move of moves) {
    const later = moves.find((m) => m.order < move.order && m.date > move.date);
    if (later) add("handover-order", "warning", move.line, `${move.table} moves after ${later.table} (order ${move.order} > ${later.order}) but on an earlier date.`);
  }
}
