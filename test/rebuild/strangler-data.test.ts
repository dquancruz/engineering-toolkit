import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDataHash } from "../../src/commands/rebuild.js";
import { canonicalDecimal, parseResults } from "../../src/rebuild/data.js";
import { check, cleanup, edit, field, read, rebuildProject, testplan, write } from "./helpers.js";

afterEach(cleanup);

const PLAN = "docs/reconstruccion/estrangulador.md";

interface Table {
  table?: string | undefined;
  writer?: unknown;
  order?: unknown;
  handover?: Record<string, unknown>;
  verify?: string | undefined;
}
const table = (patch: Table = {}, handover: Record<string, unknown> = {}): Table => ({
  table: "billing.invoices",
  writer: "legacy",
  order: 1,
  verify: "`npm run grants`",
  handover: { to: "new", date: "2027-02-01", owner: "Jane Doe", slice: "SL-01", status: "planned", ...handover },
  ...patch,
});

async function strangler(...tables: Table[]) {
  const { dir } = await rebuildProject(["strangler"]);
  // JSON is valid YAML
  field(dir, PLAN, "tables", `\n${tables.map((t) => `  - ${JSON.stringify(t)}`).join("\n")}`);
  const r = check(dir);
  const mine = (list: string[]) => list.filter((f) => f.endsWith("estrangulador.md"));
  return { dir, errors: mine(r.errors).map((f) => f.split(" ")[0]), warnings: mine(r.warnings).map((f) => f.split(" ")[0]), result: r.result };
}

describe("strangler plan", () => {
  it("accepts a planned and a finished handover", async () => {
    const r = await strangler(table(), table({ table: "billing.payments", writer: "new", order: 1 }, { status: "done", date: "2026-01-01" }));
    expect(r).toMatchObject({ errors: [], warnings: [] });
  });

  it.each(["billing.invoices", "Billing.Invoices", '"billing"."invoices"', "[billing].[invoices]", "`billing`.`invoices`", "billing . invoices"])(
    "treats %s as the same table: only one writer",
    async (name) => {
      const r = await strangler(table(), table({ table: name, writer: "new" }, { status: "done" }));
      expect(r.errors).toEqual(["single-writer"]);
    }
  );

  it("points to the repeated entry", async () => {
    const r = await strangler(table(), table());
    const finding = r.result.errors.find((f) => f.rule === "single-writer")!;
    const lines = read(r.dir, PLAN).split("\n");
    expect(finding.line).toBe(lines.findLastIndex((l) => l.includes("billing.invoices")) + 1);
  });

  it.each([["both"], [["legacy", "new"]], [undefined]])("rejects the writer %j", async (writer) => {
    expect((await strangler(table({ writer }))).errors).toEqual(["single-writer"]);
  });

  it("keeps writer and handover consistent", async () => {
    expect((await strangler(table({ writer: "legacy" }, { status: "done" }))).errors).toEqual(["single-writer"]);
    expect((await strangler(table({ writer: "new" }))).errors).toEqual(["single-writer"]);
  });

  it.each(["date", "owner", "slice", "to", "status"])("requires handover.%s", async (key) => {
    expect((await strangler(table({}, { [key]: undefined }))).errors).toEqual(["handover"]);
  });

  it("validates the slice, the order and the names", async () => {
    expect((await strangler(table({}, { slice: "SL-09" }))).errors).toContain("broken-ref");
    expect((await strangler(table({ order: 0 }))).errors).toEqual(["strangler-table"]);
    expect((await strangler(table({ table: undefined }))).errors).toEqual(["strangler-table"]);
  });

  it("warns about overdue, unverified, out of order and ambiguous tables", async () => {
    expect((await strangler(table({}, { date: "2026-01-01" }))).warnings).toEqual(["handover-overdue"]);
    expect((await strangler(table({ verify: undefined }))).warnings).toEqual(["handover-unverified"]);
    const order = await strangler(table({}, { date: "2027-05-01" }), table({ table: "billing.lines", order: 2 }, { date: "2027-04-01" }));
    expect(order.warnings).toEqual(["handover-order"]);
    expect((await strangler(table(), table({ table: "invoices" }))).warnings).toEqual(["strangler-ambiguous"]);
  });

  it("is only checked when configured", async () => {
    const { dir } = await rebuildProject();
    write(dir, PLAN, "---\nid: STRANGLER\ntables: [{}]\n---\n");
    expect(check(dir).errors).toEqual([]);
  });
});

const DATA = "docs/reconstruccion/datos/invoices.md";
const RESULTS = "counts/invoices.json";

const dataPlan = (patch: Record<string, unknown> = {}) => {
  const fm = {
    target: "billing.invoices",
    date: "2026-03-09",
    owner: "Jane Doe",
    sources: ["FACT.FACTURAS"],
    fields: [
      { from: "NUM", to: "number" },
      { from: "FLAG", dropped: "unused", source: "F-01" },
    ],
    cleaning: [{ id: "C-1", rule: "exclude voided", source: "F-01" }],
    transformations: [{ id: "T-1", rule: "one invoice per currency (1:N)" }, { id: "T-2", rule: "merge duplicates" }],
    totals: [{ name: "amount" }, { name: "tax", difference: "C-1" }],
    counts: { command: "`npm run counts`", results: RESULTS },
    ...patch,
  };
  return `---\n${Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n# Invoices\n`;
};

async function data(results: Record<string, unknown> | string | null = {}, patch: Record<string, unknown> = {}) {
  const { dir } = await rebuildProject(["data"]);
  write(dir, DATA, dataPlan(patch));
  let hash = "";
  runDataHash(DATA, { cwd: dir, out: (l) => (hash = l), err: () => {} });
  if (results !== null) {
    const base = {
      definition: hash,
      taken_at: "2027-01-10",
      source: 10000,
      excluded: { "C-1": 120 },
      adjustments: { "T-1": 35, "T-2": -15 },
      target: 9900,
      totals: { amount: { source: 5000, target: 5000 }, tax: { source: 900, target: 850 } },
    };
    write(dir, RESULTS, typeof results === "string" ? results.replace("HASH", hash) : JSON.stringify({ ...base, ...results }));
  }
  const r = check(dir);
  const mine = (list: string[]) => list.filter((f) => /invoices\.(md|json)$/.test(f)).map((f) => f.split(" ")[0]);
  return { dir, hash, errors: mine(r.errors), warnings: mine(r.warnings), messages: r.messages };
}

describe("data plan: verification by counts", () => {
  it("accepts source + adjustments - excluded = target", async () => {
    expect(await data()).toMatchObject({ errors: [], warnings: [] });
  });

  it("accepts signed adjustments tied to cleaning rules, and no exclusions", async () => {
    expect(await data({ excluded: undefined, adjustments: { "C-1": -100 }, target: 9900 })).toMatchObject({ errors: [] });
  });

  it.each([
    ["the counts do not add up", { target: 9899 }],
    ["an adjustment with the wrong sign", { adjustments: { "T-1": 35, "T-2": 15 } }],
    ["an unknown adjustment rule", { adjustments: { "T-9": 20 } }],
    ["an unknown exclusion rule", { excluded: { "C-9": 120 } }],
    ["a transformation used to exclude", { excluded: { "T-1": 120 } }],
    ["a negative exclusion", { excluded: { "C-1": -120 } }],
    ["a fraction", { source: 10000.5 }],
    ["a total that differs without a rule", { totals: { amount: { source: 5000, target: 4999 }, tax: { source: 1, target: 1 } } }],
    ["a missing declared total", { totals: { tax: { source: 1, target: 1 } } }],
    ["an undeclared total", { totals: { amount: { source: 1, target: 1 }, tax: { source: 1, target: 1 }, other: { source: 1, target: 1 } } }],
    ["a total that is text", { totals: { amount: { source: "5000", target: 5000 }, tax: { source: 1, target: 1 } } }],
    ["a total with extra keys", { totals: { amount: { source: 1, target: 1, rows: 1 }, tax: { source: 1, target: 1 } } }],
    ["extra data", { rows: [{ name: "Jane" }] }],
    ["a bad date", { taken_at: "yesterday" }],
  ])("is an error when %s", async (_name, patch) => {
    expect((await data(patch)).errors).toContain("data-results");
  });

  it("compares large totals exactly", async () => {
    const body = (target: string) =>
      `{"definition":"HASH","taken_at":"2027-01-10","source":1,"target":1,"totals":{"amount":{"source":12345678901234567.89,"target":${target}},"tax":{"source":1.50,"target":1.5}}}`;
    expect((await data(body("12345678901234567.89"))).errors).toEqual([]);
    expect((await data(body("12345678901234567.88"))).errors).toEqual(["data-results"]);
  });

  it("never repeats a value of the results file", async () => {
    const r = await data({ rows: "jane@example.com", source: "jane@example.com", excluded: { "jane@example.com": 1 } });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.messages).not.toContain("jane@example.com");
    const broken = await data("{ jane@example.com");
    expect(broken.messages).not.toContain("jane@example.com");
  });

  it("warns about missing and stale results", async () => {
    expect((await data(null)).warnings).toEqual(["data-counts"]);
    expect((await data(null, { counts: undefined })).warnings).toEqual(["data-counts"]);
    const r = await data();
    edit(r.dir, DATA, "exclude voided", "exclude voided and drafts");
    expect(check(r.dir).warnings).toContain("data-stale invoices.json");
  });

  it("the hash ignores order and prose but not the definition", async () => {
    const r = await data();
    const hash = () => {
      let out = "";
      runDataHash(DATA, { cwd: r.dir, out: (l) => (out = l) });
      return out;
    };
    fs.appendFileSync(path.join(r.dir, DATA), "\nMore notes.\n");
    edit(r.dir, DATA, 'owner: "Jane Doe"', 'owner: "John Roe"');
    expect(hash()).toBe(r.hash);
    edit(r.dir, DATA, '"merge duplicates"', '"merge duplicated rows"');
    expect(hash()).not.toBe(r.hash);
    expect(runDataHash("nope.md", { cwd: r.dir, err: () => {} })).toBe(2);
  });

  it.each([
    ["no target", { target: undefined }, "data-plan"],
    ["no sources", { sources: [] }, "data-plan"],
    ["a field without destination", { fields: [{ from: "X" }] }, "data-plan"],
    ["a dropped field without reason", { fields: [{ from: "X", dropped: "" }] }, "data-plan"],
    ["a badly named cleaning rule", { cleaning: [{ id: "C1", rule: "x" }] }, "data-plan"],
    ["a repeated rule", { cleaning: [{ id: "C-1", rule: "x" }, { id: "C-1", rule: "y" }] }, "data-plan"],
    ["a total explained by an unknown rule", { totals: [{ name: "amount", difference: "C-7" }, { name: "tax", difference: "C-1" }] }, "data-plan"],
    ["an unknown source", { cleaning: [{ id: "C-1", rule: "x", source: "F-09" }] }, "broken-ref"],
    ["results outside the project", { counts: { command: "`x`", results: "../x.json" } }, "data-plan"],
    ["no owner", { owner: undefined }, "todo-field"],
  ])("rejects a plan with %s", async (_name, patch, rule) => {
    expect((await data(null, patch)).errors).toContain(rule);
  });

  it("rejects two plans for one table", async () => {
    const r = await data();
    write(r.dir, "docs/reconstruccion/datos/other.md", dataPlan({ target: "Billing.Invoices" }));
    expect(check(r.dir).errors).toContain("data-plan other.md");
  });

  it("appears in the test plan", async () => {
    const r = await data();
    expect(testplan(r.dir, { stdout: true }).out).toContain("| [billing.invoices](reconstruccion/datos/invoices.md) | `npm run counts` | counts/invoices.json |");
  });
});

describe("parsing results", () => {
  it.each([
    ["1200.50", "1200.5"],
    ["007", "7"],
    ["-0.0", "0"],
    ["-12.00", "-12"],
    ["1e5", null],
  ])("%s -> %s", (raw, expected) => expect(canonicalDecimal(raw)).toBe(expected));

  it("rejects what is not an object", () => {
    for (const text of ["[]", "1", "x"]) expect(parseResults(text)).toHaveProperty("errors");
  });
});
