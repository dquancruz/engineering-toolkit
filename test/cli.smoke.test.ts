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
});
