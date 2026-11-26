import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, loadConfig, updateConfigFile } from "../config.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { DEFAULT_PATHS, DOC_KEYS, TEMPLATE_DOCS, relativeLink, type DocPaths } from "../docs/files.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { render } from "../docs/render.js";
import type { Lang } from "../i18n/index.js";
import { readTemplate } from "../i18n/index.js";
import { AGENT_CHOICES, installAgentProfile, type AgentChoice } from "../agent/install.js";
import { generateIndex } from "./index-cmd.js";
import { runInitLegacy } from "./legacy.js";
import { REBUILD_EXTRAS, runInitRebuild, runInitRequirements, type RebuildExtra } from "./rebuild.js";

export { AGENT_CHOICES };

export const PROFILES = ["base", "agent", "legacy", "requirements", "rebuild"] as const;
export type Profile = (typeof PROFILES)[number];

/** Parses `--profile base,agent`. */
export function parseProfiles(value: string): Profile[] {
  const out: Profile[] = [];
  for (const part of value.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
    if (!(PROFILES as readonly string[]).includes(part)) {
      throw new Error(`Invalid profile "${part}". Use: ${PROFILES.join(", ")} (combine with commas, e.g. base,agent).`);
    }
    if (!out.includes(part as Profile)) out.push(part as Profile);
  }
  if (out.length === 0) throw new Error(`Empty --profile. Use: ${PROFILES.join(", ")}.`);
  return out;
}

/** Parses `--with strangler,data`. */
export function parseExtras(value: string): RebuildExtra[] {
  const parts = [...new Set(value.split(",").map((p) => p.trim()).filter((p) => p !== ""))];
  const unknown = parts.find((p) => !(REBUILD_EXTRAS as readonly string[]).includes(p));
  if (unknown !== undefined || parts.length === 0) {
    throw new Error(`Invalid --with "${unknown ?? value}". Use: ${REBUILD_EXTRAS.join(", ")}.`);
  }
  return parts as RebuildExtra[];
}

export interface InitOptions extends DocOptions {
  profiles?: Profile[];
  /** Print what would be created and write nothing. */
  dryRun?: boolean;
}

export interface InitProfilesOptions extends InitOptions {
  agent?: AgentChoice;
  yes?: boolean;
  updateGuard?: boolean;
  /** Optional plans of the rebuild profile. */
  extras?: RebuildExtra[];
  interactive?: boolean;
  confirm?: (message: string) => Promise<boolean>;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

/** Placeholders available to every template, with links relative to `file`. */
function templateVars(file: string, paths: DocPaths, owner: string, date: string): Record<string, string> {
  const link = (to: string) => relativeLink(file, to);
  return {
    date,
    owner,
    owner_yaml: yamlScalar(owner),
    decisions_link: link(paths.decisions),
    log_link: link(paths.log),
    glossary_link: link(paths.glossary),
    pending_link: link(paths.pending),
    design_link: link(paths.design),
    claude_link: link(paths.claude),
    agents_link: link(paths.agents),
  };
}

/**
 * Creates the base documents for `lang` and stores their paths in `.engkit.json`.
 * Existing files are never overwritten.
 */
export function runInit(lang: Lang, options: InitOptions = {}): InitResult {
  const cwd = options.cwd ?? process.cwd();
  const date = options.today ?? todayISO();
  const owner = resolveOwner(options.owner, cwd);
  const result: InitResult = { created: [], skipped: [] };

  // Paths already stored in .engkit.json win; the rest come from the language defaults.
  const existing = loadConfig(cwd);
  const paths = { ...DEFAULT_PATHS[lang], ...existing.paths } as DocPaths;

  const dryRun = options.dryRun === true;
  const hadConfig = fs.existsSync(path.join(cwd, CONFIG_FILE));
  if (!dryRun) {
    updateConfigFile(cwd, (raw) => ({
      ...raw,
      lang: raw["lang"] ?? lang,
      paths: Object.fromEntries(DOC_KEYS.map((k) => [k, paths[k]])),
    }));
  }
  console.log(`${dryRun ? "would " : ""}${hadConfig ? "update" : "create"}  ${CONFIG_FILE}`);

  const write = (file: string, content: string) => {
    const abs = path.join(cwd, file);
    if (fs.existsSync(abs)) {
      result.skipped.push(file);
      console.log(`skipped  ${file} (already exists)`);
      return;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
    }
    result.created.push(file);
    console.log(`${dryRun ? "would create" : "created"}  ${file}`);
  };

  if (!dryRun) fs.mkdirSync(path.join(cwd, paths.adrDir), { recursive: true });
  for (const { key, template } of TEMPLATE_DOCS) {
    const file = paths[key];
    write(file, render(readTemplate(lang, template), templateVars(file, paths, owner, date)));
  }

  // Generated ADR index (empty at first). Never overwrites an existing one.
  if (!fs.existsSync(path.join(cwd, paths.decisions))) {
    write(paths.decisions, dryRun ? "" : generateIndex(lang, path.join(cwd, paths.adrDir), paths, date));
  } else {
    result.skipped.push(paths.decisions);
    console.log(`skipped  ${paths.decisions} (already exists)`);
  }

  if (owner === "TODO") {
    console.log('note: no owner found (git config user.name is empty); fields say "TODO". Use --owner "<name>".');
  }
  return result;
}

/**
 * Runs the selected profiles. `base` creates the documents; `agent` adds the subagents and the Claude Code
 * guards and is additive (it never touches the base documents). Returns the exit code.
 */
export async function runInitProfiles(lang: Lang, options: InitProfilesOptions = {}): Promise<number> {
  const profiles = options.profiles ?? ["base"];
  let code = 0;
  if (options.extras?.length && !profiles.includes("rebuild")) throw new Error('--with only applies to "--profile rebuild".');
  if (profiles.includes("base")) runInit(lang, options);
  if (profiles.includes("legacy")) runInitLegacy(lang, options);
  if (profiles.includes("requirements")) runInitRequirements(lang, options);
  if (profiles.includes("rebuild")) {
    runInitRebuild(lang, { ...options, legacyDone: profiles.includes("legacy"), requirementsDone: profiles.includes("requirements") });
  }
  if (profiles.includes("agent")) {
    const result = await installAgentProfile(lang, {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      ...(options.yes !== undefined ? { yes: options.yes } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
      ...(options.updateGuard !== undefined ? { updateGuard: options.updateGuard } : {}),
      ...(options.interactive !== undefined ? { interactive: options.interactive } : {}),
      ...(options.confirm !== undefined ? { confirm: options.confirm } : {}),
    });
    code = result.code;
  }
  return code;
}
