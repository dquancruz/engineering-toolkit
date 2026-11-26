import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNewItem } from "../../src/commands/legacy.js";
import { runNewSlice } from "../../src/commands/rebuild.js";
import { parseExtras } from "../../src/commands/init.js";
import { TODAY, check, cleanup, edit, field, init, initLog, read, rebuildProject, reindex, testplan, write } from "./helpers.js";

afterEach(cleanup);

const PLAN = "docs/reconstruccion/plan.md";
const io = (dir: string) => ({ cwd: dir, owner: "Jane Doe", today: TODAY, out: () => {} });
const confirmedRule = (dir: string, title: string) => {
  const file = runNewItem("rule", title, "es", io(dir));
  edit(dir, file, "status: draft", "status: confirmed");
  field(dir, file, "evidence", "\n  - source: F-01");
  return file;
};

describe("engkit init --profile rebuild", () => {
  it("adds legacy and requirements with a notice", async () => {
    const dir = await init(["base", "rebuild"]);
    expect(initLog).toContain('needs "legacy"');
    expect(initLog).toContain('needs "requirements"');
    const config = JSON.parse(read(dir, ".engkit.json"));
    expect(Object.keys(config)).toEqual(expect.arrayContaining(["legacy", "requirements", "rebuild"]));
    expect(config.rebuild).not.toHaveProperty("strangler");
    expect(config.rebuild).not.toHaveProperty("dataDir");
    expect(fs.existsSync(path.join(dir, "docs/reconstruccion/estrangulador.md"))).toBe(false);
    expect(check(dir).errors).toEqual([]);
  });

  it("--with adds the optional plans, also later", async () => {
    const dir = await init(["base", "rebuild"], { extras: ["strangler"] });
    await init(["rebuild"], { cwd: dir, extras: ["data"] });
    expect(initLog).not.toContain('needs "legacy"');
    const config = JSON.parse(read(dir, ".engkit.json"));
    expect(config.rebuild.strangler).toBe("docs/reconstruccion/estrangulador.md");
    expect(config.rebuild.dataDir).toBe("docs/reconstruccion/datos");
    expect(check(dir).errors).toEqual([]);
  });

  it("works with the other profiles listed and in English", async () => {
    const dir = await init(["base", "legacy", "requirements", "rebuild"], { extras: ["strangler", "data"] }, "en");
    expect(initLog).not.toContain("needs");
    expect(check(dir).errors).toEqual([]);
    expect(read(dir, "docs/rebuild/plan.md")).toContain("[Requirements and constraints](../requirements.md)");
  });

  it("--dry-run writes nothing", async () => {
    const dir = await init(["rebuild"], { dryRun: true, extras: ["data"] });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(initLog).toContain("would create");
  });

  it("validates --with and the configuration", async () => {
    expect(parseExtras("data, strangler,data")).toEqual(["data", "strangler"]);
    expect(() => parseExtras("nope")).toThrow(/Invalid --with/);
    await expect(init(["base"], { extras: ["data"] })).rejects.toThrow(/only applies/);
    const dir = await init(["base", "rebuild"]);
    const config = JSON.parse(read(dir, ".engkit.json"));
    delete config.requirements;
    write(dir, ".engkit.json", JSON.stringify(config));
    expect(() => check(dir)).toThrow(/"rebuild" needs/);
  });
});

describe("slices and plan", () => {
  it("a complete project passes check --strict", async () => {
    const { dir } = await rebuildProject();
    expect(check(dir, { strict: true })).toMatchObject({ errors: [], warnings: [] });
  });

  it.each(["confirmed", "modified"])("warns about a %s rule in no slice, unless excluded with a reason", async (status) => {
    const { dir } = await rebuildProject();
    const rule = confirmedRule(dir, "Another");
    if (status === "modified") edit(dir, rule, "status: confirmed", "status: modified");
    reindex(dir);
    expect(check(dir).warnings).toContain("rule-unplanned RN-0002");
    field(dir, PLAN, "excluded", "\n  - rule: RN-0002\n    reason: an external service does it");
    expect(check(dir).warnings).not.toContain("rule-unplanned RN-0002");
  });

  it("does not ask drafts, disputed or discarded rules to be planned", async () => {
    const { dir } = await rebuildProject();
    for (const status of ["draft", "disputed", "discarded"]) {
      const rule = runNewItem("rule", status, "es", io(dir));
      field(dir, rule, "status", status === "draft" ? "draft # new" : status);
    }
    expect(check(dir).warnings.filter((w) => w.startsWith("rule-unplanned"))).toEqual([]);
  });

  it.each([
    ["without reason", "\n  - rule: RN-0001", "plan-excluded plan.md"],
    ["of an unknown rule", "\n  - { rule: RN-0009, reason: x }", "broken-ref plan.md"],
    ["with an unknown ADR", "\n  - { rule: RN-0001, reason: x, decision: ADR-0009 }", "broken-ref plan.md"],
  ])("rejects an exclusion %s", async (_name, value, expected) => {
    const { dir } = await rebuildProject();
    field(dir, PLAN, "excluded", value);
    expect(check(dir).errors).toContain(expected);
  });

  it("warns when a rule is both planned and excluded", async () => {
    const { dir } = await rebuildProject();
    field(dir, PLAN, "excluded", "\n  - { rule: RN-0001, reason: x }");
    expect(check(dir).warnings).toContain("plan-excluded SL-01");
  });

  it("warns about slices without tests, uncovered rules and discarded rules", async () => {
    const { dir, rule, slice } = await rebuildProject();
    field(dir, slice, "tests", "[]");
    expect(check(dir).warnings).toContain("slice-untested SL-01");
    field(dir, slice, "tests", "[PA-0001]");
    confirmedRule(dir, "Uncovered");
    field(dir, slice, "rules", "[RN-0001, RN-0002]");
    expect(check(dir).warnings).toContain("slice-rule-untested SL-01");
    edit(dir, rule, "status: confirmed", "status: discarded");
    expect(check(dir).warnings).toContain("slice-discarded-rule SL-01");
  });

  it.each([
    ["no done criterion", "done", "[]", "slice-done SL-01"],
    ["a criterion without verify", "done", "\n  - text: x", "slice-done SL-01"],
    ["a criterion verified by prose", "done", "\n  - { text: x, verify: look at it }", "slice-done SL-01"],
    ["an unknown PA in a criterion", "done", "\n  - { text: x, verify: PA-0009 }", "broken-ref SL-01"],
    ["a bad status", "status", "started", "frontmatter SL-01"],
    ["a bad order", "order", "first", "slice-order SL-01"],
    ["an unknown rule", "rules", "[RN-0009]", "broken-ref SL-01"],
    ["an unknown requirement", "requirements", "[RNF-99]", "broken-ref SL-01"],
    ["an unknown constraint", "constraints", "[RES-99]", "broken-ref SL-01"],
    ["an unknown risk", "risks", "[K-99]", "broken-ref SL-01"],
    ["an unknown question", "questions", "[P-99]", "broken-ref SL-01"],
    ["an unknown decision", "decisions", "[ADR-0099]", "broken-ref SL-01"],
    ["a missing owner", "owner", "TODO", "todo-field SL-01"],
  ])("is an error: %s", async (_name, key, value, expected) => {
    const { dir, slice } = await rebuildProject();
    field(dir, slice, key, value);
    expect(check(dir).errors).toContain(expected);
  });

  it("a done slice needs its tests ready", async () => {
    const { dir, slice, test } = await rebuildProject();
    field(dir, slice, "status", "done");
    expect(check(dir).errors).toEqual([]);
    edit(dir, test, "status: ready", "status: draft");
    expect(check(dir).errors).toContain("slice-done SL-01");
  });

  it("numbers slices, keeps orders unique and ignores dropped slices for planning", async () => {
    const { dir, slice } = await rebuildProject();
    const second = runNewSlice("Second", "es", io(dir));
    expect(second).toContain("SL-02-second.md");
    expect(read(dir, second)).toContain("order: 2");
    field(dir, second, "order", "1");
    expect(check(dir).errors).toContain("slice-order SL-02");
    field(dir, second, "status", "dropped");
    expect(check(dir).errors).toEqual([]);
    field(dir, slice, "status", "dropped");
    expect(check(dir).warnings).toContain("rule-unplanned RN-0001");
    expect(() => runNewSlice("x", "es", { ...io(dir), rule: ["RN-0009"] })).toThrow(/does not exist/);
  });

  it("validates risks", async () => {
    const { dir, slice } = await rebuildProject();
    fs.appendFileSync(path.join(dir, PLAN), "\n### K-01: Data quality\n\n- probability: high\n- impact: medium\n- mitigation: profile early\n- owner: Jane Doe\n");
    field(dir, slice, "risks", "[K-01]");
    expect(check(dir).errors).toEqual([]);
    edit(dir, PLAN, "- impact: medium", "- impact: huge");
    edit(dir, PLAN, "- mitigation: profile early\n", "");
    expect(check(dir).errors).toEqual(["risk-entry plan.md", "risk-entry plan.md"]);
  });
});

describe("engkit testplan", () => {
  it("links the cases and criteria, without copying the tests", async () => {
    const { dir, test } = await rebuildProject();
    edit(dir, test, "TODO: resultado esperado", "SECRET-OUTCOME resultado");
    const r = testplan(dir);
    expect(r.code).toBe(0);
    const text = read(dir, "docs/plan-de-pruebas.md");
    expect(text).toContain("### [SL-01](reconstruccion/rebanadas/SL-01-charge-the-fee.md): Charge the fee (planned)");
    expect(text).toContain("| [PA-0001](pruebas/PA-0001-day-31.md) | Day 31 | RN-0001 | F-01 | ready |");
    expect(text).toContain("| The agreed cases pass | PA-0001 |");
    expect(text).toContain("| [RNF-01](requisitos.md) |");
    expect(text).toContain("Ninguno detectado.");
    expect(text).not.toContain("SECRET-OUTCOME");
    expect(check(dir, { strict: true }).errors).toEqual([]);
  });

  it("lists the gaps", async () => {
    const { dir, slice } = await rebuildProject();
    confirmedRule(dir, "Orphan");
    field(dir, slice, "tests", "[]");
    field(dir, slice, "done", "\n  - text: x");
    edit(dir, "docs/requisitos.md", "- verify: `npm run perf`\n", "");
    const text = testplan(dir, { stdout: true }).out;
    for (const line of [
      "- Reglas sin prueba: RN-0002",
      "- Reglas sin rebanada: RN-0002",
      "- Rebanadas sin prueba: SL-01",
      "- Requisitos sin verificación: RNF-01",
      "- Criterios sin verificación: SL-01 #1",
    ]) expect(text).toContain(line);
  });

  it("--stdout, --slice and --format json print and do not write", async () => {
    const { dir } = await rebuildProject();
    expect(testplan(dir, { stdout: true }).out).toContain("# Plan de pruebas");
    expect(testplan(dir, { slice: "SL-01" }).out).toContain("SL-01");
    const json = JSON.parse(testplan(dir, { format: "json" }).out);
    expect(json.slices[0]).toMatchObject({ id: "SL-01", order: 1, cases: [{ id: "PA-0001", rules: ["RN-0001"], expectedSource: ["F-01"] }] });
    expect(fs.existsSync(path.join(dir, "docs/plan-de-pruebas.md"))).toBe(false);
    expect(testplan(dir, { slice: "SL-09" })).toMatchObject({ code: 2, err: expect.stringContaining("SL-09") });
    expect(testplan(await init(["base"])).code).toBe(2);
  });

  it("is deterministic and reported when stale", async () => {
    const { dir, slice } = await rebuildProject();
    testplan(dir);
    const first = read(dir, "docs/plan-de-pruebas.md");
    testplan(dir, { today: "2027-01-01" });
    expect(read(dir, "docs/plan-de-pruebas.md").replace("2027-01-01", TODAY)).toBe(first);
    expect(check(dir).warnings).not.toContain("testplan-stale plan-de-pruebas.md");
    field(dir, slice, "status", "in-progress");
    expect(check(dir).warnings).toContain("testplan-stale plan-de-pruebas.md");
  });
});
