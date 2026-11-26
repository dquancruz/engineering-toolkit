import { CoreError, type Notices } from "./notice.js";
import { MAX_DEPTH, childPath, losesPrecision, makeObject, type Value } from "./value.js";

/**
 * A strict JSON parser that keeps every number and string as written, so formatting never alters them
 * (`JSON.parse` would round large numbers and drop repeated keys).
 */
export type JsonNode =
  | { type: "object"; entries: { raw: string; key: string; value: JsonNode }[] }
  | { type: "array"; items: JsonNode[] }
  | { type: "string"; raw: string; value: string }
  | { type: "number"; raw: string }
  | { type: "literal"; raw: "true" | "false" | "null" };

export interface Parsed {
  node: JsonNode;
  /** Paths of keys that appear more than once in the same object. */
  duplicates: string[];
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const SPACE = /[ \t\n\r]*/y;

export function parseJson(text: string): Parsed {
  let at = 0;
  const duplicates: string[] = [];

  const fail = (detail: string, position = at): never => {
    const before = text.slice(0, position).split("\n");
    throw new CoreError("json-syntax", { line: before.length, column: before.at(-1)!.length + 1, detail });
  };
  const match = (re: RegExp): string | null => {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) return null;
    at += m[0].length;
    return m[0];
  };
  const space = () => void match(SPACE);
  const expect = (char: string) => {
    if (text[at] !== char) fail(at >= text.length ? `Unexpected end of input, expected "${char}"` : `Expected "${char}"`);
    at++;
  };

  const string = (): { raw: string; value: string } => {
    const start = at;
    const raw = match(STRING);
    if (raw === null) fail("Invalid or unterminated string", start);
    return { raw: raw!, value: JSON.parse(raw!) as string };
  };

  const value = (path: string, depth: number): JsonNode => {
    if (depth > MAX_DEPTH) throw new CoreError("too-deep");
    space();
    const c = text[at];
    if (c === "{") {
      at++;
      const entries: Extract<JsonNode, { type: "object" }>["entries"] = [];
      const keys = new Set<string>();
      space();
      if (text[at] === "}") at++;
      else {
        for (;;) {
          space();
          if (text[at] !== '"') fail('Expected a key in double quotes');
          const key = string();
          const child = childPath(path, key.value);
          if (keys.has(key.value)) duplicates.push(child);
          keys.add(key.value);
          space();
          expect(":");
          entries.push({ raw: key.raw, key: key.value, value: value(child, depth + 1) });
          space();
          if (text[at] === ",") at++;
          else {
            expect("}");
            break;
          }
        }
      }
      return { type: "object", entries };
    }
    if (c === "[") {
      at++;
      const items: JsonNode[] = [];
      space();
      if (text[at] === "]") at++;
      else {
        for (;;) {
          items.push(value(childPath(path, items.length), depth + 1));
          space();
          if (text[at] === ",") at++;
          else {
            expect("]");
            break;
          }
        }
      }
      return { type: "array", items };
    }
    if (c === '"') return { type: "string", ...string() };
    for (const word of ["true", "false", "null"] as const) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return { type: "literal", raw: word };
      }
    }
    const number = match(NUMBER);
    if (number !== null) return { type: "number", raw: number };
    return fail(at >= text.length ? "Unexpected end of input" : "Unexpected character");
  };

  if (text.charCodeAt(0) === 0xfeff) at = 1;
  const node = value("", 0);
  space();
  if (at < text.length) fail("Unexpected content after the value");
  return { node, duplicates };
}

/** Prints a node with `indent` spaces, or on one line with no spaces when `indent` is 0. */
export function printJson(node: JsonNode, indent = 2): string {
  const walk = (n: JsonNode, level: number): string => {
    if (n.type === "string" || n.type === "number" || n.type === "literal") return n.raw;
    const [open, close] = n.type === "object" ? ["{", "}"] : ["[", "]"];
    const items =
      n.type === "object"
        ? n.entries.map((e) => `${e.raw}:${indent ? " " : ""}${walk(e.value, level + 1)}`)
        : n.items.map((i) => walk(i, level + 1));
    if (items.length === 0) return `${open}${close}`;
    if (!indent) return `${open}${items.join(",")}${close}`;
    const pad = " ".repeat(indent * (level + 1));
    return `${open}\n${pad}${items.join(`,\n${pad}`)}\n${" ".repeat(indent * level)}${close}`;
  };
  return walk(node, 0);
}

/** The data of a node. Large integers become BigInt (kept exact); other numbers that would be rounded are reported. */
export function jsonValue(node: JsonNode, notices: Notices, path = ""): Value {
  switch (node.type) {
    case "object":
      // like JSON.parse, the last repeated key wins; parseJson reports the repetition
      return makeObject(node.entries.map((e) => [e.key, jsonValue(e.value, notices, childPath(path, e.key))] as const));
    case "array":
      return node.items.map((item, i) => jsonValue(item, notices, childPath(path, i)));
    case "string":
      return node.value;
    case "literal":
      return node.raw === "null" ? null : node.raw === "true";
    case "number": {
      if (/^-?\d+$/.test(node.raw) && !Number.isSafeInteger(Number(node.raw))) {
        notices.add("big-integer", path);
        return BigInt(node.raw);
      }
      if (losesPrecision(node.raw)) notices.add("number-precision", path);
      return Number(node.raw);
    }
  }
}
