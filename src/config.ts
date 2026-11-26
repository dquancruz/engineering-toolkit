import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOC_KEYS, type DocKey } from "./docs/files.js";
import { isLang, DEFAULT_LANG, type Lang } from "./i18n/index.js";

export const CONFIG_FILE = ".engkit.json";

export interface EngkitConfig {
  lang?: Lang;
  /** Project-relative path of each managed document, written by `engkit init`. */
  paths?: Partial<Record<DocKey, string>>;
  /** Folder for `engkit prompt --save` (default: `prompts`). */
  promptsDir?: string;
  /** Branches the agent guard protects from commits and pushes; `*` is a wildcard (default: main, master). */
  protectedBranches?: string[];
  /** Settings of `engkit branch`; missing keys take the defaults. */
  branch?: Partial<BranchConfig>;
  /** Paths of the legacy profile; its presence turns on the legacy rules of `engkit check`. */
  legacy?: LegacyPaths;
  /** Where the code cited as evidence lives, by name. `self` (the project) is always defined. */
  evidenceRoots?: Record<string, EvidenceRootConfig>;
}

export const LEGACY_KEYS = ["rulesDir", "testsDir", "defectsDir", "sources", "rulesIndex"] as const;
export type LegacyPaths = Record<(typeof LEGACY_KEYS)[number], string>;

export interface EvidenceRootConfig {
  /** Relative to the project or absolute; it may be outside the project. */
  path: string;
  /** Where to get it (informative). */
  repo?: string;
}

export const LOCAL_CONFIG_FILE = ".engkit.local.json";
export const SELF_ROOT = "self";
/** At least two characters, so a root name is never read as a Windows drive letter. */
export const ROOT_NAME = /^[A-Za-z0-9_-]{2,}$/;

export interface BranchConfig {
  /** Prefixes allowed in branch names. */
  types: string[];
  defaultType: string;
  /** Regular expression a ticket ID must match completely. */
  ticketPattern: string;
  requireTicket: boolean;
}

export const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  types: ["feature", "fix", "chore", "docs", "refactor", "test"],
  defaultType: "feature",
  ticketPattern: "[A-Z][A-Z0-9]+-\\d+",
  requireTicket: false,
};

export const DEFAULT_PROTECTED_BRANCHES = ["main", "master"];

function readRaw(cwd: string, name: string = CONFIG_FILE): Record<string, unknown> {
  const file = path.join(cwd, name);
  if (!existsSync(file)) return {};

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid ${name}: ${message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Invalid ${name}: expected a JSON object`);
  }
  return data as Record<string, unknown>;
}

function validatePath(key: string, value: unknown, prefix = "paths."): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${CONFIG_FILE}: "${prefix}${key}" must be a non-empty string`);
  }
  const normalized = path.posix.normalize(value);
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || value.includes("\\")) {
    throw new Error(
      `Invalid ${CONFIG_FILE}: "${prefix}${key}" must be a relative path inside the project, with "/" separators`
    );
  }
  return normalized;
}

const BRANCH_TYPE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function validateBranch(value: unknown): Partial<BranchConfig> {
  const fail = (message: string): never => {
    throw new Error(`Invalid ${CONFIG_FILE}: ${message}`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail('"branch" must be an object');
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((k) => !(k in DEFAULT_BRANCH_CONFIG));
  if (unknown.length > 0) fail(`unknown key(s) in "branch": ${unknown.join(", ")}. Valid keys: ${Object.keys(DEFAULT_BRANCH_CONFIG).join(", ")}`);

  const out: Partial<BranchConfig> = {};
  const { types, defaultType, ticketPattern, requireTicket } = raw;
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0 || !types.every((t) => typeof t === "string" && BRANCH_TYPE.test(t))) {
      fail('"branch.types" must be a non-empty list of prefixes made of letters, numbers, "-" or "_"');
    }
    out.types = types as string[];
  }
  const effective = out.types ?? DEFAULT_BRANCH_CONFIG.types;
  if (defaultType !== undefined) {
    if (typeof defaultType !== "string" || !effective.includes(defaultType)) fail(`"branch.defaultType" must be one of: ${effective.join(", ")}`);
    out.defaultType = defaultType as string;
  }
  if (ticketPattern !== undefined) {
    if (typeof ticketPattern !== "string" || ticketPattern === "") fail('"branch.ticketPattern" must be a non-empty regular expression');
    try {
      new RegExp(`^(?:${ticketPattern as string})$`);
    } catch {
      fail('"branch.ticketPattern" is not a valid regular expression');
    }
    out.ticketPattern = ticketPattern as string;
  }
  if (requireTicket !== undefined) {
    if (typeof requireTicket !== "boolean") fail('"branch.requireTicket" must be true or false');
    out.requireTicket = requireTicket as boolean;
  }
  return out;
}

/** The configured branch settings over the defaults. Without "feature" in a custom list, the first type is the default. */
export function branchConfig(config: EngkitConfig): BranchConfig {
  const merged = { ...DEFAULT_BRANCH_CONFIG, ...config.branch };
  if (!merged.types.includes(merged.defaultType)) merged.defaultType = merged.types[0]!;
  return merged;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function validateLegacy(value: unknown): LegacyPaths {
  if (!isObject(value)) throw new Error(`Invalid ${CONFIG_FILE}: "legacy" must be an object`);
  return Object.fromEntries(LEGACY_KEYS.map((key) => [key, validatePath(key, value[key], "legacy.")])) as LegacyPaths;
}

function validateRoots(value: unknown, file: string): Record<string, EvidenceRootConfig> {
  const fail = (message: string): never => {
    throw new Error(`Invalid ${file}: ${message}`);
  };
  if (!isObject(value)) fail('"evidenceRoots" must be an object');
  const out: Record<string, EvidenceRootConfig> = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!ROOT_NAME.test(name) || name === SELF_ROOT) {
      fail(`evidence root "${name}": use at least 2 letters, numbers, "-" or "_" ("${SELF_ROOT}" is reserved)`);
    }
    if (!isObject(entry) || typeof entry["path"] !== "string" || entry["path"].trim() === "") {
      fail(`"evidenceRoots.${name}.path" must be a non-empty string`);
    }
    const { path: rootPath, repo } = entry as Record<string, unknown>;
    if (repo !== undefined && typeof repo !== "string") fail(`"evidenceRoots.${name}.repo" must be text`);
    out[name] = { path: rootPath as string, ...(typeof repo === "string" ? { repo } : {}) };
  }
  return out;
}

/**
 * The evidence roots of the project, with the machine's overrides from `.engkit.local.json` applied.
 * Only roots declared in `.engkit.json` can be overridden.
 */
export function evidenceRoots(cwd: string): Record<string, EvidenceRootConfig> {
  const declared = loadConfig(cwd).evidenceRoots ?? {};
  const raw = readRaw(cwd, LOCAL_CONFIG_FILE)["evidenceRoots"];
  const local = raw === undefined ? {} : validateRoots(raw, LOCAL_CONFIG_FILE);
  for (const name of Object.keys(local)) {
    if (!declared[name]) throw new Error(`Invalid ${LOCAL_CONFIG_FILE}: evidence root "${name}" is not declared in ${CONFIG_FILE}`);
  }
  return { ...declared, ...local };
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

  const promptsDir = data["promptsDir"];
  if (promptsDir !== undefined) config.promptsDir = validatePath("promptsDir", promptsDir, "");

  const protectedBranches = data["protectedBranches"];
  if (protectedBranches !== undefined) {
    if (
      !Array.isArray(protectedBranches) ||
      protectedBranches.length === 0 ||
      !protectedBranches.every((b) => typeof b === "string" && b.trim() !== "" && !/\s/.test(b))
    ) {
      throw new Error(`Invalid ${CONFIG_FILE}: "protectedBranches" must be a non-empty list of branch names or patterns (e.g. "release/*")`);
    }
    config.protectedBranches = protectedBranches as string[];
  }

  if (data["branch"] !== undefined) config.branch = validateBranch(data["branch"]);
  if (data["legacy"] !== undefined) config.legacy = validateLegacy(data["legacy"]);
  if (data["evidenceRoots"] !== undefined) config.evidenceRoots = validateRoots(data["evidenceRoots"], CONFIG_FILE);
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
