/** Minimal unified diff (longest common subsequence on lines). Settings files are small, so O(n*m) is fine. */
export function unifiedDiff(before: string, after: string, label: string, context = 3): string {
  const a = before === "" ? [] : before.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  type Op = { kind: " " | "-" | "+"; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]! });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      ops.push({ kind: "+", text: b[j]! });
      j++;
    } else {
      ops.push({ kind: "-", text: a[i]! });
      i++;
    }
  }

  const changed = ops.flatMap((op, idx) => (op.kind === " " ? [] : [idx]));
  if (changed.length === 0) return "";

  // Group the changes into hunks with `context` unchanged lines around them.
  const hunks: [number, number][] = [];
  for (const idx of changed) {
    const from = Math.max(0, idx - context);
    const to = Math.min(ops.length - 1, idx + context);
    const last = hunks[hunks.length - 1];
    if (last && from <= last[1] + 1) last[1] = to;
    else hunks.push([from, to]);
  }

  const lines = [`--- ${label} (current)`, `+++ ${label} (proposed)`];
  for (const [from, to] of hunks) {
    const slice = ops.slice(from, to + 1);
    const oldStart = ops.slice(0, from).filter((o) => o.kind !== "+").length + 1;
    const newStart = ops.slice(0, from).filter((o) => o.kind !== "-").length + 1;
    const oldCount = slice.filter((o) => o.kind !== "+").length;
    const newCount = slice.filter((o) => o.kind !== "-").length;
    lines.push(`@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@`);
    for (const op of slice) lines.push(op.kind + op.text);
  }
  return lines.join("\n");
}
