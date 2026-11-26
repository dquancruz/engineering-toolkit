import fs from "node:fs";
import path from "node:path";
import { deletedFiles } from "../check/git.js";
import { CheckSetupError, loadProject } from "../check/project.js";
import { CONFIG_FILE, loadConfig, updateConfigFile, type RebuildPaths } from "../config.js";
import { slugify } from "../docs/adr.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { DEFAULT_PATHS, relativeLink, type DocPaths } from "../docs/files.js";
import { parseFrontmatter, yamlScalar } from "../docs/frontmatter.js";
import { render } from "../docs/render.js";
import { readTemplate, type Lang } from "../i18n/index.js";
import { definitionHash } from "../rebuild/data.js";
import { loadRebuild } from "../rebuild/load.js";
import { SLICE_FILE, formatSliceId } from "../rebuild/model.js";
import { TestPlanError, buildTestPlan, generateTestPlan } from "../rebuild/testplan.js";
import { loadLegacy } from "../legacy/load.js";
import { DEFAULT_LEGACY_PATHS, runInitLegacy, type Output } from "./legacy.js";

export const REBUILD_EXTRAS = ["strangler", "data"] as const;
export type RebuildExtra = (typeof REBUILD_EXTRAS)[number];

export const DEFAULT_REQUIREMENTS_DOC: Record<Lang, string> = { es: "docs/requisitos.md", en: "docs/requirements.md" };

export const DEFAULT_REBUILD_PATHS: Record<Lang, Required<RebuildPaths>> = {
  es: {
    plan: "docs/reconstruccion/plan.md",
    slicesDir: "docs/reconstruccion/rebanadas",
    testplan: "docs/plan-de-pruebas.md",
    strangler: "docs/reconstruccion/estrangulador.md",
    dataDir: "docs/reconstruccion/datos",
  },
  en: {
    plan: "docs/rebuild/plan.md",
    slicesDir: "docs/rebuild/slices",
    testplan: "docs/test-plan.md",
    strangler: "docs/rebuild/strangler.md",
    dataDir: "docs/rebuild/data",
  },
};

type InitOptions = DocOptions & Output & { dryRun?: boolean };

const streams = (o: Output) => ({ out: o.out ?? ((l: string) => console.log(l)), err: o.err ?? ((l: string) => console.error(l)) });

/** Writes a new file; an existing one is reported and left alone. */
function create(cwd: string, file: string, content: () => string, dryRun: boolean, out: (l: string) => void): void {
  const abs = path.join(cwd, file);
  if (fs.existsSync(abs)) return out(`skipped  ${file} (already exists)`);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content(), "utf-8");
  }
  out(`${dryRun ? "would create" : "created"}  ${file}`);
}

/** `engkit init --profile requirements`: only the requirements document; nothing of the legacy profile. */
export function runInitRequirements(lang: Lang, options: InitOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const { out } = streams(options);
  const dryRun = options.dryRun === true;
  const config = loadConfig(cwd);
  const stored = config.lang ?? lang;
  const doc = config.requirements?.doc ?? DEFAULT_REQUIREMENTS_DOC[stored];
  if (!config.requirements) {
    if (!dryRun) updateConfigFile(cwd, (raw) => ({ ...raw, lang: raw["lang"] ?? lang, requirements: { doc } }));
    out(`${dryRun ? "would " : ""}update  ${CONFIG_FILE}  (requirements)`);
  }
  const vars = { date: options.today ?? todayISO(), owner_yaml: yamlScalar(resolveOwner(options.owner, cwd)) };
  create(cwd, doc, () => render(readTemplate(stored, "requirements.md"), vars), dryRun, out);
  if (!config.paths && !dryRun) out('note: "engkit check" also needs the base documents: run "engkit init".');
}

/**
 * `engkit init --profile rebuild [--with strangler,data]`: adds the requirements and legacy profiles when they
 * are missing, then the rebuild plan and the optional plans.
 */
export function runInitRebuild(lang: Lang, options: InitOptions & { extras?: RebuildExtra[]; requirementsDone?: boolean; legacyDone?: boolean } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const { out } = streams(options);
  const dryRun = options.dryRun === true;
  const before = loadConfig(cwd);
  const stored = before.lang ?? lang;

  if (!options.legacyDone) {
    if (!before.legacy) out('note: the rebuild profile needs "legacy" (rules, tests and sources): adding it.');
    if (!before.legacy) runInitLegacy(lang, options);
  }
  if (!options.requirementsDone) {
    if (!before.requirements) out('note: the rebuild profile needs "requirements": adding it.');
    if (!before.requirements) runInitRequirements(lang, options);
  }

  const config = loadConfig(cwd);
  const defaults = DEFAULT_REBUILD_PATHS[stored];
  const extras = options.extras ?? [];
  const paths: RebuildPaths = {
    plan: config.rebuild?.plan ?? defaults.plan,
    slicesDir: config.rebuild?.slicesDir ?? defaults.slicesDir,
    testplan: config.rebuild?.testplan ?? defaults.testplan,
    ...(config.rebuild?.strangler || extras.includes("strangler") ? { strangler: config.rebuild?.strangler ?? defaults.strangler } : {}),
    ...(config.rebuild?.dataDir || extras.includes("data") ? { dataDir: config.rebuild?.dataDir ?? defaults.dataDir } : {}),
  };
  if (JSON.stringify(paths) !== JSON.stringify(config.rebuild)) {
    if (!dryRun) updateConfigFile(cwd, (raw) => ({ ...raw, rebuild: paths }));
    out(`${dryRun ? "would " : ""}update  ${CONFIG_FILE}  (rebuild)`);
  }

  const docs = { ...DEFAULT_PATHS[stored], ...config.paths } as DocPaths;
  const legacy = config.legacy ?? DEFAULT_LEGACY_PATHS[stored];
  const requirements = config.requirements?.doc ?? DEFAULT_REQUIREMENTS_DOC[stored];
  const vars = { date: options.today ?? todayISO(), owner_yaml: yamlScalar(resolveOwner(options.owner, cwd)) };
  const link = (to: string) => relativeLink(paths.plan, to);
  create(
    cwd,
    paths.plan,
    () =>
      render(readTemplate(stored, "plan.md"), {
        ...vars,
        requirements_link: link(requirements),
        sources_link: link(legacy.sources),
        rules_link: link(legacy.rulesIndex),
        decisions_link: link(docs.decisions),
        pending_link: link(docs.pending),
        testplan_link: link(paths.testplan),
      }),
    dryRun,
    out
  );
  if (!dryRun) fs.mkdirSync(path.join(cwd, paths.slicesDir), { recursive: true });
  if (paths.strangler) create(cwd, paths.strangler, () => render(readTemplate(stored, "strangler.md"), vars), dryRun, out);
  if (paths.dataDir) create(cwd, path.posix.join(paths.dataDir, "README.md"), () => readTemplate(stored, "data-readme.md"), dryRun, out);
}

export interface NewSliceOptions extends DocOptions, Output {
  rule?: string[];
  test?: string[];
}

/** `engkit new slice "<title>"`: the next slice, ordered after the others. Returns the file created. */
export function runNewSlice(title: string, lang: Lang, options: NewSliceOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const { out } = streams(options);
  const config = loadConfig(cwd);
  if (!config.rebuild || !config.legacy) throw new Error(`${CONFIG_FILE} has no "rebuild" section. Run "engkit init --profile rebuild" first.`);
  const rebuild = loadRebuild(cwd, config.rebuild);
  const legacy = loadLegacy(cwd, config.legacy);

  const cleanTitle = title.trim().replace(/\s+/g, " ");
  const slug = slugify(cleanTitle);
  if (slug === "") throw new Error("The title must contain letters or numbers.");
  const list = (values: string[] | undefined, known: string[], what: string) => {
    for (const v of values ?? []) if (!known.includes(v)) throw new Error(`${what} ${v} does not exist.`);
    return `[${[...new Set(values ?? [])].join(", ")}]`;
  };
  const rules = list(options.rule, legacy.items.rule.map((i) => i.id), "Rule");
  const tests = list(options.test, legacy.items.test.map((i) => i.id), "Test");

  const dir = config.rebuild.slicesDir;
  const names = [...rebuild.slices.map((s) => path.posix.basename(s.file)), ...deletedFiles(cwd, dir).map((d) => path.posix.basename(d.path))];
  const numbers = names.map((n) => Number(SLICE_FILE.exec(n)?.[1]?.split("-")[1] ?? 0));
  const id = formatSliceId(Math.max(0, ...numbers) + 1);
  const orders = rebuild.slices.map((s) => s.fm?.data["order"]).filter((o): o is number => typeof o === "number");
  const owner = resolveOwner(options.owner, cwd);
  const text = render(readTemplate(config.lang ?? lang, "slice.md"), {
    id,
    title: cleanTitle,
    order: String(Math.max(0, ...orders) + 1),
    date: options.today ?? todayISO(),
    owner_yaml: yamlScalar(owner),
    rules,
    tests,
  });
  const file = path.posix.join(dir, `${id}-${slug}.md`);
  fs.mkdirSync(path.join(cwd, dir), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), text, { encoding: "utf-8", flag: "wx" });
  out(`created  ${file}  (${id})`);
  if (owner === "TODO") out('note: no owner found (git config user.name is empty); owner is "TODO". Use --owner "<name>".');
  return file;
}

export interface TestPlanOptions extends DocOptions {
  slice?: string;
  stdout?: boolean;
  format?: "md" | "json";
  out?: (text: string) => void;
  err?: (line: string) => void;
}

/**
 * `engkit testplan`: writes the test plan, or prints it (`--stdout`, `--format json`, `--slice`).
 * Exit code: 0 ok, 2 the project cannot be read.
 */
export function runTestPlan(lang: Lang, options: TestPlanOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((t: string) => void process.stdout.write(t));
  const err = options.err ?? ((l: string) => console.error(l));
  try {
    const project = loadProject(cwd);
    const stored = loadConfig(cwd).lang ?? lang;
    const date = options.today ?? todayISO();
    if (options.format === "json") {
      out(JSON.stringify(buildTestPlan(project, options.slice), null, 2) + "\n");
      return 0;
    }
    const text = generateTestPlan(project, stored, date, options.slice);
    // a filtered plan never replaces the full file
    if (options.stdout || options.slice !== undefined) {
      out(text);
      return 0;
    }
    const file = project.rebuild!.paths.testplan;
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text, "utf-8");
    err(`generated  ${file}`);
    return 0;
  } catch (e) {
    if (!(e instanceof CheckSetupError || e instanceof TestPlanError)) throw e;
    err(`error: ${e.message}`);
    return 2;
  }
}

/** `engkit data hash <file>`: the "definition" a results file must carry for this data plan. */
export function runDataHash(file: string, options: { cwd?: string; out?: (l: string) => void; err?: (l: string) => void } = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((l: string) => console.log(l));
  const err = options.err ?? ((l: string) => console.error(l));
  let text: string;
  try {
    text = fs.readFileSync(path.resolve(cwd, file), "utf-8");
  } catch {
    err(`error: File not found: ${file}`);
    return 2;
  }
  const fm = parseFrontmatter(text);
  if (!fm || fm.data["target"] === undefined) {
    err(`error: ${file} is not a data plan (it needs frontmatter with "target").`);
    return 2;
  }
  out(definitionHash(fm));
  return 0;
}
