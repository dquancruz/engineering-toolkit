import { GenericChecklistError, checklistPromptItems } from "../checklists/generic.js";
import type { Lang } from "../i18n/index.js";
import { AnswersError, mergeAnswers, readAnswersFile } from "../prompt/answers.js";
import { PromptCancelled, clackAsker, type Asker } from "../prompt/asker.js";
import { buildPrompt, type BuiltPrompt } from "../prompt/build.js";
import { ChecklistError, loadChecklist } from "../prompt/checklist.js";
import { SecretsBlocked, runInteractive } from "../prompt/interactive.js";
import { addPromptItems, type PresetId, type PromptAnswers } from "../prompt/model.js";
import { ProjectRefError, loadProjectInfo } from "../prompt/project.js";
import { savePrompt } from "../prompt/save.js";

export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_USAGE = 2;
export const EXIT_CANCELLED = 130;

export interface PromptCommandOptions {
  from?: string;
  preset?: PresetId;
  goal?: string;
  context?: string;
  material?: string[];
  limit?: string[];
  autonomy?: string;
  done?: string;
  verify?: string[];
  response?: string;
  /** `<id>` or `<id>:<variant>`: adds the prompt block of those checklists to limits and verification. */
  checklist?: string[];
  /** `true` for `--save`, or the name given to `--save <name>`. */
  save?: string | boolean;
  /** Add the prompts folder to .gitignore (default true; `--no-gitignore` sets false). */
  gitignore?: boolean;
  allowSecrets?: boolean;
  /** Look for `.env` values in the prompt (default true; `--no-env-scan` sets false). */
  envScan?: boolean;
  /** Exit 1 when there are warnings about empty or weak elements. */
  strict?: boolean;
}

export interface PromptDeps {
  cwd?: string;
  /** Interactive UI; defaults to @clack/prompts on stderr. Tests inject a fake. */
  asker?: Asker;
  /** Whether a terminal is available for the guided mode. */
  isTTY?: boolean;
  out?: (text: string) => void;
  err?: (text: string) => void;
  today?: string;
}

function fromFlags(o: PromptCommandOptions): PromptAnswers {
  const a: PromptAnswers = {};
  if (o.preset) a.preset = o.preset;
  if (o.goal !== undefined) a.goal = o.goal;
  if (o.context !== undefined) a.context = o.context;
  if (o.material?.length) a.material = o.material;
  if (o.limit?.length) a.limits = o.limit;
  if (o.autonomy !== undefined) a.autonomy = o.autonomy;
  if (o.done !== undefined) a.done = o.done;
  if (o.verify?.length) a.verify = o.verify;
  if (o.response !== undefined) a.response = o.response;
  return a;
}

const hasFlagInput = (a: PromptAnswers) => Object.keys(a).length > 0;

/**
 * `engkit prompt`. Returns the exit code: 0 ok, 1 blocked (secrets, or warnings with --strict),
 * 2 bad input or no terminal, 130 cancelled. The prompt goes to `out`; everything else to `err`.
 */
export async function runPrompt(lang: Lang, options: PromptCommandOptions, deps: PromptDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((t: string) => void process.stdout.write(t));
  const err = deps.err ?? ((t: string) => void process.stderr.write(t));
  const envScan = options.envScan !== false;
  const allowSecrets = options.allowSecrets === true;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);

  try {
    const flagAnswers = fromFlags(options);
    const fromFile = options.from !== undefined ? readAnswersFile(options.from) : {};
    const nonInteractive = options.from !== undefined || hasFlagInput(flagAnswers);

    // read first, so a wrong id fails before any question is asked
    const extra = (options.checklist ?? []).map((spec) => checklistPromptItems(spec, lang));

    let answers: PromptAnswers;
    let built: BuiltPrompt;
    let interactive = false;

    if (nonInteractive) {
      answers = addPromptItems(mergeAnswers(fromFile, flagAnswers), extra);
      built = buildPrompt(answers, { lang, cwd, envScan });
      answers = built.answers;
    } else {
      if (!isTTY) {
        err(
          "engkit prompt needs a terminal for the guided mode.\n" +
            "Use --from <file.yaml|json> or element flags (--goal, --limit, --done, --verify, ...), e.g.:\n" +
            '  engkit prompt --preset bugfix --goal "..." --done "..." --verify "`npm test`"\n'
        );
        return EXIT_USAGE;
      }
      interactive = true;
      const ctx = {
        lang,
        cwd,
        checklist: loadChecklist(lang),
        info: loadProjectInfo(cwd),
        envScan,
        allowSecrets,
        extra,
        requested: options.checklist ?? [],
      };
      const result = await runInteractive(deps.asker ?? clackAsker(), ctx);
      answers = result.answers;
      built = buildPrompt(answers, { lang, cwd, envScan }, ctx.info);
    }

    for (const w of built.warnings) err(`warning  [${w.element}] ${w.message}\n`);

    if (built.secrets.length > 0) {
      for (const s of built.secrets) err(`secret   [${s.element}:${s.line}] ${s.kind}: ${s.excerpt}\n`);
      if (!allowSecrets) {
        err(
          "Blocked: the prompt looks like it contains a secret, so nothing was printed or saved.\n" +
            "Remove it (or point to where it lives instead), or pass --allow-secrets to continue anyway.\n"
        );
        return EXIT_BLOCKED;
      }
      err("Continuing because of --allow-secrets.\n");
    }

    out(built.markdown);

    let save = options.save;
    if (save === undefined && interactive) {
      const asker = deps.asker ?? clackAsker();
      if (await asker.confirm({ message: "Save the prompt and its answers to the prompts folder?", initialValue: false })) save = true;
    }
    if (save !== undefined && save !== false) {
      const saved = savePrompt(built.markdown, answers, {
        cwd,
        name: typeof save === "string" ? save : undefined,
        gitignore: options.gitignore !== false,
        ...(deps.today ? { today: deps.today } : {}),
      });
      err(`saved    ${saved.markdownFile}\nsaved    ${saved.answersFile}  (reuse with: engkit prompt --from ${saved.answersFile})\n`);
      if (saved.gitignoreUpdated) err("note     added the prompts folder to .gitignore (generated prompts are not versioned by default).\n");
      if (saved.notIgnored) err("warning  the prompts folder is not ignored by git: saved prompts may be committed.\n");
    }

    if (options.strict && built.warnings.length > 0) return EXIT_BLOCKED;
    return EXIT_OK;
  } catch (e) {
    if (e instanceof PromptCancelled) {
      err("Cancelled.\n");
      return EXIT_CANCELLED;
    }
    if (e instanceof SecretsBlocked) {
      err("Blocked: the prompt still contains a possible secret. Nothing was printed or saved.\n");
      return EXIT_BLOCKED;
    }
    if (
      e instanceof AnswersError ||
      e instanceof ProjectRefError ||
      e instanceof ChecklistError ||
      e instanceof GenericChecklistError
    ) {
      err(`error: ${e.message}\n`);
      return EXIT_USAGE;
    }
    throw e;
  }
}
