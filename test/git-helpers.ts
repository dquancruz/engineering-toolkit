import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpDir } from "./helpers.js";

// An empty global config keeps the machine's git settings out of the tests, on every OS.
const globalConfig = path.join(os.tmpdir(), "engkit-test-gitconfig");
fs.writeFileSync(globalConfig, "");

export function git(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** An empty commit with a fixed date, so nothing depends on the clock. */
export function emptyCommit(dir: string, message: string, date = "2026-03-09T12:00:00Z"): void {
  git(dir, ["commit", "-q", "--allow-empty", "-m", message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

export function newRepo(): string {
  const dir = tmpDir();
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return dir;
}
