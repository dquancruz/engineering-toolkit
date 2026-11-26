import YAML from "yaml";
import { CATEGORIES, CONSTRAINT_FIELDS, CONSTRAINT_KINDS, REQUIREMENT_FIELDS, REQUIREMENT_STATUSES, formatRegisterId } from "./model.js";
import { parseRegister } from "../docs/register.js";

export interface NewEntry {
  kind: "requirement" | "constraint";
  title: string;
  /** Field values as text, by field name. */
  fields: Record<string, string>;
}

export class RequirementsError extends Error {}

/** One line, and nothing that would open an HTML comment and hide the rest of the document. */
export const oneLine = (value: string) => value.replace(/\s+/g, " ").trim().replace(/<!--/g, "&lt;!--");

const ALLOWED = {
  requirement: ["title", ...REQUIREMENT_FIELDS],
  constraint: ["title", ...CONSTRAINT_FIELDS],
} as const;

function readEntry(kind: NewEntry["kind"], data: unknown, where: string): NewEntry {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new RequirementsError(`${where}: expected an object.`);
  const record = data as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !(ALLOWED[kind] as readonly string[]).includes(k));
  if (unknown.length > 0) throw new RequirementsError(`${where}: unknown key(s) ${unknown.join(", ")}. Valid keys: ${ALLOWED[kind].join(", ")}.`);

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    const list = (key === "source" || key === "origin") && Array.isArray(value);
    const scalar = (v: unknown) => typeof v === "string" || typeof v === "number";
    if (list ? !(value as unknown[]).every(scalar) : !scalar(value)) throw new RequirementsError(`${where}: "${key}" must be text.`);
    const text = oneLine(list ? (value as unknown[]).join(", ") : String(value));
    if (text !== "") fields[key] = text;
  }
  const { title = "", ...rest } = fields;
  if (title === "") throw new RequirementsError(`${where}: "title" is required.`);
  const choose = (key: string, values: readonly string[], required: boolean) => {
    const v = rest[key];
    if (v === undefined ? required : !values.includes(v)) throw new RequirementsError(`${where}: "${key}" must be one of ${values.join(", ")}.`);
  };
  if (kind === "requirement") {
    choose("category", CATEGORIES, true);
    choose("status", REQUIREMENT_STATUSES, false);
  } else {
    choose("kind", CONSTRAINT_KINDS, true);
  }
  return { kind, title, fields: rest };
}

/** The `--from` file: `requirements:` and `constraints:` lists (YAML or JSON). */
export function parseEntriesFile(content: string, source: string): NewEntry[] {
  let data: unknown;
  try {
    data = YAML.parse(content);
  } catch (e) {
    // the parser's message quotes the file, which may hold a secret
    const line = (e as { linePos?: { line: number }[] }).linePos?.[0]?.line;
    throw new RequirementsError(`${source}: could not be parsed${line ? ` (line ${line})` : ""}.`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new RequirementsError(`${source}: expected "requirements" and/or "constraints" lists.`);
  }
  const record = data as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => k !== "requirements" && k !== "constraints");
  if (unknown.length > 0) throw new RequirementsError(`${source}: unknown key(s) ${unknown.join(", ")}. Valid keys: requirements, constraints.`);

  return (["requirements", "constraints"] as const).flatMap((key) => {
    const list = record[key] ?? [];
    if (!Array.isArray(list)) throw new RequirementsError(`${source}: "${key}" must be a list.`);
    return list.map((item, i) => readEntry(key === "requirements" ? "requirement" : "constraint", item, `${source}: ${key}[${i + 1}]`));
  });
}

export interface Addition {
  /** The document with the new entries. */
  text: string;
  added: { id: string; entry: NewEntry; markdown: string }[];
  /** Same category (or kind) and title as an existing entry. */
  skipped: NewEntry[];
}

const group = (e: NewEntry) => (e.kind === "requirement" ? e.fields["category"] : e.fields["kind"]) ?? "";

/**
 * Appends entries to the requirements document without changing the existing ones. Requirements go before the
 * constraints section (marked `<!-- engkit:constraints -->`), constraints at the end.
 */
export function addEntries(document: string, entries: NewEntry[], defaults: { owner: string; date: string }): Addition {
  const eol = document.includes("\r\n") ? "\r\n" : "\n";
  let text = document.replace(/\r\n/g, "\n");
  const added: Addition["added"] = [];
  const skipped: NewEntry[] = [];

  for (const entry of entries) {
    const prefix = entry.kind === "requirement" ? "RNF" : "RES";
    const existing = parseRegister(text, prefix);
    const groupKey = entry.kind === "requirement" ? "category" : "kind";
    if (existing.some((e) => e.title.toLowerCase() === entry.title.toLowerCase() && e.fields[groupKey]?.value === group(entry))) {
      skipped.push(entry);
      continue;
    }
    const id = formatRegisterId(prefix, Math.max(0, ...existing.map((e) => Number(e.id.split("-")[1]))) + 1);
    const values: Record<string, string> = { owner: defaults.owner, date: defaults.date, ...entry.fields };
    if (entry.kind === "requirement") values["status"] ??= "draft";
    const order: readonly string[] = entry.kind === "requirement" ? REQUIREMENT_FIELDS : CONSTRAINT_FIELDS;
    const markdown = [`### ${id}: ${entry.title}`, "", ...order.filter((k) => values[k] !== undefined).map((k) => `- ${k}: ${values[k]}`), ""].join("\n");

    const marker = /^##[^#\n].*<!-- engkit:constraints -->[ \t]*$/m.exec(text);
    if (entry.kind === "requirement" && marker) {
      text = `${text.slice(0, marker.index).trimEnd()}\n\n${markdown}\n${text.slice(marker.index)}`;
    } else {
      text = `${text.trimEnd()}\n\n${markdown}`;
    }
    added.push({ id, entry, markdown });
  }
  return { text: text.replace(/\n/g, eol), added, skipped };
}
