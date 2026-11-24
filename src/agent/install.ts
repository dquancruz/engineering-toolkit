import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, DEFAULT_PROTECTED_BRANCHES, loadConfig, updateConfigFile } from "../config.js";
import { DEFAULT_PATHS, relativeLink, type DocPaths } from "../docs/files.js";
import { render } from "../docs/render.js";
import { templatesRoot, type Lang, readTemplate } from "../i18n/index.js";
import { unifiedDiff } from "./diff.js";
import { GUARD_FILE, SETTINGS_FILE, mergeSettings, SettingsError } from "./merge.js";

export const AGENT_CHOICES = ["reviewer", "builder", "both"] as const;
export type AgentChoice = (typeof AGENT_CHOICES)[number];

export interface AgentInstallOptions {
  cwd?: string;
  agent?: AgentChoice;
  /** Write without asking. */
  yes?: boolean;
  /** Show what would change and write nothing. */
  dryRun?: boolean;
  /** Replace an installed guard script that differs from the shipped one (after a diff and confirmation). */
  updateGuard?: boolean;
  /** Whether stdin/stderr are a terminal (injected by tests). */
  interactive?: boolean;
  /** Asks a yes/no question (injected by tests; default: @clack/prompts). */
  confirm?: (message: string) => Promise<boolean>;
  out?: (line: string) => void;
}

export interface AgentInstallResult {
  /** 0 ok, 1 something that needed confirmation was not written. */
  code: 0 | 1;
  created: string[];
  skipped: string[];
  updated: string[];
}

const SNIPPET: Record<Lang, string> = {
  es: `Sugerencia para la sección de restricciones de CLAUDE.md (engkit no edita ese archivo):
  - No hacer force push ni commits o push directos a las ramas protegidas.
  - No leer ni escribir archivos .env* (salvo .env.example).
  - No usar rm -rf.`,
  en: `Suggestion for the constraints section of CLAUDE.md (engkit does not edit that file):
  - No force push, and no direct commits or pushes to protected branches.
  - Do not read or write .env* files (except .env.example).
  - Do not use rm -rf.`,
};

async function defaultConfirm(message: string): Promise<boolean> {
  const { clackAsker } = await import("../prompt/asker.js");
  return clackAsker().confirm({ message, initialValue: false });
}

/** Installs the agent profile: subagents, the guard script and the merged `.claude/settings.json`. */
export async function installAgentProfile(lang: Lang, options: AgentInstallOptions = {}): Promise<AgentInstallResult> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((l: string) => console.log(l));
  const dryRun = options.dryRun === true;
  const interactive = options.interactive ?? (process.stdin.isTTY === true && process.stderr.isTTY === true);
  const confirm = options.confirm ?? defaultConfirm;
  const choice = options.agent ?? "both";
  const result: AgentInstallResult = { code: 0, created: [], skipped: [], updated: [] };

  const existing = loadConfig(cwd);
  const paths = { ...DEFAULT_PATHS[lang], ...existing.paths } as DocPaths;

  // .engkit.json: make the protected branches visible and editable.
  if (!dryRun) {
    const hadConfig = fs.existsSync(path.join(cwd, CONFIG_FILE));
    if (!hadConfig || existing.protectedBranches === undefined || existing.lang === undefined) {
      updateConfigFile(cwd, (raw) => ({
        ...raw,
        lang: raw["lang"] ?? lang,
        protectedBranches: raw["protectedBranches"] ?? DEFAULT_PROTECTED_BRANCHES,
      }));
      out(`${hadConfig ? "updated" : "created"}  ${CONFIG_FILE}`);
    }
  }

  const note = (verb: string, file: string) => out(`${dryRun ? "would " : ""}${verb}  ${file}`);

  // 1. subagents (never overwritten)
  const names = choice === "both" ? (["reviewer", "builder"] as const) : ([choice] as const);
  for (const name of names) {
    const file = `.claude/agents/${name}.md`;
    const abs = path.join(cwd, file);
    if (fs.existsSync(abs)) {
      result.skipped.push(file);
      out(`skipped  ${file} (already exists)`);
      continue;
    }
    const content = render(readTemplate(lang, `agent-${name}.md`), {
      claude_link: relativeLink(file, paths.claude),
      decisions_link: relativeLink(file, paths.decisions),
    });
    note("create", file);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
    }
    result.created.push(file);
  }

  const ask = async (message: string): Promise<boolean | null> => {
    if (options.yes) return true;
    if (!interactive) return null;
    return confirm(message);
  };

  // 2. guard script
  const shipped = fs.readFileSync(path.join(templatesRoot(), "agent", "guard.mjs"), "utf-8");
  const guardAbs = path.join(cwd, GUARD_FILE);
  if (!fs.existsSync(guardAbs)) {
    note("create", GUARD_FILE);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(guardAbs), { recursive: true });
      fs.writeFileSync(guardAbs, shipped, "utf-8");
    }
    result.created.push(GUARD_FILE);
  } else {
    const current = fs.readFileSync(guardAbs, "utf-8");
    if (current === shipped) {
      result.skipped.push(GUARD_FILE);
      out(`skipped  ${GUARD_FILE} (up to date)`);
    } else if (!options.updateGuard) {
      result.skipped.push(GUARD_FILE);
      out(`skipped  ${GUARD_FILE} (differs from the shipped version; use --update-guard to replace it)`);
    } else {
      out(unifiedDiff(current, shipped, GUARD_FILE));
      const answer = dryRun ? false : await ask(`Replace ${GUARD_FILE}?`);
      if (answer === true) {
        fs.writeFileSync(guardAbs, shipped, "utf-8");
        result.updated.push(GUARD_FILE);
        out(`updated  ${GUARD_FILE}`);
      } else {
        out(dryRun ? `dry-run: ${GUARD_FILE} not written` : `not written  ${GUARD_FILE}${answer === null ? " (no terminal: use --yes)" : ""}`);
        if (answer === null) result.code = 1;
      }
    }
  }

  // 3. settings.json, merged
  const settingsAbs = path.join(cwd, SETTINGS_FILE);
  const current = fs.existsSync(settingsAbs) ? fs.readFileSync(settingsAbs, "utf-8") : null;
  let merged;
  try {
    merged = mergeSettings(current);
  } catch (e) {
    if (e instanceof SettingsError) {
      out(`error: ${e.message}`);
      result.code = 1;
      return result;
    }
    throw e;
  }
  for (const w of merged.warnings) out(`warning: ${w}`);

  if (!merged.changed) {
    result.skipped.push(SETTINGS_FILE);
    out(`skipped  ${SETTINGS_FILE} (guards already present)`);
  } else {
    out(unifiedDiff(current ?? "", merged.text, SETTINGS_FILE));
    if (dryRun) {
      out(`dry-run: ${SETTINGS_FILE} not written`);
    } else {
      const answer = await ask(`Write these changes to ${SETTINGS_FILE}?`);
      if (answer === true) {
        const tmp = `${settingsAbs}.engkit-tmp`;
        fs.mkdirSync(path.dirname(settingsAbs), { recursive: true });
        fs.writeFileSync(tmp, merged.text, "utf-8");
        fs.renameSync(tmp, settingsAbs);
        (current === null ? result.created : result.updated).push(SETTINGS_FILE);
        out(`${current === null ? "created" : "updated"}  ${SETTINGS_FILE}`);
      } else if (answer === null) {
        out(`not written  ${SETTINGS_FILE}: no terminal to confirm. Run again with --yes to apply the diff above.`);
        result.code = 1;
      } else {
        out(`not written  ${SETTINGS_FILE}: declined.`);
      }
    }
  }

  if (!fs.existsSync(path.join(cwd, paths.claude))) {
    out(`note: ${paths.claude} not found; the subagents link to it. Run "engkit init" to create the base documents.`);
  }
  out("");
  out(SNIPPET[lang]);
  return result;
}
