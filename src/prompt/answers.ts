import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ANSWER_KEYS, isListElement, isPresetId, normalizeAnswers, type ElementId, type PromptAnswers } from "./model.js";

export class AnswersError extends Error {}

const asList = (key: string, value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  throw new AnswersError(`"${key}" must be text or a list of text.`);
};

/** Validates a parsed answers object (from YAML/JSON). Unknown keys and wrong types are errors. */
export function validateAnswers(data: unknown, source: string): PromptAnswers {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AnswersError(`${source}: expected an object with the prompt elements.`);
  }
  const unknown = Object.keys(data).filter((k) => !(ANSWER_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new AnswersError(`${source}: unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")}. Valid keys: ${ANSWER_KEYS.join(", ")}.`);
  }

  const record = data as Record<string, unknown>;
  const out: PromptAnswers = {};
  for (const key of ANSWER_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (key === "preset") {
      if (!isPresetId(value)) throw new AnswersError(`${source}: "preset" must be one of research, feature, bugfix, refactor, review.`);
      out.preset = value;
    } else if (isListElement(key)) {
      try {
        out[key] = asList(key, value);
      } catch (e) {
        throw new AnswersError(`${source}: ${(e as Error).message}`);
      }
    } else {
      if (typeof value !== "string") throw new AnswersError(`${source}: "${key}" must be text.`);
      out[key as Exclude<ElementId, "material" | "limits" | "verify">] = value;
    }
  }
  return normalizeAnswers(out);
}

/** Reads an answers file: `.json` as JSON, anything else as YAML (which also accepts JSON). */
export function readAnswersFile(file: string): PromptAnswers {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    throw new AnswersError(`File not found: ${file}`);
  }
  try {
    const data: unknown = path.extname(file).toLowerCase() === ".json" ? JSON.parse(text) : YAML.parse(text);
    return validateAnswers(data, file);
  } catch (e) {
    if (e instanceof AnswersError) throw e;
    throw new AnswersError(`${file}: could not be parsed (${e instanceof Error ? e.message : String(e)}).`);
  }
}

/** YAML for `--save`, reusable with `--from`. */
export function serializeAnswers(a: PromptAnswers): string {
  return YAML.stringify(normalizeAnswers(a), { lineWidth: 0 });
}

/** Flags win over the file, element by element. Lists are replaced, not merged. */
export function mergeAnswers(base: PromptAnswers, override: PromptAnswers): PromptAnswers {
  return normalizeAnswers({ ...base, ...override });
}
