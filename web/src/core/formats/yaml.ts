import YAML, { isScalar } from "yaml";
import { CoreError, type Notices } from "../notice.js";
import { MAX_DEPTH, childPath, losesPrecision, makeObject, type Value } from "../value.js";

/** Turns what the parser returns (Maps, BigInts) into plain data, reporting what changes on the way. */
function normalize(v: unknown, notices: Notices, path: string, depth: number): Value {
  if (depth > MAX_DEPTH) throw new CoreError("too-deep");
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") {
    if (Number.isSafeInteger(Number(v))) return Number(v);
    notices.add("big-integer", path);
    return v;
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((item, i) => normalize(item, notices, childPath(path, i), depth + 1));
  if (v instanceof Map) {
    const entries = new Map<string, Value>();
    for (const [key, value] of v) {
      if (typeof key !== "string") notices.add("key-as-text", childPath(path, String(key)));
      const name = typeof key === "object" && key !== null ? JSON.stringify(key) : String(key);
      if (entries.has(name)) notices.add("duplicate-key", childPath(path, name));
      entries.set(name, normalize(value, notices, childPath(path, name), depth + 1));
    }
    return makeObject(entries);
  }
  throw new CoreError("unsupported-value", { detail: `Unsupported YAML value at ${path || "the root"}` });
}

export function readYaml(text: string, notices: Notices): Value {
  const parsed = YAML.parseAllDocuments(text, { intAsBigInt: true, prettyErrors: true });
  const documents = Array.isArray(parsed) ? parsed : [];
  const values = documents.map((doc) => {
    const error = doc.errors[0];
    if (error) {
      const at = error.linePos?.[0];
      throw new CoreError("yaml-syntax", { ...(at ? { line: at.line, column: at.col } : {}), detail: error.message.split("\n")[0]! });
    }
    if (doc.warnings.length > 0) notices.add("yaml-warning");
    if (doc.comment || doc.commentBefore) notices.add("comments-lost");
    YAML.visit(doc, {
      Node: (_key, node) => {
        if (node.comment || node.commentBefore) notices.add("comments-lost");
        if (isScalar(node) && typeof node.value === "number" && node.source && losesPrecision(node.source)) notices.add("number-precision", node.source);
      },
      Alias: () => notices.add("yaml-aliases"),
    });
    try {
      // the alias limit stops documents that expand exponentially
      return normalize(doc.toJS({ mapAsMap: true, maxAliasCount: 100 }), notices, "", 0);
    } catch (e) {
      if (e instanceof CoreError) throw e;
      throw new CoreError("yaml-syntax", { detail: e instanceof Error ? e.message : String(e) });
    }
  });
  if (values.length > 1) {
    notices.add("yaml-multi-document");
    return values;
  }
  return values[0] ?? null;
}

export const writeYaml = (value: Value): string => YAML.stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });
