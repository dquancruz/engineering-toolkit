import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isLang, DEFAULT_LANG, type Lang } from "./i18n/index.js";

export const CONFIG_FILE = ".engkit.json";

export interface EngkitConfig {
  lang?: Lang;
}

/** Reads `.engkit.json` from `cwd`. A missing file yields an empty config. */
export function loadConfig(cwd: string = process.cwd()): EngkitConfig {
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

  const config: EngkitConfig = {};
  const lang = (data as Record<string, unknown>)["lang"];
  if (lang !== undefined) {
    if (!isLang(lang)) {
      throw new Error(`Invalid ${CONFIG_FILE}: "lang" must be "es" or "en"`);
    }
    config.lang = lang;
  }
  return config;
}

/** Precedence: `--lang` flag, then `.engkit.json`, then the default (es). */
export function resolveLang(flag: string | undefined, config: EngkitConfig): Lang {
  if (flag !== undefined) {
    if (!isLang(flag)) throw new Error(`Invalid --lang "${flag}". Use "es" or "en".`);
    return flag;
  }
  return config.lang ?? DEFAULT_LANG;
}
