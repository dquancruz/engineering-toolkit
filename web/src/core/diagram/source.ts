/** Pure checks on Mermaid source text: what is refused, what is not supported and where an error really is. */

/** Mermaid's own default limit: above it, it draws an error picture instead of failing. */
export const MAX_TEXT = 50_000;

export type ProblemCode = "empty" | "too-long" | "external-image" | "unknown-type" | "syntax" | "invalid-date" | "too-many-edges" | "render";

export interface Problem {
  code: ProblemCode;
  /** Line of the text as typed, starting at 1. Missing when Mermaid does not say. */
  line?: number;
  /** The text of that line. */
  source?: string;
  /** Mermaid's message, in English. */
  detail?: string;
}

export type DiagramNotice = "no-elk" | "no-math" | "links-removed" | "html-converted" | "external-removed" | "png-scaled";

/**
 * The text Mermaid parses is not the text typed: it removes the front matter, the `%%{…}%%` directives, the
 * comment lines and the leading blank lines first. These are the same removals, keeping for every character
 * left the line it came from. Returns the original line of each parsed line.
 */
export function parsedLines(text: string): number[] {
  let chars = text.replace(/\r\n?/g, "\n");
  let origin: number[] = [];
  let line = 1;
  for (let i = 0; i < chars.length; i++) {
    origin.push(line);
    if (chars[i] === "\n") line++;
  }
  const remove = (pattern: RegExp) => {
    let out = "";
    const kept: number[] = [];
    let from = 0;
    const keep = (to: number) => {
      out += chars.slice(from, to);
      for (let i = from; i < to; i++) kept.push(origin[i]!);
    };
    for (const match of chars.matchAll(pattern)) {
      keep(match.index);
      from = match.index + match[0].length;
    }
    keep(chars.length);
    chars = out;
    origin = kept;
  };
  remove(/^([ \t]*)---[ \t]*\n[\s\S]*?\n\1---\s*\n/g);
  remove(/%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi);
  remove(/^\s*%%(?!{)[^\n]+\n?/gm);
  remove(/^\s+/g);
  const lines: number[] = [];
  let start = true;
  for (let i = 0; i < chars.length; i++) {
    if (start) lines.push(origin[i]!);
    start = chars[i] === "\n";
  }
  return lines;
}

interface ParserError {
  message?: string;
  result?: { lexerErrors?: { line?: number }[]; parserErrors?: { token?: { startLine?: number } }[] };
}

/** The line in the parsed text that an error points to, if it points to one. */
function reportedLine(error: ParserError): number | undefined {
  const chevrotain = error.result?.lexerErrors?.[0]?.line ?? error.result?.parserErrors?.[0]?.token?.startLine;
  if (typeof chevrotain === "number" && Number.isFinite(chevrotain)) return chevrotain;
  const jison = /(?:Parse|Lexical|Syntax) error on line (\d+)/i.exec(error.message ?? "")?.[1];
  return jison === undefined ? undefined : Number(jison);
}

export function toProblem(error: unknown, text: string): Problem {
  const e = (typeof error === "object" && error !== null ? error : { message: String(error) }) as ParserError;
  const detail = (e.message ?? String(error)).slice(0, 600);
  const code: ProblemCode = /No diagram type detected/i.test(detail)
    ? "unknown-type"
    : /Invalid date/i.test(detail)
      ? "invalid-date"
      : /Edge limit exceeded|Too many edges/i.test(detail)
        ? "too-many-edges"
        : /(Parse|Lexical|Syntax|Lexer) error|Parsing failed|Expecting/i.test(detail)
          ? "syntax"
          : "render";
  const parsed = reportedLine(e);
  if (parsed === undefined) return { code, detail };
  const map = parsedLines(text);
  // an error at the end of the text can point one line past it
  const line = map[Math.min(Math.max(parsed, 1), map.length) - 1];
  if (line === undefined) return { code, detail };
  return { code, line, source: text.split(/\r\n?|\n/)[line - 1] ?? "", detail };
}

/**
 * `A@{ img: "…" }` with a web address loads a picture while drawing. The Content-Security-Policy blocks it, but the
 * resulting error says nothing, so it is refused here with a reason. Only data: pictures are accepted.
 */
// the bounded repetition keeps this fast on a long text full of "@{"
const IMAGE = /@\{[^}]{0,2000}?["']?\bimg\b["']?\s*:\s*(?!\s|["']?data:image\/)/;

export function check(text: string): Problem | null {
  if (text.trim() === "") return { code: "empty" };
  if (text.length > MAX_TEXT) return { code: "too-long" };
  const image = IMAGE.exec(text);
  if (image) {
    const line = text.slice(0, image.index + image[0].length).split("\n").length;
    return { code: "external-image", line, source: text.split("\n")[line - 1] ?? "" };
  }
  return null;
}

/** Things the text asks for that this build does not include. */
export function unsupported(text: string): DiagramNotice[] {
  const notices: DiagramNotice[] = [];
  if (/^\s*flowchart-elk\b|\b(?:layout|defaultRenderer)["']?\s*:\s*["']?elk/m.test(text)) notices.push("no-elk");
  if (/\$\$[^\n]*?\$\$/.test(text)) notices.push("no-math");
  return notices;
}
