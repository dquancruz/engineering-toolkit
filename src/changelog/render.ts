import type { Lang } from "../i18n/index.js";
import type { Entry } from "./commits.js";

export const SECTION_IDS = ["breaking", "feat", "fix", "perf", "docs", "refactor", "test", "build", "ci", "style", "chore", "revert", "other"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Types left out unless `--all` is given (a breaking change is always listed). */
const HIDDEN = new Set<SectionId>(["docs", "refactor", "test", "build", "ci", "style", "chore", "revert"]);

const TITLES: Record<Lang, Record<SectionId, string>> = {
  es: {
    breaking: "Cambios incompatibles",
    feat: "Funcionalidades",
    fix: "Correcciones",
    perf: "Rendimiento",
    docs: "Documentación",
    refactor: "Refactorizaciones",
    test: "Pruebas",
    build: "Compilación",
    ci: "Integración continua",
    style: "Estilo",
    chore: "Tareas",
    revert: "Reversiones",
    other: "Otros",
  },
  en: {
    breaking: "Breaking changes",
    feat: "Features",
    fix: "Fixes",
    perf: "Performance",
    docs: "Documentation",
    refactor: "Refactoring",
    test: "Tests",
    build: "Build",
    ci: "CI",
    style: "Style",
    chore: "Chores",
    revert: "Reverts",
    other: "Other",
  },
};

const EMPTY: Record<Lang, string> = { es: "Sin cambios que listar.", en: "No changes to list." };

/**
 * Makes commit text safe to publish: outside code spans, `@name` goes in backticks (GitHub would notify
 * that account from release notes) and `<` is escaped so a message cannot open an HTML tag or comment.
 */
export function escapeText(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/</g, "&lt;").replace(/(^|[^\w`.])@([A-Za-z0-9](?:[\w./-]*[A-Za-z0-9_])?)/g, "$1`@$2`")
    )
    .join("");
}

function sectionOf(entry: Entry): SectionId {
  if (entry.breaking) return "breaking";
  const type = entry.type;
  return type !== null && type !== "breaking" && (SECTION_IDS as readonly string[]).includes(type) ? (type as SectionId) : "other";
}

function line(entry: Entry): string {
  // a message that is not conventional (or has an unknown type) keeps its whole subject
  const keepsType = sectionOf(entry) === "other" && entry.type !== null;
  const scope = entry.scope ? `**${escapeText(entry.scope)}:** ` : "";
  const subject = keepsType
    ? escapeText(`${entry.type}${entry.scope ? `(${entry.scope})` : ""}: ${entry.description}`)
    : `${scope}${escapeText(entry.description)}`;
  const note = entry.breaking?.note ? `\n  ${escapeText(entry.breaking.note)}` : "";
  return `- ${subject} (${entry.sha.slice(0, 7)})${note}`;
}

export interface RenderOptions {
  lang: Lang;
  release: string;
  /** YYYY-MM-DD */
  date: string;
  all?: boolean;
}

export interface Rendered {
  /** The `## [release] - date` section, ending with one newline. */
  text: string;
  /** How many commits were left out (0 with `all`). */
  omitted: number;
}

export function renderSection(entries: Entry[], options: RenderOptions): Rendered {
  const out = [`## [${options.release}] - ${options.date}`];
  let listed = 0;
  for (const id of SECTION_IDS) {
    if (!options.all && HIDDEN.has(id)) continue;
    const items = entries.filter((e) => sectionOf(e) === id);
    if (items.length === 0) continue;
    listed += items.length;
    out.push("", `### ${TITLES[options.lang][id]}`, "", ...items.map(line));
  }
  if (listed === 0) out.push("", EMPTY[options.lang]);
  return { text: out.join("\n") + "\n", omitted: entries.length - listed };
}
