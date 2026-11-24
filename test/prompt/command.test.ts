import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectInfo } from "../../src/prompt/project.js";
import { loadChecklist } from "../../src/prompt/checklist.js";
import { resolveToken } from "../../src/prompt/project.js";
import { tmpDir } from "../helpers.js";
import { fixtureText, projectCopy, promptFixture, run } from "./helpers.js";

const fakeToken = "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5";

describe("engkit prompt --from (non-interactive)", () => {
  it.each([["full.yaml"], ["full.json"]])("renders %s exactly (es)", async (file) => {
    const dir = projectCopy();
    const r = await run(dir, { from: promptFixture(file) });
    expect(r.code).toBe(0);
    expect(r.out).toBe(fixtureText("expected-es.md"));
  });

  it("renders the same answers with English headings and preset text with --lang en", async () => {
    const r = await run(projectCopy(), { from: promptFixture("full.yaml") }, {}, "en");
    expect(r.code).toBe(0);
    expect(r.out).toBe(fixtureText("expected-en.md"));
  });

  it("prints only the prompt to stdout; warnings go to stderr", async () => {
    const r = await run(projectCopy(), { goal: "Add pagination to GET /orders" }, {}, "en");
    expect(r.code).toBe(0);
    expect(r.out).toBe("# Prompt\n\n## Goal\n\nAdd pagination to GET /orders\n");
    expect(r.err).toMatch(/warning {2}\[limits\] no limits set/);
    expect(r.err).toMatch(/warning {2}\[autonomy\]/);
  });

  it("flags override the file, element by element", async () => {
    const r = await run(projectCopy(), { from: promptFixture("full.yaml"), goal: "Another goal", limit: ["Only this limit"], preset: undefined as never });
    expect(r.out).toContain("## Objetivo\n\nAnother goal\n");
    expect(r.out).toContain("- Only this limit");
    expect(r.out).not.toContain("esquema de la base de datos");
    expect(r.out).toContain("Solo ocurre con clientes móviles v1."); // untouched
  });

  it("--preset adds typical limits and verification before your own", async () => {
    const r = await run(projectCopy(), { preset: "review", goal: "Review the diff of PR 12", limit: ["Mention security first"] }, {}, "en");
    const limits = r.out.split("## Limits\n\n")[1]!.split("\n\n")[0]!.split("\n");
    expect(limits[0]).toBe("- Read only: do not modify files");
    expect(limits.at(-1)).toBe("- Mention security first");
    expect(r.out).toContain("## Verification");
  });

  it("every preset loads in both languages", async () => {
    for (const lang of ["es", "en"] as const) {
      for (const preset of ["research", "feature", "bugfix", "refactor", "review"] as const) {
        const r = await run(projectCopy(), { preset, goal: "A goal that is long enough" }, {}, lang);
        expect(r.code, `${lang}/${preset}`).toBe(0);
        expect(r.out).toContain(loadChecklist(lang).presets[preset].limits[0]!);
      }
    }
  });

  it("--strict exits 1 on warnings but still prints; no warnings, exit 0", async () => {
    const weak = await run(projectCopy(), { goal: "improve things", strict: true });
    expect(weak.code).toBe(1);
    expect(weak.out).toContain("improve things");
    const full = await run(projectCopy(), { from: promptFixture("full.yaml"), strict: true });
    expect(full.code).toBe(0);
    expect(full.err).toBe("");
  });

  it("exit 2 for bad input, with a clear message", async () => {
    const bad = path.join(tmpDir(), "bad.yaml");
    fs.writeFileSync(bad, "goal: x\nfoo: 1\n");
    expect((await run(projectCopy(), { from: bad })).err).toMatch(/unknown key\(s\) "foo"/);
    expect((await run(projectCopy(), { from: bad })).code).toBe(2);
    expect((await run(projectCopy(), { from: "/nope.yaml" })).code).toBe(2);
    const noProject = await run(tmpDir(), { material: ["@adr:ADR-0001"] });
    expect(noProject.code).toBe(2);
    expect(noProject.err).toMatch(/needs an initialized project/);
  });

  it("exit 2 with a hint when there is no terminal and no input", async () => {
    const r = await run(projectCopy(), {}, { isTTY: false });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/needs a terminal/);
    expect(r.err).toMatch(/--from/);
    expect(r.out).toBe("");
  });
});

describe("project integration (paths only, never content)", () => {
  const info = () => loadProjectInfo(projectCopy());

  it("finds accepted ADRs, open pending items and CLAUDE.md", () => {
    const i = info()!;
    expect(i.adrs.map((a) => a.id)).toEqual(["ADR-0001"]); // ADR-0002 is only proposed
    expect(i.pendings).toEqual([{ id: "P-01", file: "docs/pendientes.md", line: 19, title: "Confirmar plazo de retención" }]);
    expect(i.claude).toEqual({ file: "CLAUDE.md", rules: 0 });
  });

  it("returns null outside an initialized project", () => {
    expect(loadProjectInfo(tmpDir())).toBeNull();
  });

  it("counts real rules in CLAUDE.md, ignoring TODO placeholders", () => {
    const dir = projectCopy();
    const file = path.join(dir, "CLAUDE.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf-8").replace("- TODO: reglas que debe seguir quien trabaje en este proyecto.", "- Usar TypeScript estricto.\n- No commitear secretos."));
    expect(loadProjectInfo(dir)!.claude!.rules).toBe(2);
  });

  it("does not copy the content of the ADR, the pending item or CLAUDE.md into the prompt", async () => {
    const dir = projectCopy();
    const adrText = fs.readFileSync(path.join(dir, "docs/adr/0001-usar-postgresql.md"), "utf-8");
    const r = await run(dir, { material: ["@adr:1", "@pending:P-01"], limit: ["@claude"], goal: "Do the thing now" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("docs/adr/0001-usar-postgresql.md (ADR-0001: Usar PostgreSQL)");
    expect(r.out).toContain("docs/pendientes.md:19 (P-01: Confirmar plazo de retención)");
    expect(r.out).toContain("Respeta las reglas y restricciones de CLAUDE.md.");
    for (const body of ["## Contexto", "¿Qué problema o situación", "Cada dato lleva fuente", "TODO: describe el pendiente"]) {
      expect(r.out).not.toContain(body);
    }
    expect(adrText.length).toBeGreaterThan(r.out.length / 2); // sanity: the real document is much bigger
  });

  it("rejects tokens that do not resolve, with the reason", async () => {
    const dir = projectCopy();
    const cases: [string, RegExp][] = [
      ["@adr:ADR-0002", /exists but is not accepted/],
      ["@adr:ADR-0099", /no such ADR/],
      ["@adr:foo", /no such ADR/],
      ["@pending:P-77", /no open pending item/],
      ["@nope", /Unknown reference/],
    ];
    for (const [token, message] of cases) {
      const r = await run(dir, { material: [token] });
      expect(r.code, token).toBe(2);
      expect(r.err, token).toMatch(message);
    }
  });

  it("@claude fails when the project has no CLAUDE.md, and plain text is never treated as a token", () => {
    const dir = projectCopy();
    fs.rmSync(path.join(dir, "CLAUDE.md"));
    const i = loadProjectInfo(dir);
    expect(() => resolveToken("@claude", i, loadChecklist("es"), dir)).toThrow(/no CLAUDE.md/);
    expect(resolveToken("src/x.ts", i, loadChecklist("es"), dir)).toBe("src/x.ts");
  });
});

describe("secrets block everything", () => {
  it("prints nothing to stdout, masks the warning, exits 1, and saves nothing", async () => {
    const dir = projectCopy();
    const r = await run(dir, { goal: `Call the API with ${fakeToken}`, save: true });
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/secret {3}\[goal:1\] GitHub token: ghp_\*\*\*/);
    expect(r.err).toMatch(/Blocked/);
    expect(r.err).not.toContain(fakeToken);
    expect(r.err).not.toContain(fakeToken.slice(6));
    expect(fs.existsSync(path.join(dir, "prompts"))).toBe(false);
  });

  it("blocks a secret that arrives through --from and through a token-like .env value", async () => {
    const dir = projectCopy();
    const file = path.join(dir, "p.yaml");
    fs.writeFileSync(file, `goal: Use ${fakeToken} to log in\n`);
    expect((await run(dir, { from: file })).code).toBe(1);

    fs.writeFileSync(path.join(dir, ".env"), "SERVICE_TOKEN=zq9Xv-not-a-real-value-123\n");
    const r = await run(dir, { goal: "Send zq9Xv-not-a-real-value-123 in the header" });
    expect(r.code).toBe(1);
    expect(r.err).toContain(".env:SERVICE_TOKEN");
    expect(r.err).not.toContain("zq9Xv");
    expect(r.out).toBe("");
  });

  it("--no-env-scan skips the .env comparison", async () => {
    const dir = projectCopy();
    fs.writeFileSync(path.join(dir, ".env"), "SERVICE_TOKEN=zq9Xv-not-a-real-value-123\n");
    const r = await run(dir, { goal: "Send zq9Xv-not-a-real-value-123 in the header", envScan: false });
    expect(r.code).toBe(0);
  });

  it("--allow-secrets prints and saves anyway, still warning", async () => {
    const dir = projectCopy();
    const r = await run(dir, { goal: `Call the API with ${fakeToken}`, allowSecrets: true, save: "with-secret" });
    expect(r.code).toBe(0);
    expect(r.out).toContain(fakeToken);
    expect(r.err).toMatch(/Continuing because of --allow-secrets/);
    expect(fs.existsSync(path.join(dir, "prompts"))).toBe(true);
  });

  it("weak elements are only warnings: they never block", async () => {
    const r = await run(projectCopy(), { goal: "improve", done: "make it work" });
    expect(r.code).toBe(0);
    expect(r.out).not.toBe("");
  });
});

const initGit = (dir: string) => execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"], { stdio: "ignore" });

describe("--save", () => {
  const options = { preset: "feature", goal: "Add pagination to GET /orders", done: "`GET /orders?page=2` returns 20 items" } as const;
  const gitEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

  it("writes the prompt and a reusable answers file, and --from reproduces the same prompt", async () => {
    const dir = projectCopy();
    const first = await run(dir, { ...options, save: "pagination" }, { today: "2026-03-09" });
    expect(first.code).toBe(0);
    expect(first.err).toMatch(/saved {4}prompts\/2026-03-09-pagination\.md/);
    expect(fs.readFileSync(path.join(dir, "prompts/2026-03-09-pagination.md"), "utf-8")).toBe(first.out);

    const again = await run(dir, { from: path.join(dir, "prompts/2026-03-09-pagination.yaml") });
    expect(again.out).toBe(first.out);
  });

  it("names the file after the goal when no name is given, and never overwrites", async () => {
    const dir = projectCopy();
    await run(dir, { ...options, save: true }, { today: "2026-03-09" });
    await run(dir, { ...options, save: true }, { today: "2026-03-09" });
    expect(fs.readdirSync(path.join(dir, "prompts")).sort()).toEqual([
      "2026-03-09-add-pagination-to-get-orders-2.md",
      "2026-03-09-add-pagination-to-get-orders-2.yaml",
      "2026-03-09-add-pagination-to-get-orders.md",
      "2026-03-09-add-pagination-to-get-orders.yaml",
    ]);
  });

  it("adds the folder to .gitignore in a git repo, says so, and does it only once", async () => {
    const dir = projectCopy();
    Object.assign(process.env, gitEnv);
    initGit(dir);
    const first = await run(dir, { ...options, save: "a" }, { today: "2026-03-09" });
    expect(first.err).toMatch(/added the prompts folder to \.gitignore/);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf-8")).toMatch(/^prompts\/$/m);
    const second = await run(dir, { ...options, save: "b" }, { today: "2026-03-09" });
    expect(second.err).not.toMatch(/\.gitignore/);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf-8").match(/^prompts\/$/gm)).toHaveLength(1);
    const status = execFileSync("git", ["-C", dir, "status", "--short", "--untracked-files=all"], { encoding: "utf-8" });
    expect(status).not.toContain("prompts/");
  });

  it("keeps existing .gitignore content, and --no-gitignore leaves it alone with a warning", async () => {
    const dir = projectCopy();
    initGit(dir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/");
    await run(dir, { ...options, save: "a" });
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf-8")).toMatch(/^node_modules\/\n[\s\S]*prompts\/\n$/);

    const dir2 = projectCopy();
    initGit(dir2);
    const r = await run(dir2, { ...options, save: "a", gitignore: false });
    expect(fs.existsSync(path.join(dir2, ".gitignore"))).toBe(false);
    expect(r.err).toMatch(/not ignored by git/);
  });

  it("does not create .gitignore outside a git repository", async () => {
    const dir = projectCopy();
    await run(dir, { ...options, save: "a" });
    expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
  });

  it("uses promptsDir from .engkit.json", async () => {
    const dir = projectCopy();
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".engkit.json"), "utf-8")) as Record<string, unknown>;
    cfg["promptsDir"] = "docs/prompts";
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify(cfg));
    const r = await run(dir, { ...options, save: "x" }, { today: "2026-03-09" });
    expect(r.err).toContain("docs/prompts/2026-03-09-x.md");
    expect(fs.existsSync(path.join(dir, "docs/prompts/2026-03-09-x.yaml"))).toBe(true);
  });

  it("rejects an unsafe promptsDir", async () => {
    const dir = projectCopy();
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ promptsDir: "../outside" }));
    await expect(run(dir, { ...options, save: "x" })).rejects.toThrow(/promptsDir/);
  });

  it("the old projects without promptsDir keep working (check ignores the new key)", async () => {
    const { runCheck } = await import("../../src/commands/check.js");
    const dir = projectCopy();
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".engkit.json"), "utf-8")) as Record<string, unknown>;
    cfg["promptsDir"] = "prompts";
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify(cfg));
    expect(runCheck("es", { cwd: dir }).errors).toEqual([]);
  });
});
