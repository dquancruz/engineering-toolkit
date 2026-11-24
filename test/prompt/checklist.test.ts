import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChecklistError, loadChecklist, parseChecklist } from "../../src/prompt/checklist.js";
import { ELEMENT_IDS, PRESET_IDS } from "../../src/prompt/model.js";
import { checklistsRoot, LANGS } from "../../src/i18n/index.js";

const root = path.join(import.meta.dirname, "..", "..");

describe("checklists/<lang>/ai-prompt.md (single source)", () => {
  it.each(LANGS)("parses with the 8 elements and 5 presets (%s)", (lang) => {
    const c = loadChecklist(lang);
    expect(Object.keys(c.elements)).toEqual([...ELEMENT_IDS]);
    expect(Object.keys(c.presets)).toEqual([...PRESET_IDS]);
    for (const id of ELEMENT_IDS) {
      const el = c.elements[id];
      expect(el.title, id).not.toBe("");
      expect(el.question, id).not.toBe("");
      expect(el.example, id).not.toBe("");
      expect(el.checks.length, id).toBeGreaterThan(0);
    }
    for (const id of PRESET_IDS) {
      expect(c.presets[id].limits.length, id).toBeGreaterThan(0);
      expect(c.presets[id].verify.length, id).toBeGreaterThan(0);
    }
    expect(c.elements.done.weak.length).toBeGreaterThan(0);
    expect(c.elements.done.checkable.length).toBeGreaterThan(0);
    expect(c.strings.claudeLimit).toContain("{file}");
  });

  it("keeps es and en in sync (same ids, same number of checks, signals and preset items)", () => {
    const es = loadChecklist("es");
    const en = loadChecklist("en");
    for (const id of ELEMENT_IDS) {
      expect(es.elements[id].checks.length, id).toBe(en.elements[id].checks.length);
      expect(es.elements[id].weak.length > 0, id).toBe(en.elements[id].weak.length > 0);
      expect(es.elements[id].checkable.length > 0, id).toBe(en.elements[id].checkable.length > 0);
    }
    for (const id of PRESET_IDS) {
      expect(es.presets[id].limits.length, id).toBe(en.presets[id].limits.length);
      expect(es.presets[id].verify.length, id).toBe(en.presets[id].verify.length);
    }
  });

  it("uses titles in its own language", () => {
    expect(loadChecklist("es").elements.goal.title).toBe("Objetivo");
    expect(loadChecklist("en").elements.goal.title).toBe("Goal");
  });

  it("stays readable: HTML comments only mark ids, labels are plain bold lines", () => {
    for (const lang of LANGS) {
      const text = fs.readFileSync(path.join(checklistsRoot(), lang, "ai-prompt.md"), "utf-8");
      const comments = [...text.matchAll(/<!--(.*?)-->/g)].map((m) => m[1]!.trim());
      expect(comments.every((c) => /^(element|preset): \w+$|^(limits|verify)$/.test(c)), lang).toBe(true);
      // consecutive label lines must be separated by a blank line or they merge into one paragraph
      expect(/^\*\*[^\n]+\n\*\*/m.test(text), lang).toBe(false);
    }
  });

  it("is shipped in the npm package", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("checklists");
  });
});

describe("parseChecklist errors", () => {
  const good = fs.readFileSync(path.join(checklistsRoot(), "en", "ai-prompt.md"), "utf-8");

  it("rejects a missing element", () => {
    expect(() => parseChecklist(good.replace("<!-- element: autonomy -->", ""), "en")).toThrow(/missing the element "autonomy"/);
  });
  it("rejects an unknown element and an unknown preset", () => {
    expect(() => parseChecklist(good.replace("element: goal", "element: nope"), "en")).toThrow(ChecklistError);
    expect(() => parseChecklist(good.replace("preset: bugfix", "preset: nope"), "en")).toThrow(/known id/);
  });
  it("rejects a missing question or frontmatter", () => {
    expect(() => parseChecklist(good.replace("**Question:** What do you want to achieve, in one sentence?", ""), "en")).toThrow(/no "Question" line/);
    expect(() => parseChecklist("# no frontmatter", "en")).toThrow(/frontmatter/);
  });
});
