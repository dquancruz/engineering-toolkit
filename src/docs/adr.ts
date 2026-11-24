import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface AdrEntry {
  file: string;
  number: number;
  id: string;
  title: string;
  status: string;
  date: string;
  supersedes: string | null;
  supersededBy: string | null;
}

const ADR_FILE = /^(\d{4})-.+\.md$/;

export function formatAdrNumber(n: number): string {
  return String(n).padStart(4, "0");
}

/** `Decisión: usar Ñandú` -> `decision-usar-nandu` */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Title from the first H1, without the `ADR-NNNN:` prefix. */
export function extractTitle(body: string): string {
  const m = /^#\s+(.+)$/m.exec(body);
  if (!m) return "";
  return (m[1] ?? "").replace(/^ADR-\d+\s*[:\-–]\s*/i, "").trim();
}

/** ADR files in `dir` (excluding the 0000 template), sorted by number. Unreadable ones are reported in `warnings`. */
export function listAdrs(dir: string): { adrs: AdrEntry[]; warnings: string[] } {
  const adrs: AdrEntry[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(dir)) return { adrs, warnings };

  for (const file of fs.readdirSync(dir).sort()) {
    const m = ADR_FILE.exec(file);
    if (!m) continue;
    const number = Number(m[1]);
    if (number === 0) continue;
    const parsed = parseFrontmatter(fs.readFileSync(path.join(dir, file), "utf-8"));
    if (!parsed) {
      warnings.push(`${file}: missing or invalid frontmatter, skipped`);
      continue;
    }
    adrs.push({
      file,
      number,
      id: asString(parsed.data["id"]) ?? `ADR-${formatAdrNumber(number)}`,
      title: extractTitle(parsed.body),
      status: asString(parsed.data["status"]) ?? "?",
      date: asString(parsed.data["date"]) ?? "?",
      supersedes: asString(parsed.data["supersedes"]),
      supersededBy: asString(parsed.data["superseded_by"]),
    });
  }
  return { adrs, warnings };
}

/** Next ADR number: highest existing number + 1 (the 0000 template does not count). */
export function nextAdrNumber(dir: string): number {
  if (!fs.existsSync(dir)) return 1;
  let max = 0;
  for (const file of fs.readdirSync(dir)) {
    const m = ADR_FILE.exec(file);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** `ADR-0003`, `adr-3`, `0003` or `3` -> 3. Returns null when it is not an ADR reference. */
export function parseAdrRef(ref: string): number | null {
  const m = /^(?:ADR-)?(\d+)$/i.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

/** File name of the ADR with this number in `dir`, if any. */
export function findAdrFile(dir: string, number: number): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const file of fs.readdirSync(dir).sort()) {
    const m = ADR_FILE.exec(file);
    if (m && Number(m[1]) === number) return file;
  }
  return null;
}

/** True for an empty owner or the `TODO` placeholder. */
export function isTodoOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const s = String(value).trim();
  return s === "" || s.toUpperCase() === "TODO";
}
