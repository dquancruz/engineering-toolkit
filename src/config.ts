import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOC_KEYS, type DocKey } from "./docs/files.js";
import { isLang, DEFAULT_LANG, type Lang } from "./i18n/index.js";

export const CONFIG_FILE = ".engkit.json";

export interface EngkitConfig {
  lang?: Lang;
  /** Project-relative path of each managed document, written by `engkit init`. */
  paths?: Partial<Record<DocKey, string>>;
}

function readRaw(cwd: string): Record<string, unknown> {
  const file = path.join(cwd, CONFIG_FILE);
  if (!existsSync(file)) return {};

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid ${CONFIG_FILE}: ${message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Invalid ${CONFIG_FILE}: expected a JSON object`);
  }
  return data as Record<string, unknown>;
}

function validatePath(key: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${CONFIG_FILE}: "paths.${key}" must be a non-empty string`);
  }
  const normalized = path.posix.normalize(value);
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || value.includes("\\")) {
    throw new Error(
      `Invalid ${CONFIG_FILE}: "paths.${key}" must be a relative path inside the project, with "/" separators`
    );
  }
  return normalized;
}

/** Reads `.engkit.json` from `cwd`. A missing file yields an empty config. */
export function loadConfig(cwd: string = process.cwd()): EngkitConfig {
  const data = readRaw(cwd);
  const config: EngkitConfig = {};

  const lang = data["lang"];
  if (lang !== undefined) {
    if (!isLang(lang)) {
      throw new Error(`Invalid ${CONFIG_FILE}: "lang" must be "es" or "en"`);
    }
    config.lang = lang;
  }

  const paths = data["paths"];
  if (paths !== undefined) {
    if (typeof paths !== "object" || paths === null || Array.isArray(paths)) {
      throw new Error(`Invalid ${CONFIG_FILE}: "paths" must be an object`);
    }
    const out: Partial<Record<DocKey, string>> = {};
    for (const key of DOC_KEYS) {
      const value = (paths as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = validatePath(key, value);
    }
    config.paths = out;
  }
  return config;
}

/**
 * Updates `.engkit.json`, keeping any keys engkit does not know about.
 * `update` receives the raw object and returns the new one.
 */
export function updateConfigFile(
  cwd: string,
  update: (raw: Record<string, unknown>) => Record<string, unknown>
): void {
  const next = update(readRaw(cwd));
  writeFileSync(path.join(cwd, CONFIG_FILE), JSON.stringify(next, null, 2) + "\n", "utf-8");
}

/** Path of a managed document, as stored by `init`. Fails with a hint when it is missing. */
export function docPath(config: EngkitConfig, key: DocKey): string {
  const value = config.paths?.[key];
  if (!value) {
    throw new Error(`${CONFIG_FILE} has no "paths.${key}". Run "engkit init" first.`);
  }
  return value;
}

/** Precedence: `--lang` flag, then `.engkit.json`, then the default (es). */
export function resolveLang(flag: string | undefined, config: EngkitConfig): Lang {
  if (flag !== undefined) {
    if (!isLang(flag)) throw new Error(`Invalid --lang "${flag}". Use "es" or "en".`);
    return flag;
  }
  return config.lang ?? DEFAULT_LANG;
}
