import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, loadConfig, updateConfigFile } from "../config.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { DEFAULT_PATHS, DOC_KEYS, TEMPLATE_DOCS, relativeLink, type DocPaths } from "../docs/files.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { render } from "../docs/render.js";
import type { Lang } from "../i18n/index.js";
import { readTemplate } from "../i18n/index.js";
import { generateIndex } from "./index-cmd.js";

export const PROFILES = ["base"] as const;
export type Profile = (typeof PROFILES)[number];

export interface InitOptions extends DocOptions {
  profile?: Profile;
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

  const hadConfig = fs.existsSync(path.join(cwd, CONFIG_FILE));
  updateConfigFile(cwd, (raw) => ({
    ...raw,
    lang: raw["lang"] ?? lang,
    paths: Object.fromEntries(DOC_KEYS.map((k) => [k, paths[k]])),
  }));
  console.log(`${hadConfig ? "updated" : "created"}  ${CONFIG_FILE}`);

  const write = (file: string, content: string) => {
    const abs = path.join(cwd, file);
    if (fs.existsSync(abs)) {
      result.skipped.push(file);
      console.log(`skipped  ${file} (already exists)`);
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    result.created.push(file);
    console.log(`created  ${file}`);
  };

  fs.mkdirSync(path.join(cwd, paths.adrDir), { recursive: true });
  for (const { key, template } of TEMPLATE_DOCS) {
    const file = paths[key];
    write(file, render(readTemplate(lang, template), templateVars(file, paths, owner, date)));
  }

  // Generated ADR index (empty at first). Never overwrites an existing one.
  if (!fs.existsSync(path.join(cwd, paths.decisions))) {
    write(paths.decisions, generateIndex(lang, path.join(cwd, paths.adrDir), paths, date));
  } else {
    result.skipped.push(paths.decisions);
    console.log(`skipped  ${paths.decisions} (already exists)`);
  }

  if (owner === "TODO") {
    console.log('note: no owner found (git config user.name is empty); fields say "TODO". Use --owner "<name>".');
  }
  return result;
}
