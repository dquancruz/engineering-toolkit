import fs from "node:fs";
import path from "node:path";
import { runCheck, type CheckOptions } from "../../src/commands/check.js";
import { runInit } from "../../src/commands/init.js";
import { runEvidenceAdd, runEvidenceUpdate, runInitLegacy, runNewItem, runRulesIndex, type NewItemOptions } from "../../src/commands/legacy.js";
import type { ItemKind } from "../../src/legacy/model.js";
import { git } from "../git-helpers.js";
import { captureConsole, tmpDir } from "../helpers.js";

export const TODAY = "2026-03-09";

/** Lines of the "old system". Every one carries a marker so a copy of the code anywhere is detected. */
export const OLD_CODE = [
  "IDENTIFICATION DIVISION.",
  "    IF ZZCODE-DAYS-LATE > 30",
  "        COMPUTE ZZCODE-FEE = ZZCODE-AMOUNT * 0.05",
  "        PERFORM ZZCODE-CHARGE-CUSTOMER",
  "    END-IF.",
  "    MOVE ZZCODE-FEE TO ZZCODE-INVOICE-TOTAL",
  "    }",
  "    }",
];

export interface Fixture {
  /** The project with the base and legacy documents. */
  dir: string;
  /** The old system, a separate folder outside the project. */
  old: string;
  cleanup: () => void;
}

export const raw = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf-8");
/** With LF line endings: on Windows git checks the templates out with CRLF. */
export const read = (dir: string, file: string) => raw(dir, file).replace(/\r\n/g, "\n");
export const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
export const edit = (dir: string, file: string, from: string | RegExp, to: string) => {
  const text = read(dir, file);
  const next = text.replace(from, () => to);
  if (next === text) throw new Error(`edit did not change ${file}: ${from}`);
  write(dir, file, raw(dir, file).includes("\r\n") ? next.replace(/\n/g, "\r\n") : next);
};
export const oldCode = (old: string, lines: string[]) => write(old, "src/fee.cbl", lines.join("\n") + "\n");

export const source = (id: string, type: string, extra = "") =>
  `\n### ${id}: ${type} source\n\n- type: ${type}\n- obtained_by: Jane Doe\n- obtained_on: ${TODAY}\n- method: interview${extra}\n`;

export function project(): Fixture {
  const dir = tmpDir();
  const old = tmpDir();
  oldCode(old, OLD_CODE);
  captureConsole(() => {
    runInit("es", { cwd: dir, owner: "Jane Doe", today: TODAY });
    runInitLegacy("es", { cwd: dir, owner: "Jane Doe", today: TODAY });
  });
  const config = JSON.parse(read(dir, ".engkit.json"));
  config.evidenceRoots = { erp: { path: path.relative(dir, old).replaceAll("\\", "/") } };
  write(dir, ".engkit.json", JSON.stringify(config));
  fs.appendFileSync(path.join(dir, "docs/fuentes.md"), source("F-01", "person") + source("F-02", "code"));
  return {
    dir,
    old,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(old, { recursive: true, force: true });
    },
  };
}

export function create(dir: string, kind: ItemKind, title: string, options: NewItemOptions = {}): string {
  return runNewItem(kind, title, "es", { cwd: dir, owner: "Jane Doe", today: TODAY, out: () => {}, ...options });
}

export const reindex = (dir: string) => runRulesIndex("es", { cwd: dir, today: TODAY, out: () => {} });

export function evidence(dir: string, command: "add" | "update", args: string[], accept: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: dir, out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  const code = command === "add" ? runEvidenceAdd(args[0]!, args[1]!, io) : runEvidenceUpdate(args, { ...io, accept });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** Findings of the legacy rules (the project is not a git repository, so that warning is left out). */
export function check(dir: string, options: CheckOptions = {}) {
  const result = runCheck("es", { cwd: dir, ...options });
  const list = (fs_: typeof result.errors) => fs_.filter((f) => f.rule !== "git-history");
  const short = (fs_: typeof result.errors) => list(fs_).map((f) => `${f.rule} ${path.posix.basename(f.file).replace(/^((RN|PA|D)-\d{4}).*/, "$1")}`);
  return { result, errors: short(result.errors), warnings: short(result.warnings), text: JSON.stringify(result) };
}

export const commit = (dir: string, message: string) => {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
};
