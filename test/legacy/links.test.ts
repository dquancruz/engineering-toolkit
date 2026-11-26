import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdrAccept } from "../../src/commands/adr.js";
import { runNewAdr, runNewPending } from "../../src/commands/new.js";
import { git } from "../git-helpers.js";
import { captureConsole } from "../helpers.js";
import { TODAY, check, commit, create, edit, evidence, project, read, reindex, source, write, type Fixture } from "./helpers.js";

let f: Fixture;
beforeEach(() => void (f = project()));
afterEach(() => f.cleanup());

const status = (file: string, value: string) => edit(f.dir, file, /^status: .*$/m, `status: ${value}`);
const field = (file: string, key: string, value: string) => edit(f.dir, file, new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
const question = () => captureConsole(() => runNewPending("Confirm the fee", "es", { cwd: f.dir, owner: "Jane Doe", today: TODAY }));
const adr = (accept = true) =>
  captureConsole(() => {
    runNewAdr("Change the fee", "es", { cwd: f.dir, owner: "Jane Doe", today: TODAY });
    if (accept) runAdrAccept("ADR-0001", "es", { cwd: f.dir, today: TODAY });
  });

/** A confirmed rule with evidence and a ready test. */
function confirmed() {
  const rule = create(f.dir, "rule", "Late fee", { area: "billing" });
  expect(evidence(f.dir, "add", ["RN-0001", "erp:src/fee.cbl:2-4"]).code).toBe(0);
  status(rule, "confirmed");
  const test = create(f.dir, "test", "Day 31", { rule: ["RN-0001"], source: ["F-01"] });
  status(test, "ready");
  reindex(f.dir);
  return { rule, test };
}

describe("a legacy project", () => {
  it("is clean right after init", () => {
    expect(check(f.dir)).toMatchObject({ errors: [], warnings: [] });
    expect(read(f.dir, ".gitignore")).toContain(".engkit.local.json");
    expect(read(f.dir, "docs/REGLAS.md")).toContain("Todavía no hay reglas");
  });

  it("is clean with a confirmed rule, its evidence and a test", () => {
    confirmed();
    expect(check(f.dir, { strict: true })).toMatchObject({ errors: [], warnings: [] });
  });

  it("accepts drafts without evidence or tests", () => {
    create(f.dir, "rule", "Draft");
    expect(check(f.dir)).toMatchObject({ errors: [], warnings: [] });
  });
});

describe("rule states", () => {
  it("confirmed needs evidence (error), and warns without a test or with an open question", () => {
    const rule = create(f.dir, "rule", "Late fee");
    status(rule, "confirmed");
    reindex(f.dir);
    expect(check(f.dir)).toMatchObject({ errors: ["rule-evidence RN-0001"], warnings: ["rule-untested RN-0001"] });
    question();
    field(rule, "questions", "[P-01]");
    reindex(f.dir);
    expect(check(f.dir).warnings).toContain("rule-question RN-0001");
  });

  it("non-code evidence counts", () => {
    const rule = create(f.dir, "rule", "Late fee");
    status(rule, "confirmed");
    field(rule, "evidence", "\n  - source: F-01");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual([]);
    edit(f.dir, rule, "- source: F-01", "- source: F-99");
    expect(check(f.dir).errors).toEqual(["broken-ref RN-0001"]);
  });

  it("disputed needs an open question", () => {
    const rule = create(f.dir, "rule", "Late fee");
    status(rule, "disputed");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual(["rule-question RN-0001"]);
    question();
    field(rule, "questions", "[P-01]");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual([]);
    edit(f.dir, "docs/pendientes.md", "- status: open", "- status: closed");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual(["rule-question RN-0001"]);
  });

  it("modified needs an ADR and keeps the evidence of the old behaviour", () => {
    const { rule } = confirmed();
    status(rule, "modified");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual(["rule-decision RN-0001"]);

    field(rule, "decision", "ADR-0007");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual(["broken-ref RN-0001"]);

    adr(false);
    field(rule, "decision", "ADR-0001");
    reindex(f.dir);
    expect(check(f.dir)).toMatchObject({ errors: [], warnings: ["rule-decision RN-0001"] });

    captureConsole(() => runAdrAccept("ADR-0001", "es", { cwd: f.dir, today: TODAY }));
    expect(check(f.dir).warnings.filter((w) => w.startsWith("rule-"))).toEqual([]);

    edit(f.dir, rule, /evidence:\n(?: .*\n)+/, "evidence: []\n");
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual(["rule-evidence RN-0001"]);
  });

  it.each(["retired", "done"])("rejects the status %s", (value) => {
    status(create(f.dir, "rule", "Late fee"), value);
    reindex(f.dir);
    expect(check(f.dir).errors).toEqual(["frontmatter RN-0001"]);
  });

  it("warns about tests of discarded rules, whatever their status", () => {
    const { rule, test } = confirmed();
    status(rule, "discarded");
    status(test, "draft");
    reindex(f.dir);
    const only = runWarnings();
    expect(only).toEqual([expect.stringContaining("only covers discarded rules (RN-0001)")]);

    create(f.dir, "rule", "Another");
    field(test, "rules", "[RN-0001, RN-0002]");
    reindex(f.dir);
    expect(runWarnings()).toEqual([expect.stringContaining("points to discarded rules (RN-0001)")]);
    function runWarnings() {
      return check(f.dir).result.warnings.filter((w) => w.rule === "test-discarded-rule").map((w) => w.message);
    }
  });
});

describe("expected_source: the expected result comes from outside the code", () => {
  function testWith(value: string) {
    const { test } = confirmed();
    field(test, "expected_source", value);
    return check(f.dir).errors;
  }

  it.each([
    ["missing", "[]", "expected-source PA-0001"],
    ["unknown", "[F-09]", "broken-ref PA-0001"],
    ["a source of type code", "[F-02]", "expected-source PA-0001"],
    ["a code reference", '["erp:src/fee.cbl:2"]', "expected-source PA-0001"],
    ["a reference to this project", '["self:src/a.ts:2-3"]', "expected-source PA-0001"],
    ["something else", "[the old system]", "expected-source PA-0001"],
    ["one good and one code source", "[F-01, F-02]", "expected-source PA-0001"],
  ])("is an error when it is %s", (_name, value, expected) => {
    expect(testWith(value)).toEqual([expected]);
  });

  it("is an error when the field is absent", () => {
    const { test } = confirmed();
    edit(f.dir, test, /^expected_source:.*\n/m, "");
    expect(check(f.dir).errors).toEqual(["expected-source PA-0001"]);
  });

  it.each(["person", "document", "data", "database", "schema"])("accepts a %s source", (type) => {
    fs.appendFileSync(path.join(f.dir, "docs/fuentes.md"), source("F-03", type));
    expect(testWith("[F-03]")).toEqual([]);
  });

  it("is an error when a non-code source cites an evidence root", () => {
    fs.appendFileSync(path.join(f.dir, "docs/fuentes.md"), source("F-03", "document", " `erp:src/fee.cbl:3`"));
    expect(testWith("[F-03]")).toEqual(["expected-source PA-0001"]);
  });

  it("new pa refuses a code source and unknown links, writing nothing", () => {
    create(f.dir, "rule", "Late fee");
    expect(() => create(f.dir, "test", "x", { source: ["F-02"] })).toThrow(/cannot come from code/);
    expect(() => create(f.dir, "test", "x", { rule: ["RN-0009"] })).toThrow(/RN-0009 does not exist/);
    expect(fs.readdirSync(path.join(f.dir, "docs/pruebas"))).toEqual([]);
  });
});

describe("the sources register", () => {
  const errors = (entry: string) => {
    fs.appendFileSync(path.join(f.dir, "docs/fuentes.md"), entry);
    return check(f.dir).result.errors.map((e) => `${e.rule}: ${e.message}`);
  };

  it.each(["type", "obtained_by", "obtained_on", "method"])("requires %s", (key) => {
    const entry = source("F-03", "person").replace(new RegExp(`^- ${key}:.*\n?`, "m"), "");
    expect(errors(entry)).toEqual([`source-entry: F-03: "${key}" is missing or TODO.`]);
  });

  it.each([
    ["type", "rumour", /"type" must be one of code \| database/],
    ["obtained_on", "2026-02-30", /real date/],
    ["method", "TODO", /missing or TODO/],
    ["obtained_by", "<!-- who -->", /missing or TODO/],
  ])("validates %s = %s", (key, value, message) => {
    const entry = source("F-03", "person").replace(new RegExp(`^- ${key}:.*$`, "m"), `- ${key}: ${value}`);
    expect(errors(entry).join()).toMatch(message);
  });

  it("accepts values written as code and rejects a duplicate ID", () => {
    expect(errors(source("F-03", "data").replace("interview", "`SELECT * FROM fees`"))).toEqual([]);
    expect(errors(source("F-03", "data")).join()).toContain("Duplicate F-03");
  });
});

describe("defects and links", () => {
  it("applies the defect rules", () => {
    const defect = create(f.dir, "defect", "Charged twice");
    expect(check(f.dir)).toMatchObject({ errors: [], warnings: ["defect-question D-0001"] });
    status(defect, "confirmed");
    field(defect, "decision", "fix");
    expect(check(f.dir)).toMatchObject({ errors: ["defect-evidence D-0001"], warnings: ["defect-untested D-0001"] });
    expect(evidence(f.dir, "add", ["D-0001", "erp:src/fee.cbl:6"]).code).toBe(0);
    create(f.dir, "rule", "Late fee");
    create(f.dir, "test", "Once", { rule: ["RN-0001"], source: ["F-01"], defect: ["D-0001"] });
    expect(check(f.dir)).toMatchObject({ errors: [], warnings: [] });
  });

  it("requires a rule in every test and reports broken IDs in fields and bodies", () => {
    const test = create(f.dir, "test", "Orphan", { source: ["F-01"] });
    expect(check(f.dir).errors).toEqual(["test-rule PA-0001"]);
    field(test, "rules", "[RN-0004]");
    field(test, "defects", "[D-0004]");
    fs.appendFileSync(path.join(f.dir, test), "\nSee PA-0009, RN-0008 and F-77.\n");
    fs.appendFileSync(path.join(f.dir, "CLAUDE.md"), "\nSee D-0006.\n");
    const messages = check(f.dir).result.errors.map((e) => e.message).join("\n");
    for (const id of ["RN-0004", "D-0004", "PA-0009", "RN-0008", "F-77", "D-0006"]) expect(messages).toContain(id);
  });

  it("checks ids, owners, file names and field types", () => {
    const rule = create(f.dir, "rule", "Late fee");
    write(f.dir, "docs/reglas/RN-0001-copy.md", read(f.dir, rule));
    write(f.dir, "docs/reglas/rn2.md", "x");
    field(rule, "owner", "TODO");
    field(rule, "questions", "{a: 1}");
    reindex(f.dir);
    const r = check(f.dir);
    expect(r.errors).toEqual(expect.arrayContaining(["unique-id RN-0001", "todo-field RN-0001", "legacy-field RN-0001"]));
    expect(r.warnings).toContain("legacy-file rn2.md");
  });

  it("warns about a deleted rule and never reuses its ID", () => {
    git(f.dir, ["init", "-q"]);
    const rule = create(f.dir, "rule", "Late fee");
    commit(f.dir, "rule");
    fs.rmSync(path.join(f.dir, rule));
    commit(f.dir, "delete");
    reindex(f.dir);
    expect(check(f.dir).warnings).toContain("rule-deleted RN-0001");
    expect(create(f.dir, "rule", "Next")).toContain("RN-0002");
  });
});

describe("rule index", () => {
  it("lists rules by area with their links and counts, and is detected as stale", () => {
    const { rule } = confirmed();
    create(f.dir, "rule", "No area | pipe");
    question();
    field(rule, "questions", "[P-01]");
    create(f.dir, "defect", "Twice", { rule: ["RN-0001"] });
    reindex(f.dir);
    const index = read(f.dir, "docs/REGLAS.md");
    expect(index).toContain("Total: 2 (draft: 1, confirmed: 1)");
    expect(index).toContain("| [RN-0001](reglas/RN-0001-late-fee.md) | Late fee | billing | confirmed | 1 | [PA-0001](pruebas/PA-0001-day-31.md) | [D-0001](defectos/D-0001-twice.md) | P-01 | Jane Doe |");
    expect(index).toContain("No area \\| pipe");
    expect(index.indexOf("RN-0002](")).toBeLessThan(index.indexOf("RN-0001]("));
    expect(check(f.dir).warnings).not.toContain("index-stale REGLAS.md");
    status(rule, "discarded");
    expect(check(f.dir).warnings).toContain("index-stale REGLAS.md");
  });

  it("does not depend on the evidence roots", () => {
    confirmed();
    const before = read(f.dir, "docs/REGLAS.md");
    fs.rmSync(f.old, { recursive: true });
    reindex(f.dir);
    expect(read(f.dir, "docs/REGLAS.md")).toBe(before);
  });
});

describe("without the legacy profile", () => {
  it("ignores RN, PA, D and F in an existing project", () => {
    const config = JSON.parse(read(f.dir, ".engkit.json"));
    delete config.legacy;
    delete config.sources;
    write(f.dir, ".engkit.json", JSON.stringify(config));
    fs.appendFileSync(path.join(f.dir, "CLAUDE.md"), "\nRN-0001 PA-0001 D-0001 F-16\n");
    const r = check(f.dir);
    expect(r).toMatchObject({ errors: [], warnings: [] });
    expect(r.result.summary).not.toHaveProperty("unverifiedEvidence");
  });
});
