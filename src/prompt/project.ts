import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { findAdrFile, formatAdrNumber, listAdrs, parseAdrRef } from "../docs/adr.js";
import { parsePendingEntries } from "../docs/pending.js";
import { visibleText } from "../check/text.js";
import type { Checklist } from "./checklist.js";

export class ProjectRefError extends Error {}

export interface ProjectInfo {
  /** Accepted ADRs. */
  adrs: { id: string; file: string; title: string }[];
  /** Open pending items, with the line of their heading. */
  pendings: { id: string; file: string; line: number; title: string }[];
  /** CLAUDE.md (null when the project has none) and how many real rules it has. */
  claude: { file: string; rules: number } | null;
  adrDir: string;
  pendingFile: string;
}

/** Lines under the rules/constraints sections of CLAUDE.md that are not TODO placeholders. */
function countRules(text: string): number {
  const lines = visibleText(text).split("\n");
  let inRules = false;
  let count = 0;
  for (const line of lines) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      inRules = /^(reglas|restricciones|rules|constraints)\b/i.test(h[1]!.trim());
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (inRules && item && !/^TODO\b/i.test(item[1]!.trim())) count++;
  }
  return count;
}

/** Project documents that the prompt can point to, or null when there is no initialized project in `cwd`. */
export function loadProjectInfo(cwd: string): ProjectInfo | null {
  let config;
  try {
    config = loadConfig(cwd);
  } catch {
    return null;
  }
  const paths = config.paths;
  if (!paths?.adrDir || !paths.pending) return null;

  const { adrs } = listAdrs(path.join(cwd, paths.adrDir));
  const accepted = adrs
    .filter((a) => a.status === "accepted")
    .map((a) => ({ id: a.id, file: path.posix.join(paths.adrDir!, a.file), title: a.title }));

  const pendings: ProjectInfo["pendings"] = [];
  const pendingAbs = path.join(cwd, paths.pending);
  if (fs.existsSync(pendingAbs)) {
    for (const e of parsePendingEntries(visibleText(fs.readFileSync(pendingAbs, "utf-8")))) {
      if (e.fields["status"]?.value === "open") pendings.push({ id: e.id, file: paths.pending, line: e.line, title: e.title });
    }
  }

  let claude: ProjectInfo["claude"] = null;
  if (paths.claude && fs.existsSync(path.join(cwd, paths.claude))) {
    const text = fs.readFileSync(path.join(cwd, paths.claude), "utf-8");
    claude = { file: paths.claude, rules: countRules(text) };
  }
  return { adrs: accepted, pendings, claude, adrDir: paths.adrDir, pendingFile: paths.pending };
}

/** Reference lines for the prompt: a path (and line), never the document's content. */
export const adrLine = (a: ProjectInfo["adrs"][number]) => `${a.file} (${a.id}${a.title ? `: ${a.title}` : ""})`;
export const pendingLine = (p: ProjectInfo["pendings"][number]) => `${p.file}:${p.line} (${p.id}${p.title ? `: ${p.title}` : ""})`;
export const claudeLine = (file: string, checklist: Checklist) => checklist.strings.claudeLimit.replace("{file}", file);

export const adrToken = (id: string) => `@adr:${id}`;
export const pendingToken = (id: string) => `@pending:${id}`;
export const CLAUDE_TOKEN = "@claude";

/**
 * Turns `@adr:ADR-0003`, `@pending:P-04` and `@claude` into reference lines.
 * Any other text is returned unchanged. A token that does not resolve is an error.
 */
export function resolveToken(item: string, info: ProjectInfo | null, checklist: Checklist, cwd: string): string {
  if (!item.startsWith("@")) return item;
  if (!info) {
    throw new ProjectRefError(`"${item}" needs an initialized project (.engkit.json). Run "engkit init" or use a plain path.`);
  }

  if (item === CLAUDE_TOKEN) {
    if (!info.claude) throw new ProjectRefError(`"@claude": the project has no CLAUDE.md.`);
    return claudeLine(info.claude.file, checklist);
  }

  const adr = /^@adr:(.+)$/.exec(item);
  if (adr) {
    const number = parseAdrRef(adr[1]!);
    const id = number === null ? null : `ADR-${formatAdrNumber(number)}`;
    const found = info.adrs.find((a) => a.id === id);
    if (found) return adrLine(found);
    const exists = number !== null && number > 0 && findAdrFile(path.join(cwd, info.adrDir), number);
    throw new ProjectRefError(
      exists
        ? `"${item}": ${id} exists but is not accepted. Only accepted ADRs are offered as material; use its path as plain text to include it anyway.`
        : `"${item}": no such ADR in ${info.adrDir}.`
    );
  }

  const pending = /^@pending:(P-\d+)$/i.exec(item);
  if (pending) {
    const found = info.pendings.find((p) => p.id.toUpperCase() === pending[1]!.toUpperCase());
    if (found) return pendingLine(found);
    throw new ProjectRefError(`"${item}": no open pending item with that ID in ${info.pendingFile}.`);
  }

  throw new ProjectRefError(`Unknown reference "${item}". Use @adr:ADR-0003, @pending:P-04 or @claude.`);
}
