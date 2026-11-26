import fs from "node:fs";
import path from "node:path";
import type { LegacyPaths } from "../config.js";
import { extractTitle } from "../docs/adr.js";
import { parseFrontmatter, type ParsedDoc } from "../docs/frontmatter.js";
import { DIR_KEY, ITEM_KINDS, itemFilePattern, type ItemKind } from "./model.js";

export interface LegacyItem {
  kind: ItemKind;
  /** The ID of the file name; `check` verifies that the frontmatter agrees. */
  id: string;
  /** Project-relative path with "/" separators. */
  file: string;
  text: string;
  fm: ParsedDoc | null;
  title: string;
}

export interface Legacy {
  paths: LegacyPaths;
  /** Sorted by file name. */
  items: Record<ItemKind, LegacyItem[]>;
  /** Markdown files in the item folders whose name does not follow `<ID>-slug.md`. */
  unexpected: string[];
}

export function loadLegacy(cwd: string, paths: LegacyPaths): Legacy {
  const legacy: Legacy = { paths, items: { rule: [], test: [], defect: [] }, unexpected: [] };

  for (const kind of ITEM_KINDS) {
    const dir = paths[DIR_KEY[kind]];
    const abs = path.join(cwd, dir);
    // an empty folder is not kept by git, so a missing one just means "no items yet"
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      if (!name.endsWith(".md") || name.toLowerCase() === "readme.md") continue;
      const file = path.posix.join(dir, name);
      const m = itemFilePattern(kind).exec(name);
      if (!m) {
        legacy.unexpected.push(file);
        continue;
      }
      const text = fs.readFileSync(path.join(cwd, file), "utf-8");
      const fm = parseFrontmatter(text);
      const title = fm ? extractTitle(fm.body).replace(/^(RN|PA|D)-\d+\s*[:\-–]\s*/i, "") : "";
      legacy.items[kind].push({ kind, id: m[1]!, file, text, fm, title });
    }
  }

  return legacy;
}

/** A list field of the frontmatter: a scalar counts as a list of one. `null` when the type is wrong. */
export function listField(item: Pick<LegacyItem, "fm">, key: string): string[] | null {
  const value = item.fm?.data[key];
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  return list.every((v) => typeof v === "string") ? list.map((v) => (v as string).trim()).filter((v) => v !== "") : null;
}

export interface EvidenceEntry {
  /** `<root>:<path>:<start>[-<end>]`, for code. */
  ref?: string;
  /** `F-xx`, for evidence that is not code. */
  source?: string;
  hash?: unknown;
}

/** The `evidence` list of a rule or a defect. `null` when it is not a list of `ref` / `source` entries. */
export function evidenceOf(item: LegacyItem): EvidenceEntry[] | null {
  const value = item.fm?.data["evidence"];
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) return null;
  const ok = value.every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const { ref, source } = e as Record<string, unknown>;
    return (typeof ref === "string") !== (typeof source === "string");
  });
  return ok ? (value as EvidenceEntry[]) : null;
}
