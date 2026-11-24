import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "../helpers.js";

export const guardScript = path.join(import.meta.dirname, "..", "..", "templates", "agent", "guard.mjs");

/** A directory with an (unborn) git repository on `branch`, and optionally an .engkit.json. */
export function repoOn(branch: string, protectedBranches?: string[]): string {
  const dir = tmpDir();
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["symbolic-ref", "HEAD", `refs/heads/${branch}`], { cwd: dir });
  if (protectedBranches) fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ protectedBranches }));
  return dir;
}

export interface GuardRun {
  status: number | null;
  stderr: string;
}

/** Runs the guard exactly like Claude Code: a process, JSON on stdin. */
export function runGuard(toolName: string, toolInput: Record<string, unknown>, dir: string, rawStdin?: string): GuardRun {
  const input = rawStdin ?? JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, cwd: dir });
  const r = spawnSync(process.execPath, [guardScript], {
    input,
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  return { status: r.status, stderr: r.stderr };
}

export const bash = (command: string, dir: string) => runGuard("Bash", { command }, dir);
