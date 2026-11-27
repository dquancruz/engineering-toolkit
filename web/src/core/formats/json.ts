import { jsonValue, parseJson } from "../json.js";
import type { Notices } from "../notice.js";
import { childPath, type Value } from "../value.js";

export function readJson(text: string, notices: Notices): Value {
  const { node, duplicates } = parseJson(text);
  for (const path of duplicates) notices.add("duplicate-key", path);
  return jsonValue(node, notices);
}

export function writeJson(value: Value, notices: Notices): string {
  const walk = (v: Value, level: number, path: string): string => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number" && !Number.isFinite(v)) {
      notices.add("non-finite", path);
      return "null";
    }
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    const pad = "  ".repeat(level + 1);
    const items = Array.isArray(v)
      ? v.map((item, i) => walk(item, level + 1, childPath(path, i)))
      : Object.keys(v).map((k) => `${JSON.stringify(k)}: ${walk(v[k]!, level + 1, childPath(path, k))}`);
    const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
    return items.length === 0 ? `${open}${close}` : `${open}\n${pad}${items.join(`,\n${pad}`)}\n${"  ".repeat(level)}${close}`;
  };
  return walk(value, 0, "") + "\n";
}
