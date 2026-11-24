import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../docs/frontmatter.js";
import { checklistsRoot, type Lang } from "../i18n/index.js";
import { ELEMENT_IDS, PRESET_IDS, isElementId, isPresetId, type ElementId, type PresetId } from "./model.js";

export class ChecklistError extends Error {}

export interface ChecklistElement {
  id: ElementId;
  title: string;
  question: string;
  example: string;
  /** Wording that makes the element vague (from the checklist). */
  weak: string[];
  /** Wording that shows a result can be checked (from the checklist). */
  checkable: string[];
  checks: string[];
}

export interface ChecklistPreset {
  id: PresetId;
  title: string;
  limits: string[];
  verify: string[];
}

export interface Checklist {
  lang: Lang;
  strings: { promptTitle: string; claudeLimit: string };
  elements: Record<ElementId, ChecklistElement>;
  presets: Record<PresetId, ChecklistPreset>;
}

const COMMENT = /\s*<!--\s*([\w-]+)\s*(?::\s*([\w-]+))?\s*-->\s*$/;

function signals(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter((s) => s !== "");
}

function stringMap(value: unknown, name: string): Record<string, string> {
  if (typeof value !== "object" || value === null) throw new ChecklistError(`Checklist frontmatter is missing "${name}".`);
  return value as Record<string, string>;
}

/** Parses the Markdown of a checklist. See checklists/README.md for the format. */
export function parseChecklist(text: string, lang: Lang): Checklist {
  const fm = parseFrontmatter(text);
  if (!fm) throw new ChecklistError("The checklist has no valid frontmatter.");
  const labels = stringMap(fm.data["labels"], "labels");
  const strings = stringMap(fm.data["strings"], "strings");
  for (const key of ["question", "example", "weak", "checkable"]) {
    if (!labels[key]) throw new ChecklistError(`Checklist frontmatter is missing labels.${key}.`);
  }
  for (const key of ["prompt_title", "claude_limit"]) {
    if (!strings[key]) throw new ChecklistError(`Checklist frontmatter is missing strings.${key}.`);
  }

  const labelLine = (line: string, key: string): string | null => {
    const prefix = `**${labels[key]}:**`;
    return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null;
  };

  const elements = new Map<ElementId, ChecklistElement>();
  const presets = new Map<PresetId, ChecklistPreset>();

  type Cursor =
    | { kind: "element"; el: ChecklistElement }
    | { kind: "preset"; preset: ChecklistPreset; list: "limits" | "verify" | null }
    | null;
  let cur: Cursor = null;
  let inPresets = false;

  for (const raw of fm.body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const comment = COMMENT.exec(heading[2]!);
      const title = heading[2]!.replace(COMMENT, "").replace(/^\d+\.\s*/, "").trim();
      if (level === 2) {
        inPresets = false;
        cur = null;
        if (comment?.[1] === "element") {
          const id = comment[2];
          if (!isElementId(id)) throw new ChecklistError(`Unknown element "${id}" in the checklist.`);
          if (elements.has(id)) throw new ChecklistError(`Element "${id}" is defined twice.`);
          const el: ChecklistElement = { id, title, question: "", example: "", weak: [], checkable: [], checks: [] };
          elements.set(id, el);
          cur = { kind: "element", el };
        } else if (!comment && /^presets?$/i.test(title)) {
          inPresets = true;
        }
      } else if (level === 3 && inPresets) {
        if (comment?.[1] !== "preset" || !isPresetId(comment[2])) {
          throw new ChecklistError(`Preset heading "${title}" needs a <!-- preset: id --> comment with a known id.`);
        }
        const preset: ChecklistPreset = { id: comment[2], title, limits: [], verify: [] };
        presets.set(preset.id, preset);
        cur = { kind: "preset", preset, list: null };
      } else if (level === 4 && cur?.kind === "preset") {
        const id = comment?.[1];
        if (id !== "limits" && id !== "verify") {
          throw new ChecklistError(`Preset "${cur.preset.id}": sub-section "${title}" must be <!-- limits --> or <!-- verify -->.`);
        }
        cur.list = id;
      }
      continue;
    }

    if (cur?.kind === "element") {
      const el = cur.el;
      const q = labelLine(line, "question");
      const ex = labelLine(line, "example");
      const weak = labelLine(line, "weak");
      const ok = labelLine(line, "checkable");
      if (q !== null) el.question = q;
      else if (ex !== null) el.example = ex;
      else if (weak !== null) el.weak = signals(weak);
      else if (ok !== null) el.checkable = signals(ok);
      else {
        const task = /^- \[ \]\s+(.*)$/.exec(line);
        if (task) el.checks.push(task[1]!.trim());
      }
    } else if (cur?.kind === "preset" && cur.list) {
      const item = /^[-*]\s+(.*)$/.exec(line);
      if (item) cur.preset[cur.list].push(item[1]!.trim());
    }
  }

  for (const id of ELEMENT_IDS) {
    const el = elements.get(id);
    if (!el) throw new ChecklistError(`The checklist is missing the element "${id}".`);
    if (!el.question) throw new ChecklistError(`Element "${id}" has no "${labels["question"]}" line.`);
    if (!el.example) throw new ChecklistError(`Element "${id}" has no "${labels["example"]}" line.`);
  }
  for (const id of PRESET_IDS) {
    if (!presets.has(id)) throw new ChecklistError(`The checklist is missing the preset "${id}".`);
  }

  return {
    lang,
    strings: { promptTitle: strings["prompt_title"]!, claudeLimit: strings["claude_limit"]! },
    elements: Object.fromEntries(ELEMENT_IDS.map((id) => [id, elements.get(id)!])) as Record<ElementId, ChecklistElement>,
    presets: Object.fromEntries(PRESET_IDS.map((id) => [id, presets.get(id)!])) as Record<PresetId, ChecklistPreset>,
  };
}

/** Loads `checklists/<lang>/ai-prompt.md`, the single source for questions, signals and presets. */
export function loadChecklist(lang: Lang): Checklist {
  const file = path.join(checklistsRoot(), lang, "ai-prompt.md");
  return parseChecklist(readFileSync(file, "utf-8"), lang);
}
