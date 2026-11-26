import { visibleText } from "../check/text.js";
import { parseEntries, type PendingEntry } from "./pending.js";

/**
 * Entries of a register document. Only real entries count (not those inside comments or code blocks), but
 * field values come from the raw lines, so text written as `code` is kept.
 */
export function parseRegister(text: string, prefix: Parameters<typeof parseEntries>[1]): PendingEntry[] {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const entries = parseEntries(visibleText(text), prefix);
  for (const entry of entries) {
    const heading = /^###\s+[A-Z]+-\d+\b\s*:?\s*(.*)$/.exec(raw[entry.line - 1] ?? "");
    if (heading) entry.title = heading[1]!.replace(/<!--.*?-->/g, "").trim();
    for (const [key, field] of Object.entries(entry.fields)) {
      const m = /^[-*]\s+\w+:\s*(.*)$/.exec(raw[field.line - 1] ?? "");
      if (m) entry.fields[key] = { value: m[1]!.replace(/<!--.*?-->/g, "").trim(), line: field.line };
    }
  }
  return entries;
}
