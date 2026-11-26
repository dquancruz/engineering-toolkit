export class SectionExists extends Error {}

const HEADING = /^## /;

/** `v1.2.0`, `1.2.0` and `[v1.2.0] - 2026-01-01` all name the same release. */
function releaseKey(text: string): string {
  const m = /^##\s+\[?([^\]\s]+)\]?/.exec(text);
  return (m?.[1] ?? text).toLowerCase().replace(/^v(?=\d)/, "");
}

/**
 * Puts `section` above the newest release of a changelog, leaving every other line as it was. With
 * `replace`, an existing section of the same release is rewritten where it is; otherwise it is an error.
 */
export function insertSection(existing: string | null, section: string, replace = false): string {
  const eol = existing?.includes("\r\n") ? "\r\n" : "\n";
  const added = section.trimEnd().split("\n");
  if (existing === null || existing.trim() === "") return ["# Changelog", "", ...added, ""].join(eol);

  const lines = existing.split(/\r?\n/);
  const key = releaseKey(added[0]!);
  const same = lines.findIndex((l) => HEADING.test(l) && releaseKey(l) === key);
  if (same !== -1) {
    if (!replace) throw new SectionExists(lines[same]!);
    let end = same + 1;
    while (end < lines.length && !HEADING.test(lines[end]!)) end++;
    const rest = lines.slice(end);
    return [...lines.slice(0, same), ...added, "", ...rest].join(eol);
  }

  const first = lines.findIndex((l) => HEADING.test(l));
  if (first !== -1) return [...lines.slice(0, first), ...added, "", ...lines.slice(first)].join(eol);
  while (lines.at(-1) === "") lines.pop();
  return [...lines, "", ...added, ""].join(eol);
}
