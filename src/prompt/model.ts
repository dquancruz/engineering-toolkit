/** The eight elements of a prompt, in the order they are asked and printed. */
export const ELEMENT_IDS = ["goal", "context", "material", "limits", "autonomy", "done", "verify", "response"] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

export const PRESET_IDS = ["research", "feature", "bugfix", "refactor", "review"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Checklist the guided mode offers for each preset (never added without asking). */
export const SUGGESTED_CHECKLIST: Record<PresetId, "code-review" | "definition-of-done" | null> = {
  research: null,
  feature: "definition-of-done",
  bugfix: "definition-of-done",
  refactor: "definition-of-done",
  review: "code-review",
};

/** Elements whose value is a list of items; the others are free text. */
export const LIST_ELEMENTS = ["material", "limits", "verify"] as const;
export type ListElementId = (typeof LIST_ELEMENTS)[number];
export type TextElementId = Exclude<ElementId, ListElementId>;

export const isListElement = (id: ElementId): id is ListElementId => (LIST_ELEMENTS as readonly string[]).includes(id);
export const isElementId = (v: unknown): v is ElementId => typeof v === "string" && (ELEMENT_IDS as readonly string[]).includes(v);
export const isPresetId = (v: unknown): v is PresetId => typeof v === "string" && (PRESET_IDS as readonly string[]).includes(v);

/** What the user provides (also the shape of the answers file). Lists may contain `@adr:`, `@pending:` and `@claude` tokens. */
export interface PromptAnswers {
  preset?: PresetId;
  goal?: string;
  context?: string;
  material?: string[];
  limits?: string[];
  autonomy?: string;
  done?: string;
  verify?: string[];
  response?: string;
}

export const ANSWER_KEYS = ["preset", ...ELEMENT_IDS] as const;

const clean = (s: string) => s.trim();

/** Trims text, drops empty items and removes duplicates, keeping order. */
export function normalizeAnswers(a: PromptAnswers): PromptAnswers {
  const out: PromptAnswers = {};
  if (a.preset) out.preset = a.preset;
  for (const id of ELEMENT_IDS) {
    if (isListElement(id)) {
      const items = [...new Set((a[id] ?? []).map(clean).filter((x) => x !== ""))];
      if (items.length > 0) out[id] = items;
    } else {
      const text = clean(a[id] ?? "");
      if (text !== "") out[id] = text;
    }
  }
  return out;
}

/** Adds the preset's typical limits and verification before the user's own (without duplicates). */
export function applyPreset(a: PromptAnswers, preset: { limits: string[]; verify: string[] }): PromptAnswers {
  return normalizeAnswers({
    ...a,
    limits: [...preset.limits, ...(a.limits ?? [])],
    verify: [...preset.verify, ...(a.verify ?? [])],
  });
}

/** Puts checklist items before the user's own; with `applyPreset` afterwards the preset stays first. */
export function addPromptItems(a: PromptAnswers, items: { limits: string[]; verify: string[] }[]): PromptAnswers {
  if (items.length === 0) return a;
  return {
    ...a,
    limits: [...items.flatMap((i) => i.limits), ...(a.limits ?? [])],
    verify: [...items.flatMap((i) => i.verify), ...(a.verify ?? [])],
  };
}

/** Text of an element as a list of lines (list items are one line each). */
export function elementLines(a: PromptAnswers, id: ElementId): string[] {
  const v = a[id];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : v.split("\n");
}

export function isEmpty(a: PromptAnswers, id: ElementId): boolean {
  return elementLines(a, id).every((l) => l.trim() === "");
}
