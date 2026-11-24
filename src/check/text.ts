/** 1-based line of `key:` inside the frontmatter, or 1 when not found. */
export function fieldLine(text: string, key: string): number {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    if (new RegExp(`^${key}:`).test(lines[i] ?? "")) return i + 1;
  }
  return 1;
}

/** Number of lines of the frontmatter block, including both `---` fences (0 when absent). */
export function frontmatterLines(text: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? m[0].split("\n").length - (m[0].endsWith("\n") ? 1 : 0) : 0;
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * Text with the frontmatter, fenced code blocks, HTML comments and inline code blanked out,
 * keeping every line number intact. Used to find references and entries in the visible body.
 */
export function visibleText(text: string): string {
  let out = text.replace(/\r\n/g, "\n");
  const fm = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(out);
  if (fm) out = blank(fm[0]) + out.slice(fm[0].length);

  let inFence: string | null = null;
  out = out
    .split("\n")
    .map((line) => {
      const fence = /^\s*(```+|~~~+)/.exec(line);
      if (inFence) {
        if (fence && fence[1]!.startsWith(inFence[0]!) && fence[1]!.length >= inFence.length) inFence = null;
        return blank(line);
      }
      if (fence) {
        inFence = fence[1]!;
        return blank(line);
      }
      return line;
    })
    .join("\n");

  out = out.replace(/<!--[\s\S]*?-->/g, blank);
  return out
    .split("\n")
    .map((line) => line.replace(/`[^`\n]*`/g, blank))
    .join("\n");
}

export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
