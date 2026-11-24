import { execFileSync } from "node:child_process";

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Owner precedence: `--owner` flag, then `git config user.name`, then "TODO". */
export function resolveOwner(flag: string | undefined, cwd: string): string {
  if (flag !== undefined && flag.trim() !== "") return flag.trim();
  try {
    const name = execFileSync("git", ["config", "user.name"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (name !== "") return name;
  } catch {
    // git missing or no user.name configured
  }
  return "TODO";
}

export interface DocOptions {
  /** Directory of the project (default: cwd). */
  cwd?: string;
  owner?: string | undefined;
  /** Override "today" (YYYY-MM-DD). Used by tests. */
  today?: string;
}
