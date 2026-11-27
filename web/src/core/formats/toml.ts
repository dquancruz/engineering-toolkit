import { TomlDate, TomlError, parse, stringify } from "smol-toml";
import { CoreError, type Notices } from "../notice.js";
import { childPath, isObject, losesPrecision, makeObject, type Value } from "../value.js";

const STRINGS = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/g;

function normalize(v: unknown, notices: Notices, path: string): Value {
  if (v instanceof TomlDate) {
    notices.add("date-as-text", path);
    return v.toISOString();
  }
  if (typeof v === "bigint") {
    notices.add("big-integer", path);
    return v;
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((item, i) => normalize(item, notices, childPath(path, i)));
  const object = v as Record<string, unknown>;
  return makeObject(Object.keys(object).map((k) => [k, normalize(object[k], notices, childPath(path, k))] as const));
}

export function readToml(text: string, notices: Notices): Value {
  let data: unknown;
  try {
    data = parse(text, { integersAsBigInt: "asNeeded", unsafeKeyBehaviour: "keep", maxDepth: 500 });
  } catch (e) {
    if (e instanceof TomlError) throw new CoreError("toml-syntax", { line: e.line, column: e.column, detail: e.message.split("\n")[0]! });
    throw new CoreError("toml-syntax", { detail: e instanceof Error ? e.message : String(e) });
  }
  // the parser does not report comments or rounded floats, so look at the text outside strings
  const bare = text.replace(STRINGS, '""');
  if (bare.includes("#")) notices.add("comments-lost");
  for (const literal of bare.replace(/#.*$/gm, "").match(/[+-]?\d[\d_]*\.[\d_]+(?:[eE][+-]?\d+)?/g) ?? []) {
    if (losesPrecision(literal)) notices.add("number-precision", literal);
  }
  return normalize(data, notices, "");
}

/** TOML has no null: those keys and items are left out, one notice each. */
function withoutNull(v: Value, notices: Notices, path: string): Value {
  if (typeof v === "bigint" && (v > 9223372036854775807n || v < -9223372036854775808n)) {
    throw new CoreError("toml-range", { detail: `${path}: outside the 64-bit integer range` });
  }
  if (v === null || typeof v !== "object") return v;
  const keep = (child: Value, childAt: string): child is Exclude<Value, null> => {
    if (child !== null) return true;
    notices.add("toml-null", childAt);
    return false;
  };
  if (Array.isArray(v)) {
    return v.filter((item, i) => keep(item, childPath(path, i))).map((item, i) => withoutNull(item, notices, childPath(path, i)));
  }
  return makeObject(
    Object.keys(v)
      .filter((k) => keep(v[k]!, childPath(path, k)))
      .map((k) => [k, withoutNull(v[k]!, notices, childPath(path, k))] as const)
  );
}

export function writeToml(value: Value, notices: Notices): string {
  let root = value;
  if (!isObject(value)) {
    // a TOML document is a table: lists go under "items" and single values under "value"
    notices.add("toml-wrapped");
    root = value === null ? makeObject([]) : makeObject([[Array.isArray(value) ? "items" : "value", value]]);
    if (value === null) notices.add("toml-null");
  }
  try {
    return stringify(withoutNull(root, notices, "")) + "\n";
  } catch (e) {
    if (e instanceof CoreError) throw e;
    throw new CoreError("unsupported-value", { detail: e instanceof Error ? e.message : String(e) });
  }
}
