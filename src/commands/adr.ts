import fs from "node:fs";
import path from "node:path";
import { docPath, loadConfig } from "../config.js";
import { findAdrFile, formatAdrNumber, isTodoOrEmpty, parseAdrRef } from "../docs/adr.js";
import { todayISO, type DocOptions } from "../docs/context.js";
import { parseFrontmatter, setFrontmatterField } from "../docs/frontmatter.js";
import type { Lang } from "../i18n/index.js";
import { runIndex } from "./index-cmd.js";

/** Resolves `ADR-0003` / `3` to its file and parsed frontmatter. Throws a clear error otherwise. */
export function resolveAdr(
  cwd: string,
  ref: string
): { file: string; abs: string; text: string; id: string; status: string; owner: unknown } {
  const config = loadConfig(cwd);
  const adrDir = docPath(config, "adrDir");
  const number = parseAdrRef(ref);
  if (number === null) throw new Error(`"${ref}" is not an ADR ID. Use ADR-0003, 0003 or 3.`);
  if (number === 0) throw new Error("ADR-0000 is the template, not a decision.");
  const name = findAdrFile(path.join(cwd, adrDir), number);
  if (!name) throw new Error(`ADR-${formatAdrNumber(number)} not found in ${adrDir}.`);
  const file = path.posix.join(adrDir, name);
  const abs = path.join(cwd, file);
  const text = fs.readFileSync(abs, "utf-8");
  const fm = parseFrontmatter(text);
  if (!fm) throw new Error(`${file} has no valid frontmatter.`);
  return {
    file,
    abs,
    text,
    id: `ADR-${formatAdrNumber(number)}`,
    status: String(fm.data["status"] ?? ""),
    owner: fm.data["owner"],
  };
}

/** `engkit adr accept <ID>`: proposed -> accepted, and `date` = today. */
export function runAdrAccept(ref: string, lang: Lang, options: DocOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const adr = resolveAdr(cwd, ref);

  if (adr.status !== "proposed") {
    throw new Error(`${adr.id} is "${adr.status}"; only a "proposed" ADR can be accepted.`);
  }
  if (isTodoOrEmpty(adr.owner)) {
    throw new Error(`${adr.id} has no owner (owner is TODO or empty). Set "owner" in ${adr.file} before accepting it.`);
  }

  const date = options.today ?? todayISO();
  let text = setFrontmatterField(adr.text, "status", "accepted");
  text = setFrontmatterField(text, "date", date);
  fs.writeFileSync(adr.abs, text, "utf-8");
  console.log(`accepted  ${adr.id}  (${adr.file}, date: ${date})`);

  runIndex(lang, options);
  return adr.file;
}
