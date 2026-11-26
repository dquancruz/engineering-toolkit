import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixtures, tmpDir } from "./helpers.js";

// Runs the compiled bin (built by test/global-setup.ts).
const bin = path.join(import.meta.dirname, "..", "dist", "cli.js");
const run = (args: string[], cwd?: string) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: "utf-8", ...(cwd ? { cwd } : {}) });

describe("engkit CLI smoke", () => {
  it("has a node shebang", () => {
    expect(fs.readFileSync(bin, "utf-8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("prints the package version", () => {
    const version = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf-8")) as { version: string }).version;
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  });

  it("prints help listing --lang and the jira command", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--lang <lang>");
    expect(r.stdout).toContain("jira");
  });

  it("has help for each jira subcommand", () => {
    for (const sub of ["report", "oncall"]) {
      const r = run(["jira", sub, "--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("--out <dir>");
    }
  });

  it("rejects an invalid --lang", () => {
    const r = run(["--lang", "fr", "jira", "report", "x.csv"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--lang");
  });

  it("respects .engkit.json and rejects an invalid one", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ lang: "xx" }));
    const r = run(["jira", "report", "x.csv"], dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(".engkit.json");
  });

  it("runs jira report → oncall end to end", () => {
    const dir = tmpDir();
    fs.copyFileSync(path.join(fixtures, "Jira.csv"), path.join(dir, "Jira.csv"));
    expect(run(["jira", "report", "Jira.csv"], dir).status).toBe(0);
    const report = fs.readdirSync(path.join(dir, "reports")).find((f) => f.startsWith("report_"))!;
    const r = run(["jira", "oncall", path.join("reports", report), "Jane Doe", "Sprint 1", "--out", "out"], dir);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(path.join(dir, "out"))[0]).toMatch(/^oncall_Jane_Doe_/);
  });

  it("has help for init, new adr, new pendiente and index", () => {
    for (const args of [["init"], ["new", "adr"], ["new", "pendiente"], ["index"]]) {
      const r = run([...args, "--help"]);
      expect(r.status, args.join(" ")).toBe(0);
      expect(r.stdout).toContain("Usage: engkit");
    }
  });

  it("runs init -> new adr -> new pendiente -> index end to end (en)", () => {
    const dir = tmpDir();
    const r = run(["--lang", "en", "init", "--owner", "Jane Doe"], dir);
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".engkit.json"), "utf-8")).lang).toBe("en");
    // the stored language and paths are used from now on, without --lang
    expect(run(["new", "adr", "Use Postgres", "--owner", "Jane Doe"], dir).status).toBe(0);
    expect(run(["new", "pending", "Check retention"], dir).status).toBe(0);
    expect(run(["index"], dir).status).toBe(0);
    const index = fs.readFileSync(path.join(dir, "docs/DECISIONS.md"), "utf-8");
    expect(index).toContain("0001-use-postgres.md");
    expect(fs.readFileSync(path.join(dir, "docs/pending.md"), "utf-8")).toContain("### P-01: Check retention");
  });

  it("has help for adr accept and check, and --supersedes in new adr", () => {
    for (const args of [["adr", "accept"], ["check"], ["new", "adr"]]) {
      const r = run([...args, "--help"]);
      expect(r.status, args.join(" ")).toBe(0);
    }
    expect(run(["new", "adr", "--help"]).stdout).toContain("--supersedes <ID>");
    expect(run(["check", "--help"]).stdout).toContain("--strict");
  });

  it("check: exit 2 without init, 0 when clean, 1 with errors, JSON output, --strict", () => {
    const empty = tmpDir();
    const r2 = run(["check"], empty);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain("engkit init");

    const dir = tmpDir();
    expect(run(["init", "--owner", "Jane Doe"], dir).status).toBe(0);
    const ok = run(["check"], dir);
    expect(ok.status).toBe(0); // only the "not a git repo" warning
    expect(ok.stdout).toContain("[git-history]");
    expect(run(["check", "--strict"], dir).status).toBe(1);

    fs.writeFileSync(path.join(dir, "CLAUDE.md"), fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf-8") + "\nVer ADR-0042.\n");
    const bad = run(["check"], dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/CLAUDE\.md:\d+  error  \[broken-ref\]  ADR-0042 does not exist\./);

    const json = JSON.parse(run(["check", "--json"], dir).stdout) as {
      ok: boolean;
      errors: { rule: string; file: string; line: number }[];
      summary: { errors: number };
    };
    expect(json.ok).toBe(false);
    expect(json.errors[0]).toMatchObject({ rule: "broken-ref", file: "CLAUDE.md" });
    expect(json.summary.errors).toBe(1);
  });

  it("prompt: help, non-interactive output on stdout, warnings on stderr, exit 2 without a terminal", () => {
    expect(run(["prompt", "--help"]).stdout).toContain("--allow-secrets");
    const dir = tmpDir();
    expect(run(["init", "--owner", "Jane Doe"], dir).status).toBe(0);

    const ok = run(["prompt", "--preset", "review", "--goal", "Review the diff of PR 12", "--done", "`git diff` has no open findings", "--verify", "`git diff`"], dir);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("## Objetivo");
    expect(ok.stdout).not.toContain("warning");
    expect(ok.stderr).toContain("warning");

    const noTerminal = run(["prompt"], dir);
    expect(noTerminal.status).toBe(2);
    expect(noTerminal.stderr).toContain("needs a terminal");

    const token = "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5";
    const blocked = run(["prompt", "--goal", `Use ${token}`], dir);
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toBe("");
    expect(blocked.stderr).not.toContain(token);
  });
});

// test-guards starts one process per case.
describe("engkit agent profile (CLI)", { timeout: 60_000 }, () => {
  it("has help for init (profiles, --yes, --dry-run) and agent test-guards", () => {
    const init = run(["init", "--help"]);
    expect(init.status).toBe(0);
    for (const flag of ["--profile <profiles>", "--agent <agent>", "--yes", "--dry-run", "--update-guard"]) {
      expect(init.stdout).toContain(flag);
    }
    const tg = run(["agent", "test-guards", "--help"]);
    expect(tg.status).toBe(0);
    expect(tg.stdout).toContain("--json");
    expect(tg.stdout).toContain("2.1.295");
  });

  it("rejects an unknown profile", () => {
    const r = run(["init", "--profile", "base,nope"], tmpDir());
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Invalid profile "nope"');
  });

  it("init --profile agent: no terminal and no --yes writes no settings (exit 1); --yes writes; test-guards passes", () => {
    const dir = tmpDir();
    const no = run(["--lang", "en", "init", "--profile", "agent"], dir);
    expect(no.status).toBe(1);
    expect(fs.existsSync(path.join(dir, ".claude/settings.json"))).toBe(false);
    expect(no.stdout).toContain("Run again with --yes");

    const yes = run(["--lang", "en", "init", "--profile", "agent", "--yes"], dir);
    expect(yes.status).toBe(0);
    expect(fs.existsSync(path.join(dir, ".claude/settings.json"))).toBe(true);

    const guards = run(["agent", "test-guards", "--json"], dir);
    expect(guards.status).toBe(0);
    expect((JSON.parse(guards.stdout) as { ok: boolean }).ok).toBe(true);
  });

  it("agent test-guards exits 2 when nothing is installed", () => {
    expect(run(["agent", "test-guards"], tmpDir()).status).toBe(2);
  });
});
