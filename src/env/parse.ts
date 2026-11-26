/**
 * Reads the variable NAMES of a dotenv file. Values are skipped and never returned.
 *
 * It fails closed: anything it cannot read for certain is a problem, and a file with a problem yields no
 * names, because a line of a badly quoted multi-line secret can look like `name=`. Problems carry a line
 * number and a fixed reason, never text from the file.
 */

export interface EnvProblem {
  line: number;
  reason: string;
}

export interface EnvNames {
  /** In order of appearance, without duplicates. Empty when there are problems. */
  names: string[];
  problems: EnvProblem[];
}

const ASSIGNMENT = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/;
const IGNORED = /^[ \t]*(?:#.*)?$/;

/** Index of the closing quote in `text`, or -1. Backslash escapes count in double quotes and backticks. */
function closingQuote(text: string, quote: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\" && quote !== "'") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/**
 * The last line of base64 text (`dGhpcw==`) reads as an assignment. No real variable has a value made only
 * of "=", or an empty value together with a name that mixes upper and lower case.
 */
function looksLikeBase64(name: string, value: string): boolean {
  if (/^=+$/.test(value)) return true;
  return value === "" && /[a-z]/.test(name) && /[A-Z]/.test(name);
}

export function readEnvNames(text: string): EnvNames {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const names = new Set<string>();
  const fail = (line: number, reason: string): EnvNames => ({ names: [], problems: [{ line, reason }] });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (IGNORED.test(line)) continue;
    const start = i + 1;
    const m = line.includes("\0") ? null : ASSIGNMENT.exec(line);
    if (!m) return fail(start, "not a NAME=value line or a comment");
    const name = m[1]!;
    const value = m[2]!.trim();
    if (looksLikeBase64(name, value)) return fail(start, "looks like part of a multi-line value that is not quoted");

    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      let rest = value;
      let end = closingQuote(rest, quote, 1);
      while (end === -1 && i + 1 < lines.length) {
        rest = lines[++i]!;
        end = closingQuote(rest, quote, 0);
      }
      if (end === -1) return fail(start, "quoted value is never closed");
      if (!IGNORED.test(rest.slice(end + 1))) return fail(i + 1, "unexpected text after a closing quote");
    } else if (value.startsWith("-----BEGIN")) {
      let current = value;
      while (!current.includes("-----END") && i + 1 < lines.length) current = lines[++i]!;
      if (!current.includes("-----END")) return fail(start, "PEM block is never closed");
    } else if (value.endsWith("\\")) {
      return fail(start, "line continuation with a backslash is not supported; quote the value");
    }
    names.add(name);
  }
  return { names: [...names], problems: [] };
}
