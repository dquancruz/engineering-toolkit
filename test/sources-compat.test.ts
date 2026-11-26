import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "../src/commands/check.js";
import { runNewItem } from "../src/commands/legacy.js";
import { loadConfig } from "../src/config.js";
import { source } from "./legacy/helpers.js";
import { TODAY, cleanup, init, initLog, read, write } from "./rebuild/helpers.js";

afterEach(cleanup);

/** `.engkit.json` as engkit 0.6.0 wrote it: the register inside "legacy", at a path the user changed. */
const OLD_LEGACY = {
  rulesDir: "docs/reglas",
  testsDir: "docs/pruebas",
  defectsDir: "docs/defectos",
  sources: "docs/origenes.md",
  rulesIndex: "docs/REGLAS.md",
};

let dir: string;
let register: string;
beforeEach(async () => {
  dir = await init(["base", "legacy"]);
  const { sources: _new, ...config } = JSON.parse(read(dir, ".engkit.json"));
  write(dir, ".engkit.json", JSON.stringify({ ...config, legacy: OLD_LEGACY, custom: true }, null, 2));
  fs.renameSync(path.join(dir, "docs/fuentes.md"), path.join(dir, "docs/origenes.md"));
  fs.appendFileSync(path.join(dir, "docs/origenes.md"), source("F-01", "person") + source("F-02", "code"));
  register = read(dir, "docs/origenes.md");
});

const config = () => JSON.parse(read(dir, ".engkit.json"));
const findings = () => {
  const r = runCheck("es", { cwd: dir, today: TODAY });
  return [...r.errors, ...r.warnings].map((f) => `${f.severity} ${f.rule} ${f.file}`).filter((f) => !f.includes("git-history"));
};
const io = () => ({ cwd: dir, owner: "Jane Doe", today: TODAY, out: () => {} });
const draftRuleAndTest = (sourceId: string) => {
  runNewItem("rule", "Late fee", "es", io());
  runNewItem("test", "Day 31", "es", { ...io(), rule: ["RN-0001"], source: [sourceId] });
};

describe("a project created with 0.6.0 (legacy.sources)", () => {
  it("keeps working without changes", () => {
    const before = read(dir, ".engkit.json");
    draftRuleAndTest("F-01");
    expect(findings()).toEqual([]);
    expect(() => runNewItem("test", "x", "es", { ...io(), source: ["F-02"] })).toThrow(/cannot come from code/);
    expect(loadConfig(dir).sources).toEqual({ doc: "docs/origenes.md" });
    expect(read(dir, ".engkit.json")).toBe(before);
  });

  it("still validates the register and the references to it", () => {
    draftRuleAndTest("F-01");
    fs.appendFileSync(path.join(dir, "docs/origenes.md"), source("F-03", "rumour"));
    fs.appendFileSync(path.join(dir, "CLAUDE.md"), "\nF-77\n");
    expect(findings().sort()).toEqual(["error broken-ref CLAUDE.md", "error source-entry docs/origenes.md"]);
  });

  it.each([["legacy"], ["base"], ["agent"]] as const)("running init --profile %s moves the path and nothing else", async (profile) => {
    draftRuleAndTest("F-01");
    const before = findings();
    const old = config();
    await init([profile], { cwd: dir, yes: true });
    expect(initLog).toContain('moved "legacy.sources"');
    const { sources: _removed, ...legacy } = old.legacy;
    expect(config()).toMatchObject({ sources: { doc: "docs/origenes.md" }, legacy, custom: true });
    expect(config().legacy).not.toHaveProperty("sources");
    expect(read(dir, "docs/origenes.md")).toBe(register);
    expect(fs.existsSync(path.join(dir, "docs/fuentes.md"))).toBe(false);
    expect(findings()).toEqual(before);
  });

  it("migrates once", async () => {
    await init(["legacy"], { cwd: dir });
    const migrated = read(dir, ".engkit.json");
    await init(["legacy"], { cwd: dir });
    expect(initLog).not.toContain("moved");
    expect(read(dir, ".engkit.json")).toBe(migrated);
  });

  it("--dry-run announces the move and writes nothing", async () => {
    const before = read(dir, ".engkit.json");
    await init(["legacy"], { cwd: dir, dryRun: true });
    expect(initLog).toContain("would update");
    expect(initLog).toContain('moved "legacy.sources"');
    expect(read(dir, ".engkit.json")).toBe(before);
  });

  it.each([["requirements"], ["rebuild"]] as const)("adding %s reuses the same register", async (profile) => {
    await init([profile], { cwd: dir });
    expect(config().sources).toEqual({ doc: "docs/origenes.md" });
    expect(read(dir, "docs/origenes.md")).toBe(register);
    expect(fs.existsSync(path.join(dir, "docs/fuentes.md"))).toBe(false);
    if (profile === "rebuild") expect(read(dir, "docs/reconstruccion/plan.md")).toContain("(../origenes.md)");
  });
});

describe("the sources section", () => {
  const patch = (value: object) => write(dir, ".engkit.json", JSON.stringify({ ...config(), ...value }));

  it("accepts both places when they agree, and refuses when they differ", () => {
    patch({ sources: { doc: "docs/origenes.md" } });
    expect(findings()).toEqual([]);
    patch({ sources: { doc: "docs/otro.md" } });
    expect(() => loadConfig(dir)).toThrow(/differ/);
  });

  it.each([
    [{ sources: "docs/x.md" }, /"sources" must be an object/],
    [{ sources: { doc: "../x.md" } }, /inside the project/],
    [{ legacy: { ...OLD_LEGACY, sources: undefined } }, /needs the sources register/],
  ])("rejects %j", (value, message) => {
    patch(value);
    expect(() => loadConfig(dir)).toThrow(message);
  });
});
