import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { CoreError, type Notices } from "../notice.js";
import { childPath, isObject, makeObject, type Value } from "../value.js";

const ATTRIBUTE = "@_";
const TEXT = "#text";
const OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE,
  // values stay as written: "007" must not become 7
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  htmlEntities: true,
} as const;

type Ordered = Record<string, unknown>[];

/** True when elements of the same name are separated by others: grouping them loses their order. */
function interleaved(nodes: Ordered): boolean {
  const done = new Set<string>();
  let previous = "";
  for (const node of nodes) {
    const name = Object.keys(node).find((k) => k !== ":@" && k !== TEXT);
    if (name === undefined) continue;
    if (name !== previous && done.has(name)) return true;
    done.add(name);
    previous = name;
    if (interleaved(node[name] as Ordered)) return true;
  }
  return false;
}

function normalize(v: unknown, notices: Notices, path: string): Value {
  if (typeof v !== "object" || v === null) return String(v ?? "");
  if (Array.isArray(v)) return v.map((item, i) => normalize(item, notices, childPath(path, i)));
  const object = v as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.includes(TEXT) && keys.some((k) => !k.startsWith(ATTRIBUTE) && k !== TEXT)) notices.add("xml-mixed", path);
  return makeObject(keys.map((k) => [k, normalize(object[k], notices, childPath(path, k))] as const));
}

export function readXml(text: string, notices: Notices): Value {
  const comments = /<!--[\s\S]*?-->/g;
  const cdata = /<!\[CDATA\[[\s\S]*?\]\]>/g;
  // document types can declare entities that expand without limit, so they are not accepted at all
  if (/<!(DOCTYPE|ENTITY)/i.test(text.replace(comments, "").replace(cdata, ""))) throw new CoreError("xml-doctype");

  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new CoreError("xml-syntax", { line: valid.err.line, column: valid.err.col, detail: valid.err.msg });

  let data: unknown;
  let ordered: Ordered;
  try {
    data = new XMLParser(OPTIONS).parse(text);
    ordered = new XMLParser({ ...OPTIONS, preserveOrder: true }).parse(text) as Ordered;
  } catch (e) {
    throw new CoreError("xml-syntax", { detail: e instanceof Error ? e.message : String(e) });
  }
  if (ordered.filter((node) => !(TEXT in node)).length !== 1) throw new CoreError("xml-syntax", { detail: "The document needs exactly one root element" });

  if (comments.test(text)) notices.add("comments-lost");
  if (cdata.test(text)) notices.add("xml-cdata");
  if (/<\?(?!xml[\s?])/i.test(text)) notices.add("xml-instructions");
  if (/>[ \t\r\n]+[^<\s]|[^>\s][ \t\r\n]+<\//.test(text.replace(comments, ""))) notices.add("xml-trimmed");
  if (interleaved(ordered)) notices.add("xml-order");
  notices.add("xml-text");
  return normalize(data, notices, "");
}

const NAME = /^[\p{L}_:][\p{L}\p{N}_.:·-]*$/u;
/** Characters XML 1.0 cannot hold, even escaped. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

/** Prepares a value for the builder: valid names, text values, and a notice for everything XML cannot keep. */
function element(v: Value, notices: Notices, path: string): unknown {
  const scalar = (s: Value): string => {
    if (s === null) {
      notices.add("xml-null", path);
      return "";
    }
    if (typeof s !== "string") notices.add("xml-types", path);
    const text = String(s);
    if (FORBIDDEN.test(text)) throw new CoreError("xml-value", { detail: `${path}: control characters cannot be written in XML` });
    return text;
  };
  if (v === null || typeof v !== "object") return scalar(v);
  if (Array.isArray(v)) throw new CoreError("xml-value", { detail: `${path}: a list directly inside a list cannot be written in XML` });

  return makeObject(
    Object.keys(v).flatMap((key) => {
      const child = v[key]!;
      const at = childPath(path, key);
      const attribute = key.startsWith(ATTRIBUTE);
      const name = attribute ? key.slice(ATTRIBUTE.length) : key;
      if (key !== TEXT && !NAME.test(name)) throw new CoreError("xml-name", { detail: `"${key}" is not a valid XML name` });
      if ((attribute || key === TEXT) && typeof child === "object" && child !== null) {
        throw new CoreError("xml-value", { detail: `${at}: attributes and text must be single values` });
      }
      if (Array.isArray(child)) {
        if (child.length === 0) {
          notices.add("xml-empty-array", at);
          return [];
        }
        if (child.length === 1) notices.add("xml-single-item", at);
        return [[key, child.map((item, i) => element(item, notices, childPath(at, i))) as Value] as const];
      }
      return [[key, element(child, notices, at) as Value] as const];
    })
  );
}

export function writeXml(value: Value, notices: Notices): string {
  let document = value;
  const keys = isObject(value) ? Object.keys(value) : [];
  const single = keys.length === 1 && !keys[0]!.startsWith(ATTRIBUTE) && keys[0] !== TEXT && !Array.isArray((value as Record<string, Value>)[keys[0]!]);
  if (!single) {
    // XML needs exactly one root element
    notices.add("xml-wrapped");
    document = makeObject([["root", Array.isArray(value) ? makeObject([["item", value]]) : value]]);
  }
  const prepared = element(document, notices, "");
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE,
    format: true,
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
  });
  return String(builder.build(prepared));
}
