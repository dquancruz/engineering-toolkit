import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRequirements, type RequirementsOptions } from "../../src/commands/requirements.js";
import { addEntries, parseEntriesFile } from "../../src/requirements/entries.js";
import { PromptCancelled } from "../../src/prompt/asker.js";
import { FakeAsker } from "../prompt/helpers.js";
import { ALL_CATEGORIES, TODAY, check, cleanup, entry, init, initLog, raw, read, requirement, requirements, write } from "./helpers.js";

afterEach(cleanup);

const DOC = "docs/requisitos.md";
const project = () => init(["base", "requirements"]);
const constraint = (extra: Record<string, string | undefined> = {}) =>
  entry("RES-01", { kind: "region", value: "eu-west-1", decided_by: "Legal", origin: "ADR-0001", owner: "Jane Doe", date: TODAY, ...extra });

/** A project with an accepted ADR to cite and every category covered. */
async function covered() {
  const dir = await project();
  write(dir, "docs/adr/0001-region.md", `---\nid: ADR-0001\nstatus: accepted\ndate: ${TODAY}\nowner: Jane Doe\n---\n# ADR-0001: Region\n`);
  requirements(dir, ALL_CATEGORIES.replaceAll("source: F-01", "source: ADR-0001"));
  return dir;
}
const findings = (dir: string) => {
  const r = check(dir);
  const mine = (list: string[]) => list.filter((f) => !/^(index-stale|adr-immutable)/.test(f));
  return { errors: mine(r.errors), warnings: mine(r.warnings), messages: r.messages };
};
const one = async (text: string) => {
  const dir = await covered();
  requirements(dir, text);
  return findings(dir);
};

describe("the requirements profile on its own", () => {
  it("creates nothing of the legacy or rebuild profiles", async () => {
    const dir = await project();
    const config = JSON.parse(read(dir, ".engkit.json"));
    expect(config.requirements).toEqual({ doc: DOC });
    expect(config).not.toHaveProperty("legacy");
    expect(config).not.toHaveProperty("evidenceRoots");
    expect(config).not.toHaveProperty("rebuild");
    for (const name of ["fuentes.md", "reglas", "pruebas", "defectos", "REGLAS.md", "reconstruccion"]) {
      expect(fs.existsSync(path.join(dir, "docs", name)), name).toBe(false);
    }
    expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
  });

  it("only warns about the missing categories right after init", async () => {
    const r = findings(await project());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(Array(6).fill("requirement-coverage requisitos.md"));
  });

  it("is clean when every category is covered and cites ADRs", async () => {
    expect(findings(await covered())).toMatchObject({ errors: [], warnings: [] });
  });

  it("explains that F- sources need the legacy register", async () => {
    const r = await one(constraint({ origin: "F-01" }));
    expect(r.errors).toEqual(["broken-ref requisitos.md"]);
    expect(r.messages).toContain("use an ADR");
  });

  it("keeps the existing document when init runs again", async () => {
    const dir = await covered();
    const before = read(dir, DOC);
    await init(["requirements"], { cwd: dir });
    expect(read(dir, DOC)).toBe(before);
    expect(initLog).toContain("skipped");
  });

  it("accepts a not-applicable category with its reason", async () => {
    const dir = await covered();
    write(dir, DOC, read(dir, DOC).replace(/### RNF-05[\s\S]*?(?=### RNF-06)/, entry("RNF-05", { category: "integrations", status: "not-applicable", reason: "standalone", owner: "Jane Doe", date: TODAY }) + "\n"));
    expect(findings(dir)).toMatchObject({ errors: [], warnings: [] });
    write(dir, DOC, read(dir, DOC).replace("- reason: standalone\n", ""));
    expect(findings(dir).errors).toEqual(["requirement-field requisitos.md"]);
  });
});

describe("requirement rules", () => {
  const req = (category: string, extra: Record<string, string | undefined>) =>
    one(requirement("RNF-07", category, { source: "ADR-0001", ...extra }));

  it.each([
    ["category", { category: "speed" }, "requirement-field"],
    ["status", { status: "maybe" }, "requirement-field"],
    ["owner", { owner: "TODO" }, "requirement-field"],
    ["date", { date: "2026-02-30" }, "status-date"],
    ["measure of a confirmed one", { measure: undefined }, "requirement-field"],
    ["target of a confirmed one", { target: "TODO", category: "integrations" }, "requirement-field"],
    ["verify format", { verify: "by hand" }, "requirement-field"],
    ["source", { source: "ADR-0009" }, "broken-ref"],
    ["source format", { source: "the boss" }, "broken-ref"],
  ])("is an error: %s", async (_name, extra, rule) => {
    expect((await req("integrations", extra)).errors).toContain(`${rule} requisitos.md`);
  });

  it("says who maintains the system", async () => {
    const r = await req("maintenance", { owner: undefined });
    expect(r.errors).toEqual(["requirement-field requisitos.md"]);
    expect(r.messages).toContain("Say who will maintain the system");
  });

  it.each(["users", "performance", "availability"])("warns when the %s target has no number", async (category) => {
    expect((await req(category, { target: "fast enough" })).warnings).toEqual(["requirement-measurable requisitos.md"]);
  });

  it("does not ask a number of integrations", async () => {
    expect((await req("integrations", { target: "REST" })).warnings).toEqual([]);
  });

  it("warns about a confirmed requirement without source, and without verification", async () => {
    expect((await req("integrations", { source: undefined })).warnings).toEqual(["requirement-source requisitos.md"]);
    expect((await req("performance", { verify: undefined })).warnings).toEqual(["requirement-unverified requisitos.md"]);
  });

  it("leaves drafts alone except for numbers", async () => {
    const r = await req("performance", { status: "draft", target: undefined, measure: undefined, verify: undefined, source: undefined });
    expect(r).toMatchObject({ errors: [], warnings: ["requirement-measurable requisitos.md"] });
  });

  it("checks verify against the tests, once, with or without legacy", async () => {
    expect((await req("integrations", { verify: "PA-0009" })).errors).toEqual(["broken-ref requisitos.md"]);
    const dir = await init(["base", "rebuild"]);
    requirements(dir, requirement("RNF-01", "users", { verify: "PA-0009", source: "F-09" }));
    expect(check(dir).errors).toEqual(["broken-ref requisitos.md", "broken-ref requisitos.md"]);
  });

  it("reports a duplicate ID", async () => {
    expect((await one(requirement("RNF-01", "users", { source: "ADR-0001" }))).errors).toEqual(["unique-id requisitos.md"]);
  });
});

describe("constraint rules", () => {
  it("accepts a constraint with who decided it and an origin", async () => {
    expect(await one(constraint())).toMatchObject({ errors: [], warnings: [] });
  });

  it.each([
    ["no origin", { origin: undefined }, "constraint-origin"],
    ["nobody who decided it", { decided_by: undefined }, "constraint-origin"],
    ["an origin that does not exist", { origin: "ADR-0001, ADR-0002" }, "broken-ref"],
    ["an origin that is not an ID", { origin: "meeting" }, "broken-ref"],
    ["an unknown kind", { kind: "budget" }, "requirement-field"],
    ["no value", { value: "TODO" }, "requirement-field"],
  ])("is an error with %s", async (_name, extra, rule) => {
    expect((await one(constraint(extra))).errors).toEqual([`${rule} requisitos.md`]);
  });

  it("warns when the ADR is not accepted", async () => {
    const dir = await covered();
    write(dir, "docs/adr/0002-x.md", `---\nid: ADR-0002\nstatus: proposed\ndate: ${TODAY}\nowner: Jane Doe\n---\n# ADR-0002: X\n`);
    requirements(dir, constraint({ origin: "ADR-0002" }));
    expect(findings(dir).warnings).toEqual(["origin-adr requisitos.md"]);
  });
});

describe("engkit requirements", () => {
  const FILE = `
requirements:
  - category: performance
    title: Invoice search
    status: confirmed
    measure: p95 latency
    target: <= 300 ms
    verify: "\`npm run perf\`"
    source: ADR-0001
constraints:
  - kind: region
    title: Deployment region
    value: eu-west-1
    decided_by: Legal
    origin: [ADR-0001]
`;
  async function run(dir: string, options: RequirementsOptions = {}) {
    let out = "";
    const err: string[] = [];
    const code = await runRequirements("es", { cwd: dir, today: "2026-04-01", owner: "Jane Doe", isTTY: false, out: (t) => void (out += t), err: (l) => err.push(l), ...options });
    return { code, out, err: err.join("\n") };
  }
  const from = async (text: string) => {
    const dir = await project();
    write(dir, "in.yaml", text);
    return dir;
  };

  it("--from appends requirements and constraints in their sections and updates the date", async () => {
    const dir = await from(FILE);
    expect((await run(dir, { from: "in.yaml" })).code).toBe(0);
    const text = read(dir, DOC);
    expect(text).toContain("date: 2026-04-01");
    expect(text).toContain("Estado al 2026-04-01. <!-- engkit:date -->");
    expect(text.indexOf("### RNF-01: Invoice search")).toBeLessThan(text.indexOf("## Restricciones fijas"));
    expect(text.indexOf("### RES-01: Deployment region")).toBeGreaterThan(text.indexOf("## Restricciones fijas"));
    expect(text).toContain("- status: confirmed\n- measure: p95 latency\n- target: <= 300 ms");
    expect(check(dir).errors.filter((e) => !e.includes("broken-ref"))).toEqual([]);
  });

  it("skips repeated entries, numbers the new ones and leaves existing text alone", async () => {
    const dir = await from(FILE);
    await run(dir, { from: "in.yaml" });
    const before = read(dir, DOC);
    const again = await run(dir, { from: "in.yaml" });
    expect(again.err).toContain('skipped  "Invoice search"');
    expect(read(dir, DOC)).toBe(before);
    write(dir, "in.yaml", "requirements:\n  - { category: users, title: Peak }\n");
    await run(dir, { from: "in.yaml" });
    expect(read(dir, DOC)).toContain("### RNF-02: Peak\n\n- category: users\n- status: draft\n- owner: Jane Doe\n- date: 2026-04-01");
  });

  it("--dry-run prints and writes nothing", async () => {
    const dir = await from(FILE);
    const before = read(dir, DOC);
    const r = await run(dir, { from: "in.yaml", dryRun: true });
    expect(r.out).toContain("### RNF-01: Invoice search");
    expect(read(dir, DOC)).toBe(before);
  });

  it.each([
    ["an unknown key", "requirements:\n  - { category: users, title: x, speed: 1 }\n", /unknown key/],
    ["a missing title", "requirements:\n  - { category: users }\n", /title/],
    ["a wrong category", "requirements:\n  - { category: nope, title: x }\n", /category/],
    ["a wrong kind", "constraints:\n  - { kind: nope, title: x }\n", /kind/],
    ["a wrong type", "requirements:\n  - { category: users, title: x, target: [1] }\n", /must be text/],
    ["an unknown list", "rules: []\n", /unknown key/],
    ["bad YAML", "requirements: [\n", /could not be parsed/],
  ])("rejects %s without writing", async (_name, text, message) => {
    const dir = await from(text);
    const before = read(dir, DOC);
    const r = await run(dir, { from: "in.yaml" });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(message);
    expect(read(dir, DOC)).toBe(before);
  });

  it("blocks a possible secret and never shows it", async () => {
    const secret = `ghp_${"a1".repeat(20)}`;
    const dir = await from(`constraints:\n  - { kind: identity, title: Token, value: ${secret} }\n`);
    const before = read(dir, DOC);
    const r = await run(dir, { from: "in.yaml" });
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toContain(secret);
    expect(read(dir, DOC)).toBe(before);
    expect((await run(dir, { from: "in.yaml", allowSecrets: true })).code).toBe(0);
  });

  it("a parse error does not quote the file", async () => {
    const dir = await from("requirements:\n  - title: [hunter2secret\n");
    const r = await run(dir, { from: "in.yaml" });
    expect(r.err).not.toContain("hunter2secret");
  });

  it("does not let a value hide the rest of the document", () => {
    const document = "## R\n\n## C <!-- engkit:constraints -->\n";
    const entries = parseEntriesFile('requirements:\n  - { category: users, title: "<!-- x", measure: "a\\n### RNF-09: fake" }\n', "f");
    const { text } = addEntries(document, entries, { owner: "o", date: TODAY });
    expect(text).toContain("&lt;!-- x");
    expect(text).not.toMatch(/^### RNF-09/m);
  });

  it("keeps CRLF documents", () => {
    const { text } = addEntries("## R\r\n\r\n## C <!-- engkit:constraints -->\r\n", parseEntriesFile("requirements: [{category: users, title: x}]", "f"), { owner: "o", date: TODAY });
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("needs a terminal for the guided mode and the profile", async () => {
    const dir = await project();
    expect((await run(dir)).code).toBe(2);
    expect((await run(await init(["base"]))).err).toContain("--profile requirements");
  });

  const guided = () =>
    new FakeAsker({
      select: (o) => {
        if (o.message.startsWith("Performance")) return "add";
        if (o.message.startsWith("Integrations")) return "na";
        if (o.message === "Kind") return "database";
        return "next";
      },
      text: (o) =>
        ({
          Title: "Search",
          "Title (what does not apply)": "No integrations",
          "What is measured?": "p95",
          "Why does it not apply?": "standalone",
          "What is fixed?": "PostgreSQL",
          "Who decided it?": "Platform team",
        })[o.message] ?? "",
      confirm: (() => {
        let constraints = 0;
        return (o: { message: string }) => {
          if (o.message.startsWith("Add a fixed constraint")) return constraints++ === 0;
          return o.message.startsWith("Open a pending question");
        };
      })(),
    });

  it("guided: writes drafts, not-applicable and constraints, and opens questions for unknowns", async () => {
    const dir = await project();
    const r = await run(dir, { asker: guided(), isTTY: true });
    expect(r.code).toBe(0);
    const text = read(dir, DOC);
    expect(text).toContain("- category: performance\n- status: draft\n- measure: p95\n- owner: Jane Doe");
    expect(text).toContain("- category: integrations\n- status: not-applicable\n- reason: standalone");
    expect(text).toContain("### RES-01: Search\n\n- kind: database\n- value: PostgreSQL\n- decided_by: Platform team");
    expect(read(dir, "docs/pendientes.md")).toContain("P-01: Define the performance requirement: Search");
  });

  it("guided: cancelling writes nothing", async () => {
    const dir = await project();
    const before = raw(dir, DOC);
    const pending = raw(dir, "docs/pendientes.md");
    const asker = guided();
    asker.confirm = async (o) => {
      if (o.message.startsWith("Add a fixed constraint")) throw new PromptCancelled();
      return true;
    };
    expect((await run(dir, { asker, isTTY: true })).code).toBe(130);
    expect(raw(dir, DOC)).toBe(before);
    expect(raw(dir, "docs/pendientes.md")).toBe(pending);
  });
});
