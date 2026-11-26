import fs from "node:fs";
import path from "node:path";
import type { RebuildPaths } from "../config.js";
import { extractTitle } from "../docs/adr.js";
import { parseFrontmatter, type ParsedDoc } from "../docs/frontmatter.js";
import type { PendingEntry } from "../docs/pending.js";
import { parseRegister } from "../docs/register.js";
import { SLICE_FILE } from "./model.js";

export interface RebuildDoc {
  /** Project-relative path with "/" separators. */
  file: string;
  text: string;
  fm: ParsedDoc | null;
}

export interface Slice extends RebuildDoc {
  id: string;
  title: string;
}

export interface Rebuild {
  paths: RebuildPaths;
  plan: RebuildDoc | null;
  risks: PendingEntry[];
  /** Sorted by file name. */
  slices: Slice[];
  strangler: RebuildDoc | null;
  data: RebuildDoc[];
  /** Markdown files of the slices folder whose name does not follow `SL-01-slug.md`. */
  unexpected: string[];
}

function readDoc(cwd: string, file: string): RebuildDoc | null {
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const text = fs.readFileSync(abs, "utf-8");
  return { file, text, fm: parseFrontmatter(text) };
}

function markdownFiles(cwd: string, dir: string): string[] {
  const abs = path.join(cwd, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md").sort();
}

export function loadRebuild(cwd: string, paths: RebuildPaths): Rebuild {
  const plan = readDoc(cwd, paths.plan);
  const rebuild: Rebuild = {
    paths,
    plan,
    risks: plan ? parseRegister(plan.text, "K") : [],
    slices: [],
    strangler: paths.strangler ? readDoc(cwd, paths.strangler) : null,
    data: [],
    unexpected: [],
  };
  for (const name of markdownFiles(cwd, paths.slicesDir)) {
    const file = path.posix.join(paths.slicesDir, name);
    const m = SLICE_FILE.exec(name);
    if (!m) {
      rebuild.unexpected.push(file);
      continue;
    }
    const doc = readDoc(cwd, file)!;
    const title = doc.fm ? extractTitle(doc.fm.body).replace(/^SL-\d+\s*[:\-–]\s*/i, "") : "";
    rebuild.slices.push({ ...doc, id: m[1]!, title });
  }
  if (paths.dataDir) {
    rebuild.data = markdownFiles(cwd, paths.dataDir).map((n) => readDoc(cwd, path.posix.join(paths.dataDir!, n))!);
  }
  return rebuild;
}
