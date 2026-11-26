import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, loadConfig } from "../config.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { parseFrontmatter, setFrontmatterField } from "../docs/frontmatter.js";
import type { Lang } from "../i18n/index.js";
import { PromptCancelled, clackAsker, type Asker } from "../prompt/asker.js";
import { loadEnvSecrets, scanForSecrets } from "../prompt/secrets.js";
import { RequirementsError, addEntries, parseEntriesFile, type NewEntry } from "../requirements/entries.js";
import { collectRequirements } from "../requirements/interactive.js";
import { runNewPending } from "./new.js";

export interface RequirementsOptions extends DocOptions {
  from?: string;
  dryRun?: boolean;
  allowSecrets?: boolean;
  asker?: Asker;
  isTTY?: boolean;
  out?: (text: string) => void;
  err?: (line: string) => void;
}

/**
 * `engkit requirements`: appends RNF and RES entries to the requirements document.
 * Exit code: 0 ok, 1 blocked by a possible secret, 2 bad input or no terminal, 130 cancelled.
 */
export async function runRequirements(lang: Lang, options: RequirementsOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((t: string) => void process.stdout.write(t));
  const err = options.err ?? ((l: string) => console.error(l));
  const fail = (message: string): 2 => {
    err(`error: ${message}`);
    return 2;
  };

  const config = loadConfig(cwd);
  const file = config.requirements?.doc;
  if (!file) return fail(`${CONFIG_FILE} has no "requirements" section. Run "engkit init --profile requirements" first.`);
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs)) return fail(`${file} does not exist. Run "engkit init --profile requirements" again.`);
  const owner = resolveOwner(options.owner, cwd);
  const date = options.today ?? todayISO();

  try {
    let entries: NewEntry[];
    let questions: string[] = [];
    if (options.from !== undefined) {
      let content: string;
      try {
        content = fs.readFileSync(path.resolve(cwd, options.from), "utf-8");
      } catch {
        return fail(`File not found: ${options.from}`);
      }
      entries = parseEntriesFile(content, options.from);
    } else {
      if (!(options.isTTY ?? Boolean(process.stdin.isTTY && process.stderr.isTTY))) {
        return fail("the guided mode needs a terminal. Use --from <file.yaml|json>.");
      }
      ({ entries, questions } = await collectRequirements(options.asker ?? clackAsker(), owner));
    }

    // one item per entry, so a finding points at its position without showing the value
    const text = entries.map((e) => [e.title, ...Object.values(e.fields)].join(" ; "));
    const secrets = scanForSecrets({ material: text }, loadEnvSecrets(cwd));
    if (secrets.length > 0) {
      for (const s of secrets) err(`secret   [entry ${s.line}] ${s.kind}: ${s.excerpt}`);
      if (!options.allowSecrets) {
        err("Blocked: a value looks like a secret, so nothing was written. Remove it, or pass --allow-secrets.");
        return 1;
      }
    }

    const current = fs.readFileSync(abs, "utf-8");
    const result = addEntries(current, entries, { owner, date });
    for (const e of result.skipped) err(`skipped  "${e.title}" (already in ${file})`);
    if (options.dryRun) {
      out(result.added.map((a) => a.markdown).join("\n"));
      for (const q of questions) err(`would open a pending question: ${q}`);
      return 0;
    }
    if (result.added.length === 0) {
      err(`nothing to add to ${file}.`);
      return 0;
    }
    let next = result.text;
    if (parseFrontmatter(next)) next = setFrontmatterField(next, "date", date);
    next = next.replace(/\d{4}-\d{2}-\d{2}(?=\.? <!-- engkit:date -->)/, date);
    fs.writeFileSync(abs, next, "utf-8");
    for (const a of result.added) err(`added    ${a.id} to ${file}: ${a.entry.title}`);
    for (const q of questions) {
      if (config.paths) runNewPending(q, lang, { cwd, owner, today: date, type: "question" });
      else err(`note: no pending file (run "engkit init"); question not recorded: ${q}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof PromptCancelled) {
      err("Cancelled. Nothing was written.");
      return 130;
    }
    if (e instanceof RequirementsError) return fail(e.message);
    throw e;
  }
}
