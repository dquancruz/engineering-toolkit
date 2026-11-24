import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "es";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Root of the shipped templates (`templates/` next to `dist/`). */
export function templatesRoot(): string {
  return fileURLToPath(new URL("../../templates", import.meta.url));
}

/** Root of the shipped checklists (`checklists/` next to `dist/`). */
export function checklistsRoot(): string {
  return fileURLToPath(new URL("../../checklists", import.meta.url));
}

/** Templates live in `templates/<lang>/<name>`, e.g. `templates/es/adr.md`. */
export function templatePath(lang: Lang, name: string): string {
  return path.join(templatesRoot(), lang, name);
}

export function readTemplate(lang: Lang, name: string): string {
  return readFileSync(templatePath(lang, name), "utf-8");
}

/** Translatable CLI strings. Jira output is intentionally not translated. */
const messages = {
  es: { langSet: "Idioma: español" },
  en: { langSet: "Language: English" },
} as const satisfies Record<Lang, Record<string, string>>;

export type MessageKey = keyof (typeof messages)["es"];

export function t(lang: Lang, key: MessageKey): string {
  return messages[lang][key];
}
