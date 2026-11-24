import path from "node:path";
import type { Lang } from "../i18n/index.js";

/** Documents managed by engkit. `init` stores the path of each one in `.engkit.json`. */
export const DOC_KEYS = [
  "adrDir",
  "adrTemplate",
  "log",
  "claude",
  "agents",
  "glossary",
  "pending",
  "design",
  "decisions",
] as const;
export type DocKey = (typeof DOC_KEYS)[number];
export type DocPaths = Record<DocKey, string>;

/** Default (language-specific) paths. Only used by `init`; every other command reads `.engkit.json`. */
export const DEFAULT_PATHS: Record<Lang, DocPaths> = {
  es: {
    adrDir: "docs/adr",
    adrTemplate: "docs/adr/0000-plantilla.md",
    log: "BITACORA.md",
    claude: "CLAUDE.md",
    agents: "AGENTS.md",
    glossary: "docs/glosario.md",
    pending: "docs/pendientes.md",
    design: "docs/diseno-vigente.md",
    decisions: "docs/DECISIONES.md",
  },
  en: {
    adrDir: "docs/adr",
    adrTemplate: "docs/adr/0000-template.md",
    log: "LOG.md",
    claude: "CLAUDE.md",
    agents: "AGENTS.md",
    glossary: "docs/glossary.md",
    pending: "docs/pending.md",
    design: "docs/current-design.md",
    decisions: "docs/DECISIONS.md",
  },
};

/** Documents created from a shipped template (`templates/<lang>/<template>`). */
export const TEMPLATE_DOCS: { key: DocKey; template: string }[] = [
  { key: "adrTemplate", template: "adr.md" },
  { key: "log", template: "log.md" },
  { key: "claude", template: "claude.md" },
  { key: "agents", template: "agents.md" },
  { key: "glossary", template: "glossary.md" },
  { key: "pending", template: "pending.md" },
  { key: "design", template: "design.md" },
];

/** Relative markdown link from the directory of `fromFile` to `toFile` (both project-relative). */
export function relativeLink(fromFile: string, toFile: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel === "" ? path.posix.basename(toFile) : rel;
}
