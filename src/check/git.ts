import { execFileSync } from "node:child_process";

export interface GitState {
  /** Inside a git work tree with a usable `git` binary. */
  available: boolean;
  /** Shallow clone: history is incomplete, so history-based rules cannot be trusted. */
  shallow: boolean;
}

export interface FileVersion {
  sha: string;
  /** Path of the file in that commit, relative to the project (follows renames). */
  path: string;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["--literal-pathspecs", "-C", cwd, ...args], {
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

export function gitState(cwd: string): GitState {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return { available: false, shallow: false };
  const shallow = git(cwd, ["rev-parse", "--is-shallow-repository"]);
  return { available: true, shallow: shallow?.trim() === "true" };
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * Commits that touched `relPath`, oldest first, following renames.
 * (`git log --follow --reverse` does not follow renames correctly, so the list is reversed here.)
 * Empty for untracked files and for repositories without commits.
 */
export function fileHistory(cwd: string, relPath: string): FileVersion[] {
  const out = git(cwd, ["log", "--follow", "--name-only", "--relative", "--format=%H", "--", `./${relPath}`]);
  if (!out) return [];
  const versions: FileVersion[] = [];
  let sha: string | null = null;
  for (const line of out.split("\n")) {
    if (SHA.test(line)) {
      sha = line;
    } else if (line !== "" && sha) {
      versions.push({ sha, path: line });
      sha = null;
    }
  }
  return versions.reverse();
}

/** Content of `path` at `rev`, or null if it does not exist there. */
export function showAt(cwd: string, rev: string, relPath: string): string | null {
  return git(cwd, ["show", `${rev}:./${relPath}`]);
}

export interface DeletedFile {
  path: string;
  sha: string;
}

/** Files deleted (not renamed) under `relDir`, newest first. */
export function deletedFiles(cwd: string, relDir: string): DeletedFile[] {
  const out = git(cwd, ["log", "--diff-filter=D", "--name-only", "--relative", "--format=%H", "--", `./${relDir}`]);
  if (!out) return [];
  const files: DeletedFile[] = [];
  let sha: string | null = null;
  for (const line of out.split("\n")) {
    if (SHA.test(line)) sha = line;
    else if (line !== "" && sha) files.push({ path: line, sha });
  }
  return files;
}

export const shortSha = (sha: string) => sha.slice(0, 7);
