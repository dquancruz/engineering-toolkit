import { checklistPromptItems, loadGenericChecklist, type PromptItems } from "../checklists/generic.js";
import type { Lang } from "../i18n/index.js";
import type { Asker, Choice } from "./asker.js";
import { buildPrompt, type BuiltPrompt } from "./build.js";
import type { Checklist } from "./checklist.js";
import {
  ELEMENT_IDS,
  PRESET_IDS,
  SUGGESTED_CHECKLIST,
  addPromptItems,
  isListElement,
  normalizeAnswers,
  type ElementId,
  type PresetId,
  type PromptAnswers,
} from "./model.js";
import { CLAUDE_TOKEN, adrLine, adrToken, pendingLine, pendingToken, type ProjectInfo } from "./project.js";

export class SecretsBlocked extends Error {}

export interface InteractiveContext {
  lang: Lang;
  cwd: string;
  checklist: Checklist;
  info: ProjectInfo | null;
  envScan: boolean;
  allowSecrets: boolean;
  /** Prompt items of the checklists given with `--checklist`, pre-filled like a preset. */
  extra?: PromptItems[];
  /** The `--checklist` values, so the same checklist is not offered again. */
  requested?: string[];
}

const isToken = (item: string) => item.startsWith("@");
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

function hint(ctx: InteractiveContext, id: ElementId): string {
  const el = ctx.checklist.elements[id];
  const checks = el.checks.map((c) => `  [ ] ${c}`).join("\n");
  return `${el.question}\nExample: ${el.example}${checks ? `\n\n${checks}` : ""}`;
}

/** Asks (or re-asks) one element, starting from what the answers already hold. */
async function askElement(asker: Asker, ctx: InteractiveContext, id: ElementId, answers: PromptAnswers): Promise<void> {
  const el = ctx.checklist.elements[id];
  asker.note(hint(ctx, id), el.title);

  if (!isListElement(id)) {
    const value = await asker.text({
      message: el.title,
      placeholder: el.example,
      initialValue: (answers[id] as string | undefined) ?? "",
      multiline: id !== "goal",
    });
    if (value.trim() === "") delete answers[id];
    else (answers as Record<string, unknown>)[id] = value;
    return;
  }

  const current = (answers[id] as string[] | undefined) ?? [];
  const tokens = current.filter(isToken);
  const free = current.filter((i) => !isToken(i));
  const picked: string[] = [];

  if (id === "material" && ctx.info && (ctx.info.adrs.length > 0 || ctx.info.pendings.length > 0)) {
    const options: Choice<string>[] = [
      ...ctx.info.adrs.map((a) => ({ value: adrToken(a.id), label: adrLine(a) })),
      ...ctx.info.pendings.map((p) => ({ value: pendingToken(p.id), label: pendingLine(p), hint: "open" })),
    ];
    picked.push(
      ...(await asker.multiselect({
        message: "Project documents to point to (accepted ADRs and open pending items; only their path is added)",
        options,
        initialValues: tokens.filter((t) => options.some((o) => o.value === t)),
      }))
    );
  }

  if (id === "limits" && ctx.info?.claude) {
    const { file, rules } = ctx.info.claude;
    if (rules === 0) asker.note(`${file} has no rules yet (only TODO placeholders), so there is little to point to.`, "CLAUDE.md");
    const include = await asker.confirm({
      message: `Add "follow the rules in ${file}" as a limit? (${rules} rule${rules === 1 ? "" : "s"} found)`,
      initialValue: tokens.includes(CLAUDE_TOKEN) || (current.length === 0 && rules > 0),
    });
    if (include) picked.push(CLAUDE_TOKEN);
  }

  const extra = await asker.text({
    message: id === "material" ? "Other files or links (one per line; leave empty to skip)" : `${el.title} (one per line; leave empty to skip)`,
    placeholder: el.example,
    initialValue: free.join("\n"),
    multiline: true,
  });
  const items = [...picked, ...lines(extra)];
  if (items.length === 0) delete answers[id];
  else (answers as Record<string, unknown>)[id] = items;
}

/** At most this many review rounds, so the guided mode always ends. */
const MAX_REVIEW_ROUNDS = 10;

/** Loops until nothing is left to fix or the user declines. Throws SecretsBlocked if a secret is kept. */
async function review(asker: Asker, ctx: InteractiveContext, answers: PromptAnswers): Promise<BuiltPrompt> {
  for (let round = 0; ; round++) {
    const built = buildPrompt(answers, { lang: ctx.lang, cwd: ctx.cwd, envScan: ctx.envScan }, ctx.info);

    if (round >= MAX_REVIEW_ROUNDS) {
      if (built.secrets.length > 0 && !ctx.allowSecrets) throw new SecretsBlocked();
      return built;
    }

    if (built.secrets.length > 0 && !ctx.allowSecrets) {
      asker.note(built.secrets.map((s) => `${s.element}:${s.line}  ${s.kind}  ${s.excerpt}`).join("\n"), "Possible secrets (blocked)");
      const flagged = [...new Set(built.secrets.map((s) => s.element))];
      if (!(await asker.confirm({ message: "Edit the flagged elements?", initialValue: true }))) throw new SecretsBlocked();
      const chosen = await asker.multiselect<ElementId>({
        message: "Which ones?",
        options: flagged.map((id) => ({ value: id, label: ctx.checklist.elements[id].title })),
        initialValues: flagged,
      });
      for (const id of chosen) await askElement(asker, ctx, id, answers);
      continue;
    }

    if (built.warnings.length === 0) return built;
    asker.note(built.warnings.map((w) => `- ${w.message}`).join("\n"), "Warnings");
    if (!(await asker.confirm({ message: "Edit the elements with warnings?", initialValue: true }))) return built;
    const flagged = [...new Set(built.warnings.map((w) => w.element))];
    const chosen = await asker.multiselect<ElementId>({
      message: "Which ones?",
      options: flagged.map((id) => ({ value: id, label: ctx.checklist.elements[id].title })),
      initialValues: flagged,
    });
    if (chosen.length === 0) return built;
    for (const id of chosen) await askElement(asker, ctx, id, answers);
  }
}

/** Offers the checklist that fits the preset (default: no). Returns its prompt items when accepted. */
async function offerChecklist(asker: Asker, ctx: InteractiveContext, preset: PresetId): Promise<PromptItems | null> {
  const id = SUGGESTED_CHECKLIST[preset];
  if (id === null || ctx.requested?.some((spec) => spec.split(":")[0] === id)) return null;
  const checklist = loadGenericChecklist(id, ctx.lang);
  const add = await asker.confirm({ message: `Also add the limits and verification of "${checklist.title}"?`, initialValue: false });
  if (!add) return null;
  if (checklist.variants.length === 0) return checklistPromptItems(id, ctx.lang);
  const variant = await asker.select<string>({
    message: "What kind of change is it?",
    options: [{ value: "none", label: "Only the common items" }, ...checklist.variants.map((v) => ({ value: v.id, label: v.title }))],
    initialValue: "none",
  });
  return checklistPromptItems(variant === "none" ? id : `${id}:${variant}`, ctx.lang);
}

/**
 * Guided mode: preset, then each element with its question, example and checks, then a review of
 * the warnings. The preset's limits and verification are pre-filled and editable, so the returned
 * answers no longer carry a `preset`.
 */
export async function runInteractive(asker: Asker, ctx: InteractiveContext): Promise<{ answers: PromptAnswers; built: BuiltPrompt }> {
  asker.intro("engkit prompt");
  asker.note("Answer each element. In multi-line fields press Enter twice to submit; Ctrl+C cancels.\nThe prompt is printed to stdout at the end.", "How it works");

  const preset = await asker.select<PresetId | "none">({
    message: "What kind of task is it?",
    options: [
      { value: "none", label: "No preset" },
      ...PRESET_IDS.map((id) => ({ value: id, label: ctx.checklist.presets[id].title })),
    ],
    initialValue: "none",
  });

  const items = [...(ctx.extra ?? [])];
  if (preset !== "none") {
    const offered = await offerChecklist(asker, ctx, preset);
    if (offered) items.push(offered);
  }
  let answers: PromptAnswers = addPromptItems({}, items);
  if (preset !== "none") answers = addPromptItems(answers, [ctx.checklist.presets[preset]]);

  for (const id of ELEMENT_IDS) await askElement(asker, ctx, id, answers);

  const built = await review(asker, ctx, answers);
  return { answers: normalizeAnswers(answers), built };
}
