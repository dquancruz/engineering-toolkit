import fs from "node:fs";
import path from "node:path";
import { EXAMPLE_FILE, envSources } from "../env/files.js";
import { readEnvNames, type EnvProblem } from "../env/parse.js";

// Rule of this module: values are never printed or written. Only variable names, file names, line numbers
// and fixed messages leave it.

export interface EnvCommandOptions {
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

interface FileProblem extends EnvProblem {
  file: string;
}

interface ReadFile {
  file: string;
  names: string[];
  problems: FileProblem[];
}

function read(cwd: string, file: string): ReadFile {
  let text: string;
  try {
    text = fs.readFileSync(path.resolve(cwd, file), "utf-8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown error";
    return { file, names: [], problems: [{ file, line: 0, reason: `cannot be read (${code})` }] };
  }
  const result = readEnvNames(text);
  return { file, names: result.names, problems: result.problems.map((p) => ({ file, ...p })) };
}

const where = (p: FileProblem) => (p.line > 0 ? `${p.file}:${p.line}` : p.file);

function streams(options: EnvCommandOptions) {
  return {
    cwd: options.cwd ?? process.cwd(),
    out: options.out ?? ((l: string) => console.log(l)),
    err: options.err ?? ((l: string) => console.error(l)),
  };
}

/**
 * `engkit env example`: creates `.env.example` with `NAME=` lines, or appends the missing names to it.
 * Existing lines are never rewritten; values and comments are never copied. Exit code: 0 ok, 2 cannot do it.
 */
export function runEnvExample(options: EnvCommandOptions = {}): number {
  const { cwd, out, err } = streams(options);
  const target = path.join(cwd, EXAMPLE_FILE);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) {
    err(`error: ${EXAMPLE_FILE} is not a regular file (a symlink could point to a file with values). Nothing was written.`);
    return 2;
  }

  const sources = envSources(cwd).map((f) => read(cwd, f));
  if (sources.length === 0) {
    err("error: no .env files here to read variable names from.");
    return 2;
  }
  const existing = stat ? read(cwd, EXAMPLE_FILE) : null;
  const problems = [...sources, ...(existing ? [existing] : [])].flatMap((f) => f.problems);
  if (problems.length > 0) {
    for (const p of problems) err(`error: ${where(p)}: ${p.reason}`);
    err("Nothing was written. Fix those lines first (their content is not shown).");
    return 2;
  }

  const have = new Set(existing?.names ?? []);
  const missing = [...new Set(sources.flatMap((s) => s.names))].filter((n) => !have.has(n));
  if (missing.length === 0) {
    out(`${EXAMPLE_FILE} is up to date (${have.size} variable(s)).`);
    return 0;
  }

  const current = existing ? fs.readFileSync(target, "utf-8") : "";
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const lead = current === "" || current.endsWith("\n") ? "" : eol;
  fs.appendFileSync(target, lead + missing.map((n) => `${n}=${eol}`).join(""), { encoding: "utf-8", flag: existing ? "a" : "ax" });
  out(`${existing ? "updated" : "created"}  ${EXAMPLE_FILE}: added ${missing.join(", ")}`);
  return 0;
}

export interface EnvCheckReport {
  ok: boolean;
  /** `.env.example`, or "union" of the compared files when there is no example. */
  reference: string;
  files: { file: string; missing: string[]; extra: string[] }[];
  errors: FileProblem[];
}

/**
 * `engkit env check [files...]`: which variables each file lacks, compared with `.env.example` (or with all
 * the files together). Exit code: 0 nothing missing, 1 missing variables, 2 cannot compare.
 */
export function runEnvCheck(files: string[], options: EnvCommandOptions & { json?: boolean } = {}): number {
  const { cwd, out, err } = streams(options);
  const examplePath = path.join(cwd, EXAMPLE_FILE);
  const targets = (files.length > 0 ? files : envSources(cwd)).filter((f) => path.resolve(cwd, f) !== examplePath);
  if (targets.length === 0) {
    err("error: no .env files to compare.");
    return 2;
  }

  const example = fs.existsSync(examplePath) ? read(cwd, EXAMPLE_FILE) : null;
  const compared = targets.map((f) => read(cwd, f));
  const errors = [...(example ? [example] : []), ...compared].flatMap((f) => f.problems);
  const usable = compared.filter((f) => f.problems.length === 0);

  // With a broken reference (or a broken file inside the union) a comparison would be misleading.
  const comparable = example ? example.problems.length === 0 : errors.length === 0;
  const reference = example ? example.names : [...new Set(usable.flatMap((f) => f.names))];
  const results = comparable
    ? usable.map((f) => ({
        file: f.file,
        missing: reference.filter((n) => !f.names.includes(n)),
        extra: example ? f.names.filter((n) => !reference.includes(n)) : [],
      }))
    : [];

  const missing = results.some((r) => r.missing.length > 0);
  const code = errors.length > 0 ? 2 : missing ? 1 : 0;
  const report: EnvCheckReport = { ok: code === 0, reference: example ? EXAMPLE_FILE : "union", files: results, errors };

  if (options.json) {
    out(JSON.stringify(report, null, 2));
    return code;
  }
  for (const p of errors) err(`error: ${where(p)}: ${p.reason}`);
  if (!comparable) return code;
  out(`reference: ${example ? EXAMPLE_FILE : `all variables of ${targets.join(", ")} (no ${EXAMPLE_FILE})`}`);
  for (const r of results) {
    if (r.missing.length === 0) out(`ok       ${r.file}`);
    else out(`missing  ${r.file}: ${r.missing.join(", ")}`);
    if (r.extra.length > 0) out(`warning  ${r.file}: not in ${EXAMPLE_FILE}: ${r.extra.join(", ")}`);
  }
  return code;
}
