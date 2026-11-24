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
