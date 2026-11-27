import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LANG, LANGS, MESSAGES, resolveLang, translator } from "../src/i18n.js";

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(MESSAGES.es) as (keyof typeof MESSAGES.es)[];
const source = (file: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", file), "utf-8");
const union = (name: string) => [...new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(source("core/notice.ts"))![1]!.matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);

describe("translations", () => {
  it("both languages have the same keys and parameters, and no empty text", () => {
    expect(Object.keys(MESSAGES.en)).toEqual(keys);
    for (const key of keys) {
      for (const lang of LANGS) expect(MESSAGES[lang][key].trim(), `${lang} ${key}`).not.toBe("");
      expect(params(MESSAGES.en[key]), key).toEqual(params(MESSAGES.es[key]));
    }
  });

  it("every notice and error of the core has a message", () => {
    for (const code of union("NoticeCode")) expect(keys).toContain(`notice.${code}`);
    for (const code of union("ErrorCode")) expect(keys).toContain(`error.${code}`);
  });

  it.each(LANGS)("explains catastrophic backtracking in the timeout message (%s)", (lang) => {
    const text = translator(lang)("regex.timeout", { seconds: 1.5 });
    expect(text).toContain("1.5");
    expect(text).toMatch(/backtracking/i);
    expect(text).toMatch(lang === "es" ? /cuantificadores anidados/ : /nested or overlapping quantifiers/);
    expect(text).toContain("(a+)+");
  });
});

describe("the slow evaluation warning", () => {
  it.each(LANGS)("explains it and says that results may be missing (%s)", (lang) => {
    const text = translator(lang)("regex.slow");
    expect(text).toMatch(/backtracking/i);
    expect(text).toMatch(lang === "es" ? /pueden faltar resultados.*cuantificadores anidados/ : /results may be missing.*nested or overlapping quantifiers/);
  });
});

describe("language choice", () => {
  it("?lang= wins, then the saved preference, then Spanish", () => {
    expect(DEFAULT_LANG).toBe("es");
    expect(resolveLang("?lang=en", "es")).toBe("en");
    expect(resolveLang("", "en")).toBe("en");
    expect(resolveLang("?lang=fr", "de")).toBe("es");
    expect(resolveLang("", null)).toBe("es");
  });
});
