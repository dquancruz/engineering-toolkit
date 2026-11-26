import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROTECTED_BRANCHES, loadConfig } from "../config.js";
import { DENY_RULES, GUARD_FILE, SETTINGS_FILE, isGuardGroup } from "./merge.js";

export const MIN_CLAUDE_VERSION = "2.1.295";

export type Status = "pass" | "fail" | "warn";

export interface Item {
  group: "setup" | "guard";
  name: string;
  status: Status;
  detail?: string;
}

export interface GuardsReport {
  /** 0 all good (warnings allowed), 1 something failed, 2 guards are not installed. */
  code: 0 | 1 | 2;
  items: Item[];
}

type Repo = "main" | "feature" | "none" | { branch: string };

interface Case {
  name: string;
  tool: string;
  input: Record<string, unknown>;
  expect: "block" | "allow";
  repo: Repo;
  /** Only meaningful when this branch is protected (a custom protectedBranches list may not include it). */
  needs?: string;
}

const bash = (name: string, command: string, expect: Case["expect"], repo: Repo = "feature", needs?: string): Case => ({
  name,
  tool: "Bash",
  input: { command },
  expect,
  repo,
  ...(needs !== undefined ? { needs } : {}),
});
const file = (name: string, tool: string, field: string, value: string, expect: Case["expect"]): Case => ({
  name,
  tool,
  input: { [field]: value },
  expect,
  repo: "none",
});

/** Synthetic hook inputs. Nothing here is ever executed: the guard only receives the text. */
const CASES: Case[] = [
  bash("rm -rf", "rm -rf build", "block"),
  bash("rm -fr", "rm -fr build", "block"),
  bash("rm -r -f", "rm -r -f build", "block"),
  bash("rm --recursive --force", "rm --recursive --force build", "block"),
  bash("rm -rf behind sudo", "sudo rm -rf /var/x", "block"),
  bash("rm -rf inside sh -c", "sh -c 'rm -rf build'", "block"),
  bash("rm -rf after &&", "npm test && rm -rf build", "block"),
  bash("git push --force", "git push --force origin feature/x", "block"),
  bash("git push -f", "git push -f origin feature/x", "block"),
  bash("git push --force-with-lease", "git push --force-with-lease origin feature/x", "block"),
  bash("git push +refspec", "git push origin +feature/x", "block"),
  bash("git push origin main", "git push origin main", "block", "feature", "main"),
  bash("git push HEAD:main", "git push origin HEAD:main", "block", "feature", "main"),
  bash("git push HEAD:master", "git push origin HEAD:master", "block", "feature", "master"),
  bash("git push --delete main", "git push origin --delete main", "block", "feature", "main"),
  bash("git push with no arguments on main", "git push", "block", "main", "main"),
  bash("git commit on main", 'git commit -m "change"', "block", "main", "main"),
  bash("git -C . commit on main", 'git -C . commit -m "change"', "block", "main", "main"),
  file("Read .env", "Read", "file_path", ".env", "block"),
  file("Read ./.env.local", "Read", "file_path", "./.env.local", "block"),
  file("Read nested .env.production", "Read", "file_path", "config/.env.production", "block"),
  file("Write .env", "Write", "file_path", ".env", "block"),
  file("Edit .env.staging", "Edit", "file_path", ".env.staging", "block"),
  file("Read .env with a Windows path", "Read", "file_path", "C:\\work\\app\\.env", "block"),
  file("Grep in .env", "Grep", "path", ".env", "block"),
  bash("cat .env", "cat .env", "block"),
  bash("source .env.production", "source .env.production", "block"),
  bash("redirect into .env", "echo X=1 > .env", "block"),
  bash("rm file", "rm old.txt", "allow"),
  bash("rm -r directory", "rm -r build", "allow"),
  bash("rm -f file", "rm -f old.txt", "allow"),
  bash("echo mentioning rm -rf", 'echo "do not run rm -rf"', "allow"),
  bash("git push -u origin feature", "git push -u origin feature/x", "allow"),
  bash("git push with no arguments on a working branch", "git push", "allow"),
  bash("git commit on a working branch", 'git commit -m "change"', "allow"),
  bash("git status", "git status", "allow"),
  bash("cat .env.example", "cat .env.example", "allow"),
  bash("commit message mentioning .env", 'git commit -m "document .env handling"', "allow"),
  file("Read .env.example", "Read", "file_path", ".env.example", "allow"),
  file("Read a source file", "Read", "file_path", "src/index.ts", "allow"),
  {
    name: "Write a file whose content mentions .env",
    tool: "Write",
    input: { file_path: "README.md", content: "Copy .env.example to .env\nthen edit it\n" },
    expect: "allow",
    repo: "none",
  },
];

// ---------------------------------------------------------------- helpers

/** Same matching as the guard: `*` is a wildcard. */
function matches(branch: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(branch));
}

/** `2.1.331 (Claude Code)` -> [2, 1, 331] */
export function parseVersion(text: string): number[] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function versionAtLeast(version: number[], min: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i]! !== min[i]!) return version[i]! > min[i]!;
  }
  return true;
}

function run(command: string, args: string[], options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(command, args, { encoding: "utf-8", timeout: options.timeout ?? 15_000, windowsHide: true, ...options });
}

function makeSandbox(base: string, name: string, branch: string, protectedBranches: string[] | undefined): string {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  run("git", ["init", "-q"], { cwd: dir });
  run("git", ["symbolic-ref", "HEAD", `refs/heads/${branch}`], { cwd: dir });
  if (protectedBranches) fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ protectedBranches }), "utf-8");
  return dir;
}

/** A branch name that a pattern like `release/*` matches. */
function sampleBranch(pattern: string): string {
  return pattern.replace(/\*/g, "x");
}

// ---------------------------------------------------------------- the check

/**
 * Checks that the guards are installed and that the configured hook blocks what it should.
 * The hook is started like Claude Code starts it (command + args, JSON on stdin), but with a throwaway
 * git repository as working directory, so no real project state is touched.
 * It cannot test Claude Code's own permission engine: only that the deny rules are present.
 */
export function testGuards(cwd: string): GuardsReport {
  const items: Item[] = [];
  const add = (group: Item["group"], name: string, status: Status, detail?: string) =>
    items.push({ group, name, status, ...(detail !== undefined ? { detail } : {}) });

  const settingsFile = path.join(cwd, SETTINGS_FILE);
  if (!fs.existsSync(settingsFile)) {
    add("setup", SETTINGS_FILE, "fail", 'not found. Run "engkit init --profile agent".');
    return { code: 2, items };
  }
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    add("setup", SETTINGS_FILE, "fail", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 2, items };
  }

  const pre = (settings["hooks"] as Record<string, unknown> | undefined)?.["PreToolUse"];
  const group = Array.isArray(pre) ? (pre.find(isGuardGroup) as { hooks: Record<string, unknown>[] } | undefined) : undefined;
  if (!group) {
    add("setup", "PreToolUse hook", "fail", 'engkit-guard hook not found in settings. Run "engkit init --profile agent".');
    return { code: 2, items };
  }
  const hook = group.hooks.find((h) => [h["command"], ...((h["args"] as unknown[]) ?? [])].some((p) => typeof p === "string" && p.includes("engkit-guard.mjs")))!;
  add("setup", "PreToolUse hook", "pass");
  add(
    "setup",
    'hook onFailure is "block"',
    hook["onFailure"] === "block" ? "pass" : "fail",
    hook["onFailure"] === "block" ? undefined : "without it a crashed or timed-out guard lets the action through"
  );

  const deny = ((settings["permissions"] as Record<string, unknown> | undefined)?.["deny"] as unknown[] | undefined) ?? [];
  const missing = DENY_RULES.filter((r) => !deny.includes(r));
  add("setup", "permissions.deny rules", missing.length === 0 ? "pass" : "fail", missing.length === 0 ? undefined : `missing: ${missing.join(", ")}`);

  const scriptPath = path.join(cwd, GUARD_FILE);
  const hasScript = fs.existsSync(scriptPath);
  add("setup", GUARD_FILE, hasScript ? "pass" : "fail", hasScript ? undefined : "script not found");

  const command = String(hook["command"] ?? "");
  const probe = run(command, ["--version"]);
  const commandOk = probe.error === undefined && probe.status === 0;
  add("setup", `\`${command}\` is available`, commandOk ? "pass" : "fail", commandOk ? undefined : "the hook command cannot be started; with onFailure block the guarded tools would be blocked");

  const claude = run("claude", ["--version"]);
  const claudeVersion = claude.error === undefined && claude.status === 0 ? parseVersion(claude.stdout) : null;
  if (claudeVersion === null) {
    add("setup", "claude version", "warn", `could not run "claude --version"; cannot verify it is ${MIN_CLAUDE_VERSION} or newer (needed for onFailure: "block")`);
  } else if (versionAtLeast(claudeVersion, parseVersion(MIN_CLAUDE_VERSION)!)) {
    add("setup", "claude version", "pass", claudeVersion.join("."));
  } else {
    add("setup", "claude version", "warn", `${claudeVersion.join(".")} is older than ${MIN_CLAUDE_VERSION}: "onFailure": "block" is not supported, so a guard failure would not block`);
  }

  if (!commandOk || !hasScript) {
    return { code: 1, items };
  }

  // Throwaway repositories: one on main, one on a working branch, plus one per extra protected pattern.
  const config = loadConfig(cwd);
  const protectedBranches = config.protectedBranches;
  const effective = protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "engkit-guards-"));
  try {
    const sandboxes = new Map<string, string>();
    const sandboxFor = (repo: Repo): string => {
      const branch = repo === "main" ? "main" : repo === "feature" || repo === "none" ? "feature/engkit-guard-test" : repo.branch;
      const key = branch;
      let dir = sandboxes.get(key);
      if (!dir) {
        dir = makeSandbox(base, `repo-${sandboxes.size}`, branch, protectedBranches);
        sandboxes.set(key, dir);
      }
      return dir;
    };

    const cases = CASES.filter((c) => c.needs === undefined || matches(c.needs, effective));
    // Patterns beyond the defaults (e.g. release/*): committing on a matching branch must be blocked.
    for (const pattern of effective) {
      if (DEFAULT_PROTECTED_BRANCHES.includes(pattern)) continue;
      const branch = sampleBranch(pattern);
      cases.push(bash(`git commit on protected branch ${branch} (${pattern})`, 'git commit -m "change"', "block", { branch }));
      cases.push(bash(`git push origin ${branch} (${pattern})`, `git push origin ${branch}`, "block"));
    }

    const args = ((hook["args"] as unknown[]) ?? []).map((a) => String(a).replaceAll("${CLAUDE_PROJECT_DIR}", cwd));
    const timeout = typeof hook["timeout"] === "number" ? hook["timeout"] * 1000 : 15_000;

    for (const c of cases) {
      const dir = sandboxFor(c.repo);
      const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: c.tool, tool_input: c.input, cwd: dir });
      const r = run(command, args, { cwd: dir, input: payload, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout });
      const blocked = r.status === 2;
      const stderr = (r.stderr ?? "").trim();
      if (c.expect === "block") {
        if (blocked && stderr !== "") add("guard", `blocks: ${c.name}`, "pass");
        else add("guard", `blocks: ${c.name}`, "fail", `expected exit 2 with a reason, got exit ${r.status ?? "none"}${stderr ? `: ${stderr}` : ""}`);
      } else if (r.status === 0) {
        add("guard", `allows: ${c.name}`, "pass");
      } else {
        add("guard", `allows: ${c.name}`, "fail", `expected exit 0, got exit ${r.status ?? "none"}${stderr ? `: ${stderr}` : ""}`);
      }
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  return { code: items.some((i) => i.status === "fail") ? 1 : 0, items };
}

export function formatGuardsReport(report: GuardsReport): string {
  const mark: Record<Status, string> = { pass: "PASS", fail: "FAIL", warn: "WARN" };
  const lines = report.items.map((i) => `${mark[i.status]}  ${i.name}${i.detail ? `\n      ${i.detail}` : ""}`);
  const failed = report.items.filter((i) => i.status === "fail").length;
  const warned = report.items.filter((i) => i.status === "warn").length;
  const passed = report.items.filter((i) => i.status === "pass").length;
  lines.push("", `${passed} passed, ${failed} failed, ${warned} warnings.`);
  lines.push(
    "Note: this checks the hook and that the deny rules are present. It cannot test Claude Code's own permission engine; use a live check for that."
  );
  return lines.join("\n");
}
