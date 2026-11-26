import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { checklistPromptItems } from "../../src/checklists/generic.js";
import { loadChecklist } from "../../src/prompt/checklist.js";
import { tmpDir } from "../helpers.js";
import { FakeAsker, run } from "./helpers.js";

const goal = { goal: "Fix the 500 on POST /orders" };
const dod = checklistPromptItems("definition-of-done", "en");
const preset = loadChecklist("en").presets.bugfix;

describe("engkit prompt --checklist", () => {
  it("adds its limits and verification after the preset's and before the user's", async () => {
    const dir = tmpDir();
    const r = await run(dir, { ...goal, preset: "bugfix", checklist: ["definition-of-done"], limit: ["mine"] }, {}, "en");
    expect(r.code).toBe(0);
    const at = (s: string) => r.out.indexOf(`- ${s}`);
    expect(at(preset.limits[0]!)).toBeGreaterThan(0);
    expect(at(dod.limits[0]!)).toBeGreaterThan(at(preset.limits.at(-1)!));
    expect(at("mine")).toBeGreaterThan(at(dod.limits.at(-1)!));
    for (const v of dod.verify) expect(r.out).toContain(v);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is not added without the flag", async () => {
    const r = await run(tmpDir(), { ...goal, preset: "bugfix" }, {}, "en");
    for (const v of dod.verify) expect(r.out).not.toContain(v);
  });

  it("exits 2 for an unknown checklist, without asking anything", async () => {
    const asker = new FakeAsker({});
    const r = await run(tmpDir(), { checklist: ["nope"] }, { asker, isTTY: true });
    expect(r.code).toBe(2);
    expect(r.err).toContain("Unknown checklist");
    expect(asker.calls).toEqual([]);
  });

  const guided = (kind: string, accept: boolean, variant?: string) =>
    new FakeAsker({
      select: (o) => (o.message.startsWith("What kind of task") ? kind : variant),
      confirm: (o) => (o.message.startsWith("Also add") ? accept : false),
    });
  const offers = (asker: FakeAsker) => asker.calls.filter((c) => c.message.startsWith("Also add"));

  it("guided mode offers the checklist of the preset, with no as the default", async () => {
    const asker = guided("bugfix", false);
    const r = await run(tmpDir(), {}, { asker, isTTY: true }, "en");
    expect(offers(asker)).toMatchObject([{ initialValue: false }]);
    expect(offers(asker)[0]!.message).toContain("Definition of Done");
    for (const v of dod.verify) expect(r.out).not.toContain(v);
  });

  it("adds it when accepted, asking the PR type for a code review", async () => {
    const asker = guided("review", true, "docs");
    const r = await run(tmpDir(), {}, { asker, isTTY: true }, "en");
    for (const v of checklistPromptItems("code-review:docs", "en").verify) expect(r.out).toContain(v);
  });

  it("offers nothing for research or without a preset", async () => {
    for (const kind of ["research", "none"]) {
      const asker = guided(kind, true);
      await run(tmpDir(), {}, { asker, isTTY: true }, "en");
      expect(offers(asker), kind).toEqual([]);
    }
  });

  it("with only --checklist stays guided, pre-fills it and does not offer it again", async () => {
    const asker = guided("feature", true);
    const r = await run(tmpDir(), { checklist: ["definition-of-done"] }, { asker, isTTY: true }, "en");
    expect(offers(asker)).toEqual([]);
    for (const v of dod.verify) expect(r.out).toContain(v);
  });
});
