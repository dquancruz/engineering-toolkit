import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installAgentProfile } from "../../src/agent/install.js";
import { formatGuardsReport, parseVersion, testGuards, versionAtLeast } from "../../src/agent/guards.js";
import { runAgentTestGuards } from "../../src/commands/agent.js";
import { captureConsole, tmpDir } from "../helpers.js";

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function installed(config?: object): Promise<string> {
  dir = tmpDir();
  if (config) fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify(config));
  await installAgentProfile("en", { cwd: dir, yes: true, out: () => {} });
  return dir;
}

describe("engkit agent test-guards", () => {
  it("passes on a fresh install (claude version may only warn)", async () => {
    await installed();
    const report = testGuards(dir);
    const failed = report.items.filter((i) => i.status === "fail");
    expect(failed).toEqual([]);
    expect(report.code).toBe(0);
    expect(report.items.filter((i) => i.group === "guard").length).toBeGreaterThanOrEqual(40);
    expect(formatGuardsReport(report)).toContain("0 failed");
  });

  it("exits 2 when the guards are not installed", () => {
    dir = tmpDir();
    const r = captureConsole(() => runAgentTestGuards({ cwd: dir }));
    expect(r.result).toBe(2);
    expect(r.stdout).toContain("engkit init --profile agent");
  });

  it("exits 2 when settings.json has no guard hook", () => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(path.join(dir, ".claude/settings.json"), "{}");
    expect(testGuards(dir).code).toBe(2);
  });

  it("fails when a deny rule was removed", async () => {
    await installed();
    const file = path.join(dir, ".claude/settings.json");
    const s = JSON.parse(fs.readFileSync(file, "utf-8"));
    s.permissions.deny = s.permissions.deny.filter((r: string) => r !== "Bash(git push -f *)");
    fs.writeFileSync(file, JSON.stringify(s));
    const report = testGuards(dir);
    expect(report.code).toBe(1);
    expect(report.items.find((i) => i.name === "permissions.deny rules")?.detail).toContain("Bash(git push -f *)");
  });

  it("fails when an ask rule was removed", async () => {
    await installed();
    const file = path.join(dir, ".claude/settings.json");
    const s = JSON.parse(fs.readFileSync(file, "utf-8"));
    s.permissions.ask = s.permissions.ask.filter((r: string) => r !== "Bash(git stash clear *)");
    fs.writeFileSync(file, JSON.stringify(s));
    const report = testGuards(dir);
    expect(report.code).toBe(1);
    expect(report.items.find((i) => i.name === "permissions.ask rules")?.detail).toContain("Bash(git stash clear *)");
  });

  it("detects an older guard that never asks, and suggests --update-guard", async () => {
    await installed();
    // behaves like v1 for these commands: exit 0 and no decision
    fs.writeFileSync(path.join(dir, ".claude/hooks/engkit-guard.mjs"), "process.exit(0);\n");
    const failed = testGuards(dir).items.filter((i) => i.status === "fail" && i.name.startsWith("asks:"));
    expect(failed.length).toBeGreaterThan(10);
    expect(failed[0]!.detail).toContain("--update-guard");
  });

  it("does not accept a deny where an ask is expected", async () => {
    await installed();
    fs.writeFileSync(
      path.join(dir, ".claude/hooks/engkit-guard.mjs"),
      `console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" } }));\n`
    );
    const report = testGuards(dir);
    expect(report.items.some((i) => i.status === "pass" && i.name.startsWith("asks:"))).toBe(false);
  });

  it('fails when onFailure is not "block"', async () => {
    await installed();
    const file = path.join(dir, ".claude/settings.json");
    const s = JSON.parse(fs.readFileSync(file, "utf-8"));
    delete s.hooks.PreToolUse[0].hooks[0].onFailure;
    fs.writeFileSync(file, JSON.stringify(s));
    expect(testGuards(dir).items.find((i) => i.name.includes("onFailure"))?.status).toBe("fail");
  });

  it("detects a guard script that no longer blocks", async () => {
    await installed();
    fs.writeFileSync(path.join(dir, ".claude/hooks/engkit-guard.mjs"), "process.exit(0);\n");
    const report = testGuards(dir);
    expect(report.code).toBe(1);
    expect(report.items.filter((i) => i.status === "fail" && i.name.startsWith("blocks:")).length).toBeGreaterThan(20);
  });

  it("detects a guard script that blocks without a reason or blocks too much", async () => {
    await installed();
    fs.writeFileSync(path.join(dir, ".claude/hooks/engkit-guard.mjs"), "process.exit(2);\n");
    const report = testGuards(dir);
    expect(report.items.some((i) => i.status === "fail" && i.name.startsWith("allows:"))).toBe(true);
    expect(report.items.some((i) => i.status === "fail" && i.name.startsWith("blocks:"))).toBe(true);
  });

  it("also tests extra protected branch patterns from .engkit.json", async () => {
    await installed({ protectedBranches: ["main", "release/*"] });
    const report = testGuards(dir);
    expect(report.code).toBe(0);
    expect(report.items.some((i) => i.name.includes("release/x"))).toBe(true);
  });

  it("does not touch the project (no files created, no git state)", async () => {
    await installed();
    const snapshot = () => fs.readdirSync(dir, { recursive: true }).sort().join("\n");
    const before = snapshot();
    testGuards(dir);
    expect(snapshot()).toBe(before);
  });

  it("--json prints a parseable report", async () => {
    await installed();
    const r = captureConsole(() => runAgentTestGuards({ cwd: dir, json: true }));
    const parsed = JSON.parse(r.stdout) as { ok: boolean; code: number; items: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.code).toBe(0);
    expect(parsed.items.length).toBeGreaterThan(40);
  });
});

describe("claude version check", () => {
  it("parses and compares versions", () => {
    expect(parseVersion("2.1.331 (Claude Code)")).toEqual([2, 1, 331]);
    expect(parseVersion("nope")).toBeNull();
    expect(versionAtLeast([2, 1, 295], [2, 1, 295])).toBe(true);
    expect(versionAtLeast([2, 1, 294], [2, 1, 295])).toBe(false);
    expect(versionAtLeast([2, 2, 0], [2, 1, 295])).toBe(true);
    expect(versionAtLeast([1, 9, 999], [2, 1, 295])).toBe(false);
  });
});
