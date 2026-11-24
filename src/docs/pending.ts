/** Matches `### P-01`, `### P-99`, `### P-100`, ... (two digits minimum, no upper limit). */
const PENDING_HEADING = /^###\s+P-(\d+)\b/gm;

export function nextPendingNumber(text: string): number {
  let max = 0;
  for (const m of text.matchAll(PENDING_HEADING)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

export function formatPendingId(n: number): string {
  return `P-${String(n).padStart(2, "0")}`;
}

export interface PendingEntry {
  id: string;
  line: number;
  title: string;
  fields: Record<string, { value: string; line: number }>;
}

/**
 * Parses `### P-xx: title` entries and their `- key: value` lines.
 * `visible` is the text with code, comments and frontmatter blanked (see `visibleText`), so line numbers stay valid.
 */
export function parsePendingEntries(visible: string): PendingEntry[] {
  const entries: PendingEntry[] = [];
  let current: PendingEntry | null = null;
  visible.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    const heading = /^###\s+(P-\d+)\b\s*:?\s*(.*)$/.exec(line);
    if (heading) {
      current = { id: heading[1]!, line: i + 1, title: (heading[2] ?? "").trim(), fields: {} };
      entries.push(current);
      return;
    }
    if (/^#{1,6}\s/.test(line)) {
      current = null;
      return;
    }
    const field = current && /^[-*]\s+(\w+):\s*(.*)$/.exec(line);
    if (current && field) current.fields[field[1]!] = { value: field[2]!.trim(), line: i + 1 };
  });
  return entries;
}
