import { spawnSync } from "node:child_process";

export interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs `git` in `cwd` without a shell. */
export function runGit(cwd: string, args: string[]): GitRun {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
  return {
    ok: r.error === undefined && r.status === 0,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "").trim() || (r.error?.message ?? ""),
  };
}

export const isRepository = (cwd: string): boolean => runGit(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";

/** True when `ref` names a commit. A ref starting with "-" is never accepted (it would be read as an option). */
export const isCommit = (cwd: string, ref: string): boolean =>
  !ref.startsWith("-") && runGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok;
