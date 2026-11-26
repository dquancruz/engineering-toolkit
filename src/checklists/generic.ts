import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../docs/frontmatter.js";
import { checklistsRoot, type Lang } from "../i18n/index.js";

/** The checklists besides `ai-prompt.md`. */
export const CHECKLIST_IDS = ["code-review", "definition-of-done", "system-design", "threat-model"] as const;
export type ChecklistId = (typeof CHECKLIST_IDS)[number];

export const isChecklistId = (v: string): v is ChecklistId => (CHECKLIST_IDS as readonly string[]).includes(v);

export interface PromptItems {
  limits: string[];
  verify: string[];
}

export interface Section {
  id: string;
  title: string;
  checks: string[];
}

export interface Variant extends PromptItems {
  id: string;
  title: string;
}

export interface GenericChecklist {
  id: string;
  title: string;
  sections: Section[];
  /** What a prompt gets from this checklist. */
  prompt: PromptItems;
  /** Extra prompt items for one kind of work (for example the PR type of a code review). */
  variants: Variant[];
}

export class GenericChecklistError extends Error {}

const COMMENT = /\s*<!--\s*([\w-]+)\s*(?::\s*([\w-]+))?\s*-->\s*$/;

/** Parses the Markdown of a checklist. See checklists/README.md for the format. */
export function parseGenericChecklist(text: string): GenericChecklist {
  const fm = parseFrontmatter(text);
  const id = fm?.data["id"];
  if (!fm || typeof id !== "string") throw new GenericChecklistError("The checklist has no frontmatter with an id.");
  const fail = (message: string): never => {
    throw new GenericChecklistError(`Checklist "${id}": ${message}`);
  };

  const out: GenericChecklist = { id, title: "", sections: [], prompt: { limits: [], verify: [] }, variants: [] };
  let section: Section | null = null;
  let inPrompt = false;
  let target: PromptItems = out.prompt;
  let list: keyof PromptItems | null = null;

  for (const raw of fm.body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const comment = COMMENT.exec(heading[2]!);
      const kind = comment?.[1];
      const ref = comment?.[2];
      const title = heading[2]!.replace(COMMENT, "").trim();
      list = null;
      if (level === 1) out.title = title;
      else if (level === 2) {
        section = null;
        inPrompt = kind === "prompt";
        target = out.prompt;
        if (kind === "section" && ref) {
          if (out.sections.some((s) => s.id === ref)) fail(`section "${ref}" is defined twice.`);
          section = { id: ref, title, checks: [] };
          out.sections.push(section);
        } else if (!inPrompt) fail(`heading "${title}" needs <!-- section: id --> or <!-- prompt -->.`);
      } else if (inPrompt && (kind === "limits" || kind === "verify")) {
        if (level === 3) target = out.prompt;
        list = kind;
      } else if (inPrompt && level === 3 && kind === "variant" && ref) {
        if (out.variants.some((v) => v.id === ref)) fail(`variant "${ref}" is defined twice.`);
        const variant: Variant = { id: ref, title, limits: [], verify: [] };
        out.variants.push(variant);
        target = variant;
      } else fail(`unexpected heading "${title}".`);
      continue;
    }
    if (section) {
      const task = /^- \[ \]\s+(.*)$/.exec(line);
      if (task) section.checks.push(task[1]!.trim());
    } else if (list) {
      const item = /^[-*]\s+(.*)$/.exec(line);
      if (item) target[list].push(item[1]!.trim());
    }
  }

  if (out.sections.length === 0) fail("it has no sections.");
  const empty = out.sections.find((s) => s.checks.length === 0);
  if (empty) fail(`section "${empty.id}" has no "- [ ]" items.`);
  if (out.prompt.limits.length === 0 || out.prompt.verify.length === 0) fail("the prompt block needs limits and verification.");
  return out;
}

export function loadGenericChecklist(id: ChecklistId, lang: Lang): GenericChecklist {
  return parseGenericChecklist(readFileSync(path.join(checklistsRoot(), lang, `${id}.md`), "utf-8"));
}

/** Prompt items of `<id>` or `<id>:<variant>` (the checklist's own items first). */
export function checklistPromptItems(spec: string, lang: Lang): PromptItems {
  const [id = "", variantId, ...rest] = spec.split(":");
  if (!isChecklistId(id) || rest.length > 0) {
    throw new GenericChecklistError(`Unknown checklist "${spec}". Use one of: ${CHECKLIST_IDS.join(", ")} (or <id>:<variant>).`);
  }
  const checklist = loadGenericChecklist(id, lang);
  if (variantId === undefined) return checklist.prompt;
  const variant = checklist.variants.find((v) => v.id === variantId);
  if (!variant) {
    const valid = checklist.variants.map((v) => v.id).join(", ");
    throw new GenericChecklistError(`"${id}" has no variant "${variantId}".${valid ? ` Use one of: ${valid}.` : " It has no variants."}`);
  }
  return { limits: [...checklist.prompt.limits, ...variant.limits], verify: [...checklist.prompt.verify, ...variant.verify] };
}
