import { loadChecklist, type Checklist } from "./checklist.js";
import type { Lang } from "../i18n/index.js";
import { applyPreset, isListElement, normalizeAnswers, ELEMENT_IDS, type PromptAnswers } from "./model.js";
import { loadProjectInfo, resolveToken, type ProjectInfo } from "./project.js";
import { renderPrompt } from "./render.js";
import { loadEnvSecrets, scanForSecrets, type SecretFinding } from "./secrets.js";
import { evaluate, type PromptWarning } from "./warnings.js";

export interface BuildOptions {
  lang: Lang;
  cwd: string;
  /** Look for values of `.env` files in the prompt (default true). */
  envScan?: boolean;
}

export interface BuiltPrompt {
  checklist: Checklist;
  /** The user's answers with the preset applied (tokens still unresolved: reusable with --from). */
  answers: PromptAnswers;
  /** Same, with `@adr:`, `@pending:` and `@claude` turned into reference lines. */
  resolved: PromptAnswers;
  markdown: string;
  warnings: PromptWarning[];
  secrets: SecretFinding[];
}

/** Shared by the interactive and non-interactive modes. Throws ProjectRefError for a bad `@` reference. */
export function buildPrompt(input: PromptAnswers, options: BuildOptions, info?: ProjectInfo | null): BuiltPrompt {
  const checklist = loadChecklist(options.lang);
  const project = info === undefined ? loadProjectInfo(options.cwd) : info;

  const answers = input.preset ? applyPreset(input, checklist.presets[input.preset]) : normalizeAnswers(input);

  const resolved: PromptAnswers = { ...answers };
  for (const id of ELEMENT_IDS) {
    if (isListElement(id) && answers[id]) {
      resolved[id] = [...new Set(answers[id]!.map((item) => resolveToken(item, project, checklist, options.cwd)))];
    }
  }

  const env = options.envScan === false ? [] : loadEnvSecrets(options.cwd);
  return {
    checklist,
    answers,
    resolved,
    markdown: renderPrompt(resolved, checklist),
    warnings: evaluate(resolved, checklist),
    secrets: scanForSecrets(resolved, env),
  };
}
