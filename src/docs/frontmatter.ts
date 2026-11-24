import YAML from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface ParsedDoc {
  data: Record<string, unknown>;
  body: string;
}

/** Parses the YAML frontmatter at the top of a Markdown file. Returns null when absent or invalid. */
export function parseFrontmatter(text: string): ParsedDoc | null {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  try {
    const data = YAML.parse(match[1] ?? "") as unknown;
    if (data === null || data === undefined) return { data: {}, body: text.slice(match[0].length) };
    if (typeof data !== "object" || Array.isArray(data)) return null;
    return { data: data as Record<string, unknown>, body: text.slice(match[0].length) };
  } catch {
    return null;
  }
}

/** YAML-safe rendering of a scalar (quotes values such as `a: b`). */
export function yamlScalar(value: string): string {
  return YAML.stringify(value).trimEnd();
}

/**
 * Sets one frontmatter field with a minimal line edit (the rest of the file is untouched).
 * An empty value writes a blank field (`key:`). Adds the field before the closing `---` when it is missing.
 */
export function setFrontmatterField(text: string, key: string, value: string): string {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("Missing frontmatter");
  const block = match[1] ?? "";
  const line = value === "" ? `${key}:` : `${key}: ${yamlScalar(value)}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  const nextBlock = re.test(block) ? block.replace(re, () => line) : `${block}\n${line}`;
  const offset = text.startsWith("---\r\n") ? 5 : 4; // length of the opening "---\n"
  return text.slice(0, offset) + nextBlock + text.slice(offset + block.length);
}
