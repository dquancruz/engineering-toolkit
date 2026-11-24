import fs from "node:fs";
import path from "node:path";
import { docPath, loadConfig } from "../config.js";
import { resolveOwner, todayISO, type DocOptions } from "../docs/context.js";
import { formatAdrNumber, nextAdrNumber, slugify } from "../docs/adr.js";
import { parseFrontmatter, setFrontmatterField } from "../docs/frontmatter.js";
import { formatPendingId, nextPendingNumber } from "../docs/pending.js";
import { readTemplate, type Lang } from "../i18n/index.js";
import { render } from "../docs/render.js";

export const PENDING_TYPES = ["review", "question"] as const;
export type PendingType = (typeof PENDING_TYPES)[number];

/**
 * `engkit new adr "<title>"`: creates the next ADR with status `proposed`.
 * Starts from the project's own ADR template when it still exists, else from the shipped one.
 */
export function runNewAdr(title: string, lang: Lang, options: DocOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const adrDir = docPath(config, "adrDir");
  const templateFile = docPath(config, "adrTemplate");

  const cleanTitle = title.trim();
  const slug = slugify(cleanTitle);
  if (slug === "") throw new Error("The ADR title must contain letters or numbers.");

  const number = nextAdrNumber(path.join(cwd, adrDir));
  const id = `ADR-${formatAdrNumber(number)}`;
  const date = options.today ?? todayISO();
  const owner = resolveOwner(options.owner, cwd);

  const templateAbs = path.join(cwd, templateFile);
  let text: string;
  if (fs.existsSync(templateAbs)) {
    text = fs.readFileSync(templateAbs, "utf-8");
  } else {
    // The project's template was removed: fall back to the shipped one.
    const vars = { date, owner, owner_yaml: owner };
    text = render(readTemplate(lang, "adr.md"), vars);
  }
  if (!parseFrontmatter(text)) {
    throw new Error(`${templateFile} has no valid frontmatter; fix it or delete it to use the built-in template.`);
  }

  text = setFrontmatterField(text, "id", id);
  text = setFrontmatterField(text, "status", "proposed");
  text = setFrontmatterField(text, "date", date);
  text = setFrontmatterField(text, "owner", owner);
  text = setFrontmatterField(text, "supersedes", "");
  text = setFrontmatterField(text, "superseded_by", "");
  const heading = `# ${id}: ${cleanTitle}`;
  text = /^# .*$/m.test(text) ? text.replace(/^# .*$/m, () => heading) : `${text.trimEnd()}\n\n${heading}\n`;

  const file = path.posix.join(adrDir, `${formatAdrNumber(number)}-${slug}.md`);
  const abs = path.join(cwd, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, { encoding: "utf-8", flag: "wx" });
  console.log(`created  ${file}  (${id}, status: proposed)`);
  return file;
}

export interface NewPendingOptions extends DocOptions {
  type?: PendingType;
}

/** `engkit new pendiente [title]`: appends the next P-xx entry to the pending file. */
export function runNewPending(title: string | undefined, lang: Lang, options: NewPendingOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const file = docPath(config, "pending");
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs)) throw new Error(`${file} does not exist. Run "engkit init" first.`);

  const date = options.today ?? todayISO();
  const owner = resolveOwner(options.owner, cwd);
  const type = options.type ?? "question";

  let text = fs.readFileSync(abs, "utf-8");
  const id = formatPendingId(nextPendingNumber(text));
  const heading = (title ?? "").trim() || "TODO";

  const entry = [
    `### ${id}: ${heading}`,
    "",
    `- type: ${type}`,
    "- status: open",
    `- owner: ${owner}`,
    `- date: ${date}`,
    "",
    lang === "es"
      ? "TODO: describe el pendiente y enlaza a la fuente."
      : "TODO: describe the item and link to the source.",
    "",
  ].join("\n");

  // This is a status document: keep its visible date and frontmatter date current.
  if (parseFrontmatter(text)) text = setFrontmatterField(text, "date", date);
  text = text.replace(/\d{4}-\d{2}-\d{2}(?=\.? <!-- engkit:date -->)/, date);
  text = `${text.trimEnd()}\n\n${entry}`;
  fs.writeFileSync(abs, text, "utf-8");
  console.log(`added  ${id} to ${file}`);
  return id;
}
