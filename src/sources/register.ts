import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, loadConfig, updateConfigFile } from "../config.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { parseFrontmatter, yamlScalar, type ParsedDoc } from "../docs/frontmatter.js";
import type { PendingEntry } from "../docs/pending.js";
import { parseRegister } from "../docs/register.js";
import { render } from "../docs/render.js";
import { readTemplate, type Lang } from "../i18n/index.js";

// The sources register (F-xx) says where each fact comes from. The legacy and requirements profiles share it.

/** Where an expected result or a non-code fact comes from. `code` can never be the source of an expected result. */
export const SOURCE_TYPES = ["code", "database", "schema", "data", "document", "person"] as const;
/** Required fields of an entry. */
export const SOURCE_FIELDS = ["type", "obtained_by", "obtained_on", "method"] as const;

export const DEFAULT_SOURCES_DOC: Record<Lang, string> = { es: "docs/fuentes.md", en: "docs/sources.md" };

export interface SourcesRegister {
  /** Project-relative path. */
  file: string;
  text: string;
  fm: ParsedDoc | null;
  entries: PendingEntry[];
}

/** The register at `file`, or null when it does not exist. */
export function loadSources(cwd: string, file: string): SourcesRegister | null {
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const text = fs.readFileSync(abs, "utf-8");
  return { file, text, fm: parseFrontmatter(text), entries: parseRegister(text, "F") };
}

/**
 * Used by the init of every profile that needs the register: stores its path in the shared section and creates
 * the document unless it already exists. An existing file is never touched.
 */
export function ensureSources(lang: Lang, options: DocOptions & { dryRun?: boolean; out: (line: string) => void }): string {
  const cwd = options.cwd ?? process.cwd();
  const { out } = options;
  const dryRun = options.dryRun === true;
  const config = loadConfig(cwd);
  const stored = config.lang ?? lang;
  const doc = config.sources?.doc ?? DEFAULT_SOURCES_DOC[stored];
  if (!config.sources) {
    if (!dryRun) updateConfigFile(cwd, (raw) => ({ ...raw, lang: raw["lang"] ?? lang, sources: { doc } }));
    out(`${dryRun ? "would " : ""}update  ${CONFIG_FILE}  (sources)`);
  }
  const abs = path.join(cwd, doc);
  if (fs.existsSync(abs)) {
    out(`skipped  ${doc} (already exists)`);
    return doc;
  }
  if (!dryRun) {
    const vars = { date: options.today ?? todayISO(), owner_yaml: yamlScalar(resolveOwner(options.owner, cwd)) };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, render(readTemplate(stored, "sources.md"), vars), "utf-8");
  }
  out(`${dryRun ? "would create" : "created"}  ${doc}`);
  return doc;
}
