/** Reads a pasted table (CSV with comma, semicolon or tab, or a Markdown table). */
import { parse } from "csv-parse/browser/esm/sync";

export const TABLE_DELIMITERS = ["auto", ",", ";", "\t"] as const;
export type TableDelimiter = (typeof TABLE_DELIMITERS)[number];

export type TableErrorCode =
  | "empty"
  | "syntax"
  | "no-rows"
  | "repeated-column"
  | "unknown-column"
  | "missing-column"
  | "cell-count"
  | "required"
  | "date"
  | "duration"
  | "start"
  | "end"
  | "id"
  | "repeated-id"
  | "unknown-id"
  | "status"
  | "key"
  | "cardinality"
  | "message-type"
  | "too-long";

export class TableError extends Error {
  readonly line: number | undefined;
  readonly column: string | undefined;
  readonly value: string | undefined;
  /** Which of the two tables of an entity-relationship diagram. */
  table: "main" | "relations" = "main";
  constructor(
    readonly code: TableErrorCode,
    info: { line?: number; column?: string; value?: string } = {}
  ) {
    super(code);
    this.line = info.line;
    this.column = info.column;
    this.value = info.value;
  }
}

export interface Row {
  /** Line of the pasted text, starting at 1. */
  line: number;
  cells: string[];
}

export interface Table {
  headerLine: number;
  header: string[];
  rows: Row[];
}

const isMarkdown = (text: string) => /^\s*\|/.test(text) || /^[^\n]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-+:?[ \t]*\|/.test(text.trimStart());

function markdownCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const body = line.trim().replace(/^\|/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += body[i];
  }
  // a line without the closing pipe still has a last cell
  if (cell.trim() !== "") cells.push(cell.trim());
  return cells;
}

function readMarkdown(text: string): Row[] {
  return text
    .split("\n")
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => l.text.trim() !== "")
    .map((l) => ({ line: l.line, cells: markdownCells(l.text) }))
    .filter((row, i) => !(i === 1 && row.cells.every((c) => /^:?-+:?$/.test(c))));
}

/** The most frequent candidate in the header line, outside quotes. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const header = (text.trimStart().split("\n")[0] ?? "").replace(/"[^"]*"/g, "");
  const count = (d: string) => header.split(d).length - 1;
  return (["\t", ";", ","] as const).reduce((best, d) => (count(d) > count(best) ? d : best), ",");
}

function readCsv(text: string, delimiter: string): Row[] {
  try {
    const records = parse(text, { delimiter, bom: true, skip_empty_lines: true, relax_column_count: true, info: true, raw: true }) as unknown as {
      record: string[];
      raw: string;
      info: { lines: number };
    }[];
    // `lines` is where a record ends; a quoted cell can span several, and `raw` starts with any blank lines skipped
    return records.map(({ record, raw, info }) => ({ line: info.lines - (raw.replace(/^[\r\n]+|[\r\n]+$/g, "").split("\n").length - 1), cells: record.map((c) => c.trim()) }));
  } catch (e) {
    const line = (e as { lines?: number }).lines;
    throw new TableError("syntax", typeof line === "number" ? { line } : {});
  }
}

export function readTable(input: string, delimiter: TableDelimiter = "auto"): Table {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") throw new TableError("empty");
  if (text.length > 200_000) throw new TableError("too-long");
  const rows = isMarkdown(text) ? readMarkdown(text) : readCsv(text, delimiter === "auto" ? detectDelimiter(text) : delimiter);
  const [header, ...body] = rows;
  if (!header) throw new TableError("empty");
  const filled = body.filter((r) => r.cells.some((c) => c !== ""));
  if (filled.length === 0) throw new TableError("no-rows");
  for (const row of filled) {
    // trailing empty cells are common in pasted spreadsheets
    if (row.cells.slice(header.cells.length).some((c) => c !== "")) throw new TableError("cell-count", { line: row.line });
  }
  return { headerLine: header.line, header: header.cells, rows: filled };
}

export interface ColumnSpec {
  /** Spanish name first, then English, then other accepted spellings. */
  names: readonly [string, string, ...string[]];
  required?: boolean;
}

const normalize = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export interface Record_<K extends string> {
  line: number;
  get: (column: K) => string;
  /** The name of the column as the table writes it. */
  header: (column: K) => string;
}

/** Matches the header against the expected columns and returns one record per row. */
export function columns<K extends string>(table: Table, specs: Record<K, ColumnSpec>): Record_<K>[] {
  const keys = Object.keys(specs) as K[];
  const at = new Map<K, number>();
  table.header.forEach((name, index) => {
    if (name === "" && table.rows.every((r) => (r.cells[index] ?? "") === "")) return;
    const key = keys.find((k) => specs[k].names.some((n) => normalize(n) === normalize(name)));
    if (key === undefined) throw new TableError("unknown-column", { line: table.headerLine, column: name });
    if (at.has(key)) throw new TableError("repeated-column", { line: table.headerLine, column: name });
    at.set(key, index);
  });
  for (const key of keys) {
    if (specs[key].required && !at.has(key)) throw new TableError("missing-column", { line: table.headerLine, column: specs[key].names.slice(0, 2).join(" / ") });
  }
  return table.rows.map((row) => {
    const get = (column: K) => {
      const index = at.get(column);
      return index === undefined ? "" : (row.cells[index] ?? "");
    };
    for (const key of keys) {
      if (specs[key].required && get(key) === "") throw new TableError("required", { line: row.line, column: table.header[at.get(key)!]! });
    }
    const header = (column: K) => table.header[at.get(column) ?? -1] ?? "";
    return { line: row.line, get, header };
  });
}
