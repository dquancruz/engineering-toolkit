import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEnvCheck, runEnvExample } from "../../src/commands/env.js";
import { readEnvNames } from "../../src/env/parse.js";
import { tmpDir } from "../helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/**
 * A random secret that starts with "Zq9" and has no "=" or quotes. Every value and comment in these tests is
 * made of canaries, so any leaked piece of 6 characters or more is found.
 */
const secrets: string[] = [];
function canary(): string {
  const s = `Zq9${randomBytes(18).toString("hex")}`;
  secrets.push(s);
  return s;
}

function expectNoLeak(...outputs: string[]): void {
  const text = outputs.join("\n");
  for (const secret of secrets) {
    for (let i = 0; i + 6 <= secret.length; i++) {
      expect(text.includes(secret.slice(i, i + 6)), `leaked part of a value: …${secret.slice(i, i + 6)}…`).toBe(false);
    }
  }
}

function project(files: Record<string, string>): string {
  const dir = tmpDir();
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

type Command = "example" | "check" | "json";
function run(cwd: string, command: Command, files: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd, out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  const code = command === "example" ? runEnvExample(io) : runEnvCheck(files, { ...io, json: command === "json" });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), "utf-8");

/** Every kind of line a dotenv file may have. */
const everything = () =>
  [
    `# old value ${canary()}`,
    `PLAIN=${canary()}`,
    `export EXPORTED=${canary()}`,
    `  SPACED = ${canary()}  # ${canary()}`,
    `DOUBLE="${canary()} # not a comment" # ${canary()}`,
    `SINGLE='${canary()}'`,
    `MULTI="${canary()}`,
    `${canary()}=`,
    `NOT_A_NAME=${canary()}`,
    `\\" ${canary()}"`,
    `MULTI_SINGLE='${canary()}`,
    `${canary()}'`,
    `PEM=-----BEGIN PRIVATE KEY-----`,
    `${canary()}`,
    `${canary()}==`,
    `-----END PRIVATE KEY-----`,
    `EMPTY=`,
    `URL=postgres://user:${canary()}@host/db?sslmode=${canary()}`,
    `PLAIN=${canary()}`,
    "",
  ].join("\n");

const NAMES = ["PLAIN", "EXPORTED", "SPACED", "DOUBLE", "SINGLE", "MULTI", "MULTI_SINGLE", "PEM", "EMPTY", "URL"];

describe("readEnvNames", () => {
  it("reads only the names, skipping multi-line values", () => {
    expect(readEnvNames(everything())).toEqual({ names: NAMES, problems: [] });
  });

  it("handles CRLF, a BOM and an empty file", () => {
    expect(readEnvNames(`﻿A=1\r\nB="x\r\ny"\r\nC=3\r\n`).names).toEqual(["A", "B", "C"]);
    expect(readEnvNames("").names).toEqual([]);
  });

  const broken: [string, () => string, number][] = [
    ["an unclosed double quote", () => `A=1\nB="${canary()}\n${canary()}=x\n`, 2],
    ["an unclosed single quote", () => `A='${canary()}`, 1],
    ["text after a closing quote", () => `A="${canary()}"${canary()}`, 1],
    ["an unquoted multi-line value", () => `KEY=${canary()}\n${canary()}/+\n`, 2],
    ["a base64 last line ending in ==", () => `KEY=${canary()}\n${canary()}==\n`, 2],
    ["a base64 last line ending in =", () => `KEY=${canary()}\n${canary()}=\n`, 2],
    ["an unclosed PEM block", () => `KEY=-----BEGIN KEY-----\n${canary()}\n`, 1],
    ["a backslash continuation", () => `KEY=${canary()}\\\n${canary()}=1\n`, 1],
    ["a bare secret", () => `A=1\n${canary()}\n`, 2],
    ["a line with a colon", () => `token: ${canary()}`, 1],
    ["binary content", () => `A=1\n\0${canary()}`, 2],
  ];

  it.each(broken)("fails closed on %s: line number only, no names", (_name, text, line) => {
    const r = readEnvNames(text());
    expect(r.names).toEqual([]);
    expect(r.problems.map((p) => p.line)).toEqual([line]);
    expectNoLeak(JSON.stringify(r));
  });

  it.each(broken)("never leaks through any command with %s", (_name, text) => {
    const dir = project({ ".env": text(), ".env.local": `OK=${canary()}\n` });
    for (const command of ["example", "check", "json"] as const) {
      const r = run(dir, command);
      expect(r.code, command).toBe(2);
      expectNoLeak(r.out, r.err);
    }
    expect(fs.existsSync(path.join(dir, ".env.example"))).toBe(false);
  });
});

describe("engkit env example", () => {
  it("creates .env.example with names only", () => {
    const dir = project({ ".env": everything(), ".env.production": `# ${canary()}\nEXTRA=${canary()}\n` });
    const r = run(dir, "example");
    expect(r.code).toBe(0);
    expect(read(dir, ".env.example")).toBe([...NAMES, "EXTRA"].map((n) => `${n}=\n`).join(""));
    expectNoLeak(r.out, r.err, read(dir, ".env.example"));
  });

  it("appends only the missing names and leaves the existing lines as they are", () => {
    const before = "# Database\r\nA=localhost";
    const dir = project({ ".env.example": before, ".env": `A=${canary()}\nB=${canary()}\n` });
    const r = run(dir, "example");
    expect(read(dir, ".env.example")).toBe(`${before}\r\nB=\r\n`);
    expectNoLeak(r.out, r.err, read(dir, ".env.example"));
    expect(run(dir, "example").out).toContain("up to date");
    expect(read(dir, ".env.example")).toBe(`${before}\r\nB=\r\n`);
  });

  it("ignores templates, backups and folders", () => {
    const dir = project({ ".env.sample": "S=1", ".env.bak": `B=${canary()}`, ".env~": `T=${canary()}`, ".env.test": `OK=${canary()}` });
    fs.mkdirSync(path.join(dir, ".env.d"));
    run(dir, "example");
    expect(read(dir, ".env.example")).toBe("OK=\n");
  });

  it("writes nothing without sources", () => {
    const dir = project({});
    expect(run(dir, "example").code).toBe(2);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses to write through a symlink", () => {
    const original = `A=${canary()}\n`;
    const dir = project({ ".env": original, ".env.local": `B=${canary()}\n` });
    fs.symlinkSync(".env", path.join(dir, ".env.example"));
    const r = run(dir, "example");
    expect(r.code).toBe(2);
    expect(read(dir, ".env")).toBe(original);
    expectNoLeak(r.out, r.err);
  });
});

describe("engkit env check", () => {
  it("reports missing variables (exit 1) and extra ones as warnings, by name only", () => {
    const dir = project({
      ".env.example": "A=\nB=\n",
      ".env": `A=${canary()}\nB=\n`,
      ".env.local": `A=${canary()}\nC=${canary()}\n`,
    });
    const r = run(dir, "check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("ok       .env\n");
    expect(r.out).toContain("missing  .env.local: B");
    expect(r.out).toContain("warning  .env.local: not in .env.example: C");
    expectNoLeak(r.out, r.err);

    const json = run(dir, "json");
    expect(JSON.parse(json.out)).toEqual({
      ok: false,
      reference: ".env.example",
      files: [
        { file: ".env", missing: [], extra: [] },
        { file: ".env.local", missing: ["B"], extra: ["C"] },
      ],
      errors: [],
    });
    expectNoLeak(json.out, json.err);
  });

  it("compares with the union when there is no example, and accepts a list of files", () => {
    const dir = project({ ".env.a": `A=${canary()}`, ".env.b": `B=${canary()}`, ".env.c": `C=${canary()}` });
    const r = run(dir, "check", [".env.a", ".env.b"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("missing  .env.a: B");
    expect(r.out).not.toContain(".env.c");
    expectNoLeak(r.out, r.err);
  });

  it("exits 0 when nothing is missing, and 2 for a missing file or nothing to compare", () => {
    const dir = project({ ".env.example": "A=\n", ".env": `A=${canary()}` });
    expect(run(dir, "check").code).toBe(0);
    expect(run(dir, "check", [".env.nope"])).toMatchObject({ code: 2, err: expect.stringContaining("ENOENT") });
    expect(run(project({ ".env.example": "A=\n" }), "check").code).toBe(2);
  });

  it("still compares the good files against the example when another one is broken", () => {
    const dir = project({ ".env.example": "A=\n", ".env": `B=${canary()}`, ".env.bad": canary() });
    const r = run(dir, "check");
    expect(r.code).toBe(2);
    expect(r.out).toContain("missing  .env: A");
    expect(r.err).toContain(".env.bad:1");
    expectNoLeak(r.out, r.err);
  });
});

describe("random values through the built CLI", () => {
  const bin = path.join(import.meta.dirname, "..", "..", "dist", "cli.js");

  it("never prints or writes a value", () => {
    const quote = ['"', "'", ""];
    const lines = Array.from({ length: 60 }, (_, i) => {
      const q = quote[i % 3]!;
      const gap = q === "" ? " " : "\n";
      return `VAR_${i}=${q}${canary()}${gap}${canary()}${q}`;
    });
    const dir = project({ ".env": lines.join("\n"), ".env.local": `ONLY_LOCAL=${canary()}\n` });
    for (const args of [["env", "example"], ["env", "check"], ["env", "check", "--json"], ["env", "check", ".env"]]) {
      const r = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf-8" });
      expect(r.status, args.join(" ")).not.toBeNull();
      expectNoLeak(r.stdout, r.stderr);
    }
    expectNoLeak(read(dir, ".env.example"));
    expect(read(dir, ".env.example").split("\n").filter(Boolean)).toHaveLength(61);
  });
});
