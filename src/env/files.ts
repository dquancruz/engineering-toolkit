import fs from "node:fs";
import path from "node:path";

export const EXAMPLE_FILE = ".env.example";

const ENV_FILE = /^\.env(\..+)?$/;
/** Templates, backups and editor files are not sources of variables. */
const NOT_A_SOURCE = /(\.(example|sample|template|dist|bak|orig|swp|swo)|~)$/i;

/** Names of the `.env*` files in `dir` that hold variables: `.env` first, then alphabetically. */
export function envSources(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => ENV_FILE.test(n) && !NOT_A_SOURCE.test(n) && fs.statSync(path.join(dir, n), { throwIfNoEntry: false })?.isFile())
    .sort((a, b) => (a === ".env" ? -1 : b === ".env" ? 1 : a < b ? -1 : 1));
}
