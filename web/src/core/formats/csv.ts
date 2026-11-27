// The browser builds: no network code, no eval, and unclosed quotes are errors.
import { parse } from "csv-parse/browser/esm/sync";
import { stringify } from "csv-stringify/browser/esm/sync";
import { CoreError, type Notices } from "../notice.js";
import { childPath, isObject, makeObject, type Value } from "../value.js";
import { writeJson } from "./json.js";

export const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export function readCsv(text: string, notices: Notices, delimiter: Delimiter = ","): Value {
  let rows: string[][];
  try {
    rows = parse(text, { delimiter, bom: true, skip_empty_lines: true }) as string[][];
  } catch (e) {
    const error = e as { lines?: number; message: string };
    throw new CoreError("csv-syntax", { ...(typeof error.lines === "number" ? { line: error.lines } : {}), detail: error.message });
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const repeated = header.find((name, i) => name === "" || header.indexOf(name) !== i);
  if (repeated !== undefined) throw new CoreError("csv-header", { line: 1, detail: repeated === "" ? "Empty column name" : `Repeated column "${repeated}"` });
  notices.add("csv-text");
  return body.map((row) => makeObject(header.map((name, i) => [name, row[i] ?? ""] as const)));
}

/** Spreadsheets read a cell that starts like this as a formula. */
const isFormula = (cell: string) => /^[=+\-@\t\r]/.test(cell) && !/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cell);

/**
 * Nested objects become `parent.child` columns and arrays are written as JSON inside their cell; every change
 * is reported.
 */
export function writeCsv(value: Value, notices: Notices, delimiter: Delimiter = ","): string {
  let items: Value[];
  if (Array.isArray(value)) items = value;
  else {
    items = [value];
    notices.add("csv-single-row");
  }

  const columns: string[] = [];
  const known = new Set<string>();
  const rows = items.map((item, index) => {
    const row = new Map<string, string>();
    const put = (column: string, v: Value, path: string) => {
      if (row.has(column)) throw new CoreError("csv-collision", { detail: `Two values for the column "${column}" (row ${index + 1})` });
      let cell: string;
      if (v === null) {
        notices.add("csv-null", path);
        cell = "";
      } else if (typeof v === "object") {
        if (Array.isArray(v)) notices.add("csv-array", path);
        cell = JSON.stringify(JSON.parse(writeJson(v, notices)));
      } else {
        if (typeof v !== "string") notices.add("csv-types", column);
        cell = String(v);
      }
      if (typeof v === "string" && isFormula(v)) notices.add("csv-formula", path);
      row.set(column, cell);
      if (!known.has(column)) {
        known.add(column);
        columns.push(column);
      }
    };
    const walk = (v: Value, column: string, path: string) => {
      if (isObject(v) && Object.keys(v).length > 0) {
        if (column !== "") notices.add("csv-flattened", column);
        for (const key of Object.keys(v)) walk(v[key]!, column === "" ? key : `${column}.${key}`, childPath(path, key));
      } else {
        put(column, v, path);
      }
    };
    const path = Array.isArray(value) ? `[${index}]` : "";
    if (isObject(item)) for (const key of Object.keys(item)) walk(item[key]!, key, childPath(path, key));
    else {
      notices.add("csv-scalar-rows");
      put("value", item, path);
    }
    return row;
  });

  if (rows.some((row) => row.size < columns.length)) notices.add("csv-missing");
  if (columns.length === 0) return "";
  return stringify([columns, ...rows.map((row) => columns.map((c) => row.get(c) ?? ""))], { delimiter });
}
