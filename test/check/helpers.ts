import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runAdrAccept } from "../../src/commands/adr.js";
import { runInit } from "../../src/commands/init.js";
import { runNewAdr } from "../../src/commands/new.js";
import { captureConsole, tmpDir } from "../helpers.js";

export const TODAY = "2026-03-09";

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export const commit = (dir: string, message: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
};

/** A git repository with the base documents (es), committed. */
export function gitProject(): string {
  const dir = tmpDir();
  git(dir, "init", "-q", "-b", "main");
  captureConsole(() => runInit("es", { cwd: dir, owner: "Jane Doe", today: TODAY }));
  commit(dir, "init");
  return dir;
}

export const newAdr = (dir: string, title: string, extra: { supersedes?: string } = {}) =>
  captureConsole(() => runNewAdr(title, "es", { cwd: dir, owner: "Jane Doe", today: TODAY, ...extra })).result;

export const accept = (dir: string, id: string, today = TODAY) =>
  captureConsole(() => runAdrAccept(id, "es", { cwd: dir, today }));

export const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf-8");
export const write = (dir: string, file: string, text: string) => fs.writeFileSync(path.join(dir, file), text, "utf-8");
export const edit = (dir: string, file: string, from: string | RegExp, to: string) => {
  const text = read(dir, file);
  const next = text.replace(from, to);
  if (next === text) throw new Error(`edit did not change ${file}`);
  write(dir, file, next);
};
