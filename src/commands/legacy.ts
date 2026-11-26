import fs from "node:fs";
import path from "node:path";
import YAML, { Scalar, isMap, isSeq } from "yaml";
import { deletedFiles } from "../check/git.js";
import { openQuestions } from "../check/rules/legacy.js";
import { loadProject } from "../check/project.js";
import { CONFIG_FILE, LOCAL_CONFIG_FILE, evidenceRoots, loadConfig, updateConfigFile, type LegacyPaths } from "../config.js";
import { slugify } from "../docs/adr.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { render } from "../docs/render.js";
import { readTemplate, type Lang } from "../i18n/index.js";
import { EvidenceReader, EvidenceRefError, formatRef, hashLines, isWeak, parseRef, verify, type EvidenceRef } from "../legacy/evidence.js";
import { evidenceOf, loadLegacy, type Legacy, type LegacyItem } from "../legacy/load.js";
import { DIR_KEY, ITEM_KINDS, formatItemId, itemFilePattern, type ItemKind } from "../legacy/model.js";
import { generateRulesIndex } from "../legacy/rules-index.js";

export const DEFAULT_LEGACY_PATHS: Record<Lang, LegacyPaths> = {
  es: { rulesDir: "docs/reglas", testsDir: "docs/pruebas", defectsDir: "docs/defectos", sources: "docs/fuentes.md", rulesIndex: "docs/REGLAS.md" },
  en: { rulesDir: "docs/rules", testsDir: "docs/acceptance", defectsDir: "docs/defects", sources: "docs/sources.md", rulesIndex: "docs/RULES.md" },
};

const TEMPLATE: Record<ItemKind, string> = { rule: "rn.md", test: "pa.md", defect: "defect.md" };

export interface Output {
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const streams = (o: Output) => ({ out: o.out ?? ((l: string) => console.log(l)), err: o.err ?? ((l: string) => console.error(l)) });

function legacyProject(cwd: string): Legacy {
  const paths = loadConfig(cwd).legacy;
  if (!paths) throw new Error(`${CONFIG_FILE} has no "legacy" section. Run "engkit init --profile legacy" first.`);
  return loadLegacy(cwd, paths);
}

/** IDs of the open pending items, or none in a project without the base documents. */
function questionsOf(cwd: string): Set<string> {
  return loadConfig(cwd).paths ? openQuestions(loadProject(cwd)) : new Set();
}

/** Regenerates the rule index. Returns the file written. */
export function runRulesIndex(lang: Lang, options: DocOptions & Output = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const { out } = streams(options);
  const legacy = legacyProject(cwd);
  const stored = loadConfig(cwd).lang ?? lang;
  const file = legacy.paths.rulesIndex;
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), generateRulesIndex(stored, legacy, questionsOf(cwd), options.today ?? todayISO()), "utf-8");
  out(`generated  ${file}`);
  return file;
}

// ---------------------------------------------------------------- init

/** `engkit init --profile legacy`: additive; existing files and settings are kept. */
export function runInitLegacy(lang: Lang, options: DocOptions & Output & { dryRun?: boolean } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const { out } = streams(options);
  const dryRun = options.dryRun === true;
  const date = options.today ?? todayISO();
  const owner = resolveOwner(options.owner, cwd);
  const config = loadConfig(cwd);
  const paths = config.legacy ?? DEFAULT_LEGACY_PATHS[config.lang ?? lang];
  const would = dryRun ? "would " : "";

  if (!config.legacy || !config.evidenceRoots) {
    if (!dryRun) {
      updateConfigFile(cwd, (raw) => ({ ...raw, lang: raw["lang"] ?? lang, legacy: paths, evidenceRoots: raw["evidenceRoots"] ?? {} }));
    }
    out(`${would}update  ${CONFIG_FILE}  (legacy, evidenceRoots)`);
  }

  for (const kind of ITEM_KINDS) if (!dryRun) fs.mkdirSync(path.join(cwd, paths[DIR_KEY[kind]]), { recursive: true });

  const sources = path.join(cwd, paths.sources);
  if (fs.existsSync(sources)) out(`skipped  ${paths.sources} (already exists)`);
  else {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(sources), { recursive: true });
      fs.writeFileSync(sources, render(readTemplate(config.lang ?? lang, "sources.md"), { date, owner_yaml: yamlScalar(owner) }), "utf-8");
    }
    out(`${dryRun ? "would create" : "created"}  ${paths.sources}`);
  }

  if (fs.existsSync(path.join(cwd, paths.rulesIndex))) out(`skipped  ${paths.rulesIndex} (already exists)`);
  else if (dryRun) out(`would create  ${paths.rulesIndex}`);
  else runRulesIndex(lang, options);

  const ignore = path.join(cwd, ".gitignore");
  const current = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf-8") : "";
  if (!current.split(/\r?\n/).includes(LOCAL_CONFIG_FILE)) {
    const lead = current === "" || current.endsWith("\n") ? "" : "\n";
    if (!dryRun) fs.writeFileSync(ignore, `${current}${lead}\n# Evidence root paths of this machine (engkit)\n${LOCAL_CONFIG_FILE}\n`, "utf-8");
    out(`${would}update  .gitignore  (${LOCAL_CONFIG_FILE})`);
  }

  if (!config.paths && !dryRun) out('note: "engkit check" also needs the base documents: run "engkit init".');
  out(`note: declare where the old code lives in ${CONFIG_FILE}, e.g. "evidenceRoots": { "erp": { "path": "../old-erp" } }`);
}

// ---------------------------------------------------------------- new

export interface NewItemOptions extends DocOptions, Output {
  area?: string;
  rule?: string[];
  defect?: string[];
  source?: string[];
  question?: string[];
}

/** `engkit new rn|pa|defecto "<title>"`. Returns the file created. Links are validated before writing. */
export function runNewItem(kind: ItemKind, title: string, lang: Lang, options: NewItemOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const { out } = streams(options);
  const legacy = legacyProject(cwd);
  const stored = loadConfig(cwd).lang ?? lang;

  const cleanTitle = title.trim().replace(/\s+/g, " ");
  const slug = slugify(cleanTitle);
  if (slug === "") throw new Error("The title must contain letters or numbers.");

  const check = (values: string[] | undefined, known: Set<string>, what: string) => {
    for (const v of values ?? []) if (!known.has(v)) throw new Error(`${what} ${v} does not exist${what === "Question" ? " or is not open" : ""}.`);
    return `[${[...new Set(values ?? [])].join(", ")}]`;
  };
  const rules = check(options.rule, new Set(legacy.items.rule.map((i) => i.id)), "Rule");
  const defects = check(options.defect, new Set(legacy.items.defect.map((i) => i.id)), "Defect");
  const questions = check(options.question, options.question?.length ? questionsOf(cwd) : new Set(), "Question");
  const expected = check(options.source, new Set(legacy.sources?.entries.map((e) => e.id)), "Source");
  const code = (options.source ?? []).find((s) => legacy.sources?.entries.find((e) => e.id === s)?.fields["type"]?.value === "code");
  if (code) throw new Error(`${code} is of type "code": the expected result of a test cannot come from code.`);

  const dir = legacy.paths[DIR_KEY[kind]];
  // an ID is never reused, so deleted files count too
  const names = [
    ...legacy.items[kind].map((i) => path.posix.basename(i.file)),
    ...deletedFiles(cwd, dir).map((d) => path.posix.basename(d.path)),
  ];
  const numbers = names.map((n) => itemFilePattern(kind).exec(n)?.[1]).map((id) => (id ? Number(id.split("-")[1]) : 0));
  const id = formatItemId(kind, Math.max(0, ...numbers) + 1);
  const owner = resolveOwner(options.owner, cwd);

  const text = render(readTemplate(stored, TEMPLATE[kind]), {
    id,
    title: cleanTitle,
    date: options.today ?? todayISO(),
    owner_yaml: yamlScalar(owner),
    area: options.area?.trim() ? ` ${yamlScalar(options.area.trim())}` : "",
    rules,
    defects,
    questions,
    expected_source: expected,
  });
  const file = path.posix.join(dir, `${id}-${slug}.md`);
  fs.mkdirSync(path.join(cwd, dir), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), text, { encoding: "utf-8", flag: "wx" });
  out(`created  ${file}  (${id})`);
  if (owner === "TODO") out('note: no owner found (git config user.name is empty); owner is "TODO". Use --owner "<name>".');
  runRulesIndex(lang, options);
  return file;
}

// ---------------------------------------------------------------- evidence

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const quoted = (value: string) => {
  const node = new Scalar(value);
  node.type = Scalar.QUOTE_DOUBLE;
  return node;
};

interface Change {
  /** Current text of the `ref`, or null to append a new entry. */
  at: string | null;
  ref: string;
  hash: string;
  commit: string | null;
}

/** Edits only the `evidence` entries of the frontmatter; comments and the body stay. */
function writeEvidence(cwd: string, item: LegacyItem, changes: Change[]): void {
  const text = fs.readFileSync(path.join(cwd, item.file), "utf-8");
  const block = FRONTMATTER.exec(text)?.[1];
  if (block === undefined) throw new Error(`${item.file} has no valid frontmatter.`);
  const doc = YAML.parseDocument(block);

  let list = doc.get("evidence");
  if (!isSeq(list) || list.items.length === 0) {
    list = doc.createNode([]);
    doc.set("evidence", list);
  }
  if (!isSeq(list)) throw new Error(`${item.file}: "evidence" must be a list.`);
  list.flow = false;

  for (const change of changes) {
    let entry = change.at === null ? undefined : list.items.find((e) => isMap(e) && String(e.get("ref")) === change.at);
    if (!isMap(entry)) {
      entry = doc.createNode({});
      list.items.push(entry);
    }
    if (!isMap(entry)) continue;
    entry.flow = false;
    entry.set("ref", change.ref);
    entry.set("hash", quoted(change.hash));
    if (change.commit) entry.set("commit", quoted(change.commit));
    else entry.delete("commit");
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const next = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd().replace(/\r?\n/g, eol);
  const offset = text.indexOf("\n") + 1;
  fs.writeFileSync(path.join(cwd, item.file), text.slice(0, offset) + next + text.slice(offset + block.length), "utf-8");
}

const citing = (legacy: Legacy) => [...legacy.items.rule, ...legacy.items.defect];

function findItem(legacy: Legacy, id: string): LegacyItem {
  const found = citing(legacy).filter((i) => i.id === id.toUpperCase());
  if (found.length !== 1) {
    throw new EvidenceRefError(found.length === 0 ? `${id} is not a rule (RN-) or defect (D-) of this project.` : `${id} is used by more than one file.`);
  }
  const item = found[0]!;
  if (!item.fm || evidenceOf(item) === null) throw new EvidenceRefError(`${item.file}: fix its frontmatter first ("engkit check").`);
  return item;
}

/**
 * `engkit evidence add <ID> <root:path:lines>`: records the reference with the hash of those lines.
 * Exit code: 0 ok, 1 it could not be verified or differs from the recorded one, 2 bad input.
 */
export function runEvidenceAdd(id: string, text: string, options: DocOptions & Output = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const { out, err } = streams(options);
  try {
    const item = findItem(legacyProject(cwd), id);
    const ref: EvidenceRef = parseRef(text);
    const reader = new EvidenceReader(cwd, evidenceRoots(cwd));
    const root = reader.root(ref.root);
    if (!root.available) {
      err(`error: evidence root "${ref.root}" (${root.configured}) is not available. Set its path in ${LOCAL_CONFIG_FILE}.`);
      return 1;
    }
    const lines = reader.lines(ref);
    if (lines === null) throw new EvidenceRefError(`${ref.path} does not exist in the root "${ref.root}".`);
    if (ref.end > lines.length) throw new EvidenceRefError(`${ref.path} has ${lines.length} line(s).`);

    const range = lines.slice(ref.start - 1, ref.end);
    const hash = hashLines(range);
    const formatted = formatRef(ref);
    const existing = evidenceOf(item)!.find((e) => e.ref === formatted || e.ref === text);
    if (existing?.hash !== undefined && existing.hash !== null) {
      if (existing.hash === hash) {
        out(`unchanged  ${item.id}  ${formatted} (already recorded)`);
        return 0;
      }
      err(`error: ${item.id} already cites ${formatted} with other content. Read it again, then "engkit evidence update --accept ${item.id}".`);
      return 1;
    }
    writeEvidence(cwd, item, [{ at: existing?.ref ?? null, ref: formatted, hash, commit: reader.commit(ref) }]);
    out(`recorded  ${item.id}  ${formatted}  hash ${hash}`);
    if (isWeak(range)) err("warning: these lines are too short to be told apart from others; cite more context.");
    return 0;
  } catch (e) {
    if (!(e instanceof EvidenceRefError)) throw e;
    err(`error: ${e.message}`);
    return 2;
  }
}

/**
 * `engkit evidence update [IDs...]`: rewrites the line numbers of evidence that moved. Content that changed
 * is only recorded again for the IDs in `accept`, after someone has re-read the rule.
 * Exit code: 0 everything is up to date, 1 something needs review, 2 bad input.
 */
export function runEvidenceUpdate(ids: string[], options: DocOptions & Output & { accept?: string[] } = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const { out, err } = streams(options);
  try {
    const legacy = legacyProject(cwd);
    const accept = new Set((options.accept ?? []).map((i) => findItem(legacy, i).id));
    const named = [...new Set([...ids.map((i) => findItem(legacy, i).id), ...accept])];
    const items = named.length > 0 ? named.map((i) => findItem(legacy, i)) : citing(legacy).filter((i) => i.fm && evidenceOf(i));
    const reader = new EvidenceReader(cwd, evidenceRoots(cwd));

    let review = 0;
    let updated = 0;
    for (const item of items) {
      const changes: Change[] = [];
      for (const entry of evidenceOf(item)!) {
        if (entry.ref === undefined) continue;
        const needs = (why: string) => {
          review++;
          err(`review    ${item.id}  ${entry.ref}  ${why}`);
        };
        try {
          const ref = parseRef(entry.ref);
          if (!reader.root(ref.root).available) {
            needs(`not verified: root "${ref.root}" is not available`);
            continue;
          }
          const lines = reader.lines(ref);
          const verdict = verify(ref, typeof entry.hash === "string" ? entry.hash : null, lines);
          if (verdict.state === "ok") continue;
          if (verdict.state === "moved") {
            changes.push({ at: entry.ref, ref: formatRef(verdict.to), hash: entry.hash as string, commit: reader.commit(verdict.to) });
            out(`moved     ${item.id}  ${entry.ref} -> ${formatRef(verdict.to)}`);
          } else if (verdict.state === "missing-file") needs("the file does not exist");
          else if (verdict.state === "unrecorded") needs(`has no hash: use "engkit evidence add ${item.id} ${entry.ref}"`);
          else if (lines === null || ref.end > lines.length) needs("is past the end of the file: replace the reference");
          else if (accept.has(item.id)) {
            const hash = hashLines(lines.slice(ref.start - 1, ref.end));
            changes.push({ at: entry.ref, ref: entry.ref, hash, commit: reader.commit(ref) });
            out(`accepted  ${item.id}  ${entry.ref}  (new content recorded)`);
          } else needs(`${verdict.state}: read it again, then use --accept ${item.id}`);
        } catch (e) {
          if (!(e instanceof EvidenceRefError)) throw e;
          needs(e.message);
        }
      }
      if (changes.length > 0) {
        writeEvidence(cwd, item, changes);
        updated += changes.length;
      }
    }
    out(`${updated} reference(s) updated, ${review} to review.`);
    return review > 0 ? 1 : 0;
  } catch (e) {
    if (!(e instanceof EvidenceRefError)) throw e;
    err(`error: ${e.message}`);
    return 2;
  }
}
