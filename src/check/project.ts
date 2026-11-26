import fs from "node:fs";
import path from "node:path";
import { docPath, loadConfig } from "../config.js";
import { parseFrontmatter, type ParsedDoc } from "../docs/frontmatter.js";
import type { DocKey, DocPaths } from "../docs/files.js";
import { DOC_KEYS } from "../docs/files.js";
import { loadLegacy, type Legacy } from "../legacy/load.js";

export class CheckSetupError extends Error {}

/** Documents with a visible date ("status documents"), besides the ADRs. */
export const STATUS_DOC_KEYS = ["claude", "agents", "glossary", "pending", "design"] as const;

export interface Doc {
  key: DocKey | "adr" | "sources";
  /** Project-relative path with "/" separators. */
  file: string;
  text: string;
  fm: ParsedDoc | null;
}

export interface AdrDoc extends Doc {
  number: number;
}

export interface Project {
  cwd: string;
  paths: DocPaths;
  /** Existing documents among: claude, agents, glossary, pending, design, log (and the legacy sources register). */
  docs: Doc[];
  /** ADRs with number >= 1, sorted by number. */
  adrs: AdrDoc[];
  /** Whether the ADR template (number 0) exists. */
  hasAdrTemplate: boolean;
  /** Managed files that are configured but missing on disk. */
  missing: string[];
  /** The legacy profile, when `.engkit.json` has a "legacy" section. */
  legacy: Legacy | null;
}

function read(cwd: string, file: string): Doc["text"] | null {
  const abs = path.join(cwd, file);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, "utf-8") : null;
}

/** Loads `.engkit.json` and every managed document. Throws CheckSetupError when the project is not initialized. */
export function loadProject(cwd: string): Project {
  let config;
  try {
    config = loadConfig(cwd);
  } catch (e) {
    throw new CheckSetupError(e instanceof Error ? e.message : String(e));
  }
  const paths = {} as DocPaths;
  for (const key of DOC_KEYS) {
    try {
      paths[key] = docPath(config, key);
    } catch (e) {
      throw new CheckSetupError(e instanceof Error ? e.message : String(e));
    }
  }

  const missing: string[] = [];
  const docs: Doc[] = [];
  for (const key of [...STATUS_DOC_KEYS, "log"] as const) {
    const text = read(cwd, paths[key]);
    if (text === null) missing.push(paths[key]);
    else docs.push({ key, file: paths[key], text, fm: parseFrontmatter(text) });
  }
  if (read(cwd, paths.decisions) === null) missing.push(paths.decisions);

  const adrDirAbs = path.join(cwd, paths.adrDir);
  if (!fs.existsSync(adrDirAbs)) missing.push(paths.adrDir);

  const adrs: AdrDoc[] = [];
  let hasAdrTemplate = false;
  if (fs.existsSync(adrDirAbs)) {
    for (const name of fs.readdirSync(adrDirAbs).sort()) {
      const m = /^(\d{4})-.+\.md$/.exec(name);
      if (!m) continue;
      const file = path.posix.join(paths.adrDir, name);
      if (Number(m[1]) === 0 || file === paths.adrTemplate) {
        hasAdrTemplate = true;
        continue;
      }
      const text = fs.readFileSync(path.join(cwd, file), "utf-8");
      adrs.push({ key: "adr", file, text, fm: parseFrontmatter(text), number: Number(m[1]) });
    }
  }
  if (read(cwd, paths.adrTemplate) !== null) hasAdrTemplate = true;
  else if (!hasAdrTemplate) missing.push(paths.adrTemplate);

  const legacy = config.legacy ? loadLegacy(cwd, config.legacy) : null;
  if (legacy && !legacy.sources) missing.push(legacy.paths.sources);

  // the sources register is a status document: it gets the same owner and date rules
  if (legacy?.sources) docs.push({ key: "sources", file: legacy.sources.file, text: legacy.sources.text, fm: legacy.sources.fm });

  return { cwd, paths, docs, adrs, hasAdrTemplate, missing, legacy };
}

export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
