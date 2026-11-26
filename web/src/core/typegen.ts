import type { JsonNode } from "./json.js";
import { losesPrecision } from "./value.js";
import type { Notices } from "./notice.js";

/** The union of everything seen at one place of the sample. */
interface Shape {
  scalars: Set<"string" | "number" | "boolean" | "null">;
  object?: { seen: number; fields: Map<string, { shape: Shape; seen: number }> };
  array?: { item: Shape };
}

const empty = (): Shape => ({ scalars: new Set() });

function absorb(shape: Shape, node: JsonNode, notices: Notices): void {
  switch (node.type) {
    case "string":
      shape.scalars.add("string");
      break;
    case "number":
      if (losesPrecision(node.raw)) notices.add("number-precision", node.raw);
      shape.scalars.add("number");
      break;
    case "literal":
      shape.scalars.add(node.raw === "null" ? "null" : "boolean");
      break;
    case "array":
      shape.array ??= { item: empty() };
      for (const item of node.items) absorb(shape.array.item, item, notices);
      break;
    case "object": {
      shape.object ??= { seen: 0, fields: new Map() };
      shape.object.seen++;
      const last = new Map(node.entries.map((e) => [e.key, e.value]));
      for (const [key, value] of last) {
        let field = shape.object.fields.get(key);
        if (!field) shape.object.fields.set(key, (field = { shape: empty(), seen: 0 }));
        field.seen++;
        absorb(field.shape, value, notices);
      }
    }
  }
}

export function inferShape(node: JsonNode, notices: Notices): Shape {
  const shape = empty();
  absorb(shape, node, notices);
  return shape;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** Names that would shadow a global type or break the generated code. */
const RESERVED = ["Array", "Boolean", "Date", "Error", "Function", "Map", "Number", "Object", "Partial", "Promise", "Record", "Set", "String", "Symbol", "Z"];

function typeName(words: string): string {
  const name = words
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
  return name === "" ? "Item" : /^\d/.test(name) ? `T${name}` : name;
}

const singular = (key: string) => (/ies$/i.test(key) ? key.replace(/ies$/i, "y") : /[^s]s$/i.test(key) ? key.slice(0, -1) : `${key} item`);

interface Emitter {
  scalar: (s: "string" | "number" | "boolean" | "null") => string;
  array: (item: string, isUnion: boolean) => string;
  union: (parts: string[], nullable: boolean) => string;
  unknown: string;
  reference: (name: string) => string;
  declare: (name: string, fields: { key: string; type: string; optional: boolean }[]) => string;
  alias: (name: string, type: string) => string;
  suffix: string;
}

function generate(node: JsonNode, notices: Notices, emitter: Emitter): string {
  const declarations: string[] = [];
  const used = new Set<string>(RESERVED);
  const unique = (base: string) => {
    let name = base;
    for (let n = 2; used.has(name) || used.has(`${name}${emitter.suffix}`); n++) name = `${base}${n}`;
    used.add(name);
    used.add(`${name}${emitter.suffix}`);
    return name;
  };

  const type = (shape: Shape, hint: string, name?: string): string => {
    const parts: string[] = [];
    if (shape.object) {
      const own = name ?? unique(typeName(hint));
      const fields = [...shape.object.fields].map(([key, f]) => ({
        key,
        type: type(f.shape, key),
        optional: f.seen < shape.object!.seen,
      }));
      declarations.push(emitter.declare(own, fields));
      parts.push(emitter.reference(own));
    }
    if (shape.array) {
      const item = shape.array.item;
      const kinds = item.scalars.size + (item.object ? 1 : 0) + (item.array ? 1 : 0);
      parts.push(emitter.array(type(item, singular(hint)), kinds > 1));
    }
    for (const s of ["string", "number", "boolean"] as const) if (shape.scalars.has(s)) parts.push(emitter.scalar(s));
    const nullable = shape.scalars.has("null");
    if (parts.length === 0) return nullable ? emitter.scalar("null") : emitter.unknown;
    return emitter.union(parts, nullable);
  };

  const shape = inferShape(node, notices);
  const onlyObject = shape.object && !shape.array && shape.scalars.size === 0;
  const root = unique("Root");
  const result = type(shape, "Root", onlyObject ? root : undefined);
  if (!onlyObject) declarations.push(emitter.alias(root, result));
  return declarations.join("\n\n") + "\n";
}

const propertyName = (key: string) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

export function toTypeScript(node: JsonNode, notices: Notices): string {
  return generate(node, notices, {
    suffix: "",
    scalar: (s) => s,
    array: (item, isUnion) => (isUnion ? `(${item})[]` : `${item}[]`),
    union: (parts, nullable) => [...parts, ...(nullable ? ["null"] : [])].join(" | "),
    unknown: "unknown",
    reference: (name) => name,
    declare: (name, fields) =>
      fields.length === 0
        ? `export type ${name} = Record<string, never>;`
        : `export interface ${name} {\n${fields.map((f) => `  ${propertyName(f.key)}${f.optional ? "?" : ""}: ${f.type};`).join("\n")}\n}`,
    alias: (name, type) => `export type ${name} = ${type};`,
  });
}

/** Zod 4 schemas, declared before they are used. */
export function toZod(node: JsonNode, notices: Notices): string {
  const body = generate(node, notices, {
    suffix: "Schema",
    scalar: (s) => `z.${s}()`,
    array: (item) => `z.array(${item})`,
    union: (parts, nullable) => `${parts.length === 1 ? parts[0] : `z.union([${parts.join(", ")}])`}${nullable ? ".nullable()" : ""}`,
    unknown: "z.unknown()",
    reference: (name) => `${name}Schema`,
    // `"__proto__": x` in an object literal would set the prototype, so that key is written as computed
    declare: (name, fields) => {
      const lines = fields.map((f) => `  ${f.key === "__proto__" ? '["__proto__"]' : propertyName(f.key)}: ${f.type}${f.optional ? ".optional()" : ""},`);
      const object = fields.length === 0 ? "z.object({})" : `z.object({\n${lines.join("\n")}\n})`;
      return `export const ${name}Schema = ${object};\nexport type ${name} = z.infer<typeof ${name}Schema>;`;
    },
    alias: (name, type) => `export const ${name}Schema = ${type};\nexport type ${name} = z.infer<typeof ${name}Schema>;`,
  });
  return `import { z } from "zod";\n\n${body}`;
}
