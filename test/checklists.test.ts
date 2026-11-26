import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKLIST_IDS, checklistPromptItems, loadGenericChecklist, parseGenericChecklist } from "../src/checklists/generic.js";
import { checklistsRoot, LANGS } from "../src/i18n/index.js";
import { loadChecklist } from "../src/prompt/checklist.js";
import { PRESET_IDS, SUGGESTED_CHECKLIST } from "../src/prompt/model.js";
import { parseFrontmatter } from "../src/docs/frontmatter.js";

const text = (id: string, lang: string) => fs.readFileSync(path.join(checklistsRoot(), lang, `${id}.md`), "utf-8");

describe.each(CHECKLIST_IDS)("checklist %s", (id) => {
  it.each(LANGS)("parses, with id and lang in its frontmatter and a usage line (%s)", (lang) => {
    const c = loadGenericChecklist(id, lang);
    expect(c.id).toBe(id);
    expect(parseFrontmatter(text(id, lang))?.data["lang"]).toBe(lang);
    expect(c.title).not.toBe("");
    expect(text(id, lang)).toMatch(lang === "es" ? /Cuándo usarlo:/ : /When to use it:/);
  });

  it("is the same in es and en: sections, items and variants", () => {
    const shape = (lang: "es" | "en") => {
      const c = loadGenericChecklist(id, lang);
      return {
        sections: c.sections.map((s) => [s.id, s.checks.length]),
        prompt: [c.prompt.limits.length, c.prompt.verify.length],
        variants: c.variants.map((v) => [v.id, v.limits.length, v.verify.length]),
      };
    };
    expect(shape("es")).toEqual(shape("en"));
  });
});

describe("contents", () => {
  it("code review has a section and a prompt variant per PR type", () => {
    const c = loadGenericChecklist("code-review", "en");
    const types = ["feature", "bugfix", "refactor", "docs", "dependencies"];
    expect(c.sections.map((s) => s.id)).toEqual(["common", ...types]);
    expect(c.variants.map((v) => v.id)).toEqual(types);
    for (const v of c.variants) expect(v.limits.length * v.verify.length, v.id).toBeGreaterThan(0);
  });

  it("the threat model covers the six STRIDE categories", () => {
    expect(loadGenericChecklist("threat-model", "es").sections.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        "spoofing", "tampering", "repudiation", "information-disclosure", "denial-of-service", "elevation-of-privilege",
      ])
    );
  });

  it("suggests only existing checklists for the presets", () => {
    expect(Object.keys(SUGGESTED_CHECKLIST)).toEqual([...PRESET_IDS]);
    expect(Object.keys(loadChecklist("en").presets)).toEqual([...PRESET_IDS]);
  });

  it("puts the checklist items before the variant's", () => {
    const base = checklistPromptItems("code-review", "en");
    const bugfix = checklistPromptItems("code-review:bugfix", "en");
    expect(bugfix.limits.slice(0, base.limits.length)).toEqual(base.limits);
    expect(bugfix.verify.length).toBeGreaterThan(base.verify.length);
  });

  it.each([
    ["nope", /Unknown checklist/],
    ["ai-prompt", /Unknown checklist/],
    ["../x", /Unknown checklist/],
    ["code-review:nope", /no variant "nope"/],
    ["threat-model:web", /no variants/],
    ["code-review:bugfix:x", /Unknown checklist/],
  ])("rejects %s", (spec, message) => expect(() => checklistPromptItems(spec, "en")).toThrow(message));

  it.each([
    ["no frontmatter", (t: string) => t.replace(/^---[\s\S]*?---\n/, ""), /frontmatter/],
    ["an unmarked section", (t: string) => t.replace("<!-- section: assets -->", ""), /needs <!-- section/],
    ["a repeated section", (t: string) => t.replace("section: tampering", "section: spoofing"), /twice/],
    ["a missing prompt block", (t: string) => t.slice(0, t.indexOf("## For a prompt")), /needs limits and verification/],
  ])("reports %s", (_name, change, message) => {
    expect(() => parseGenericChecklist(change(text("threat-model", "en")))).toThrow(message);
  });
});
