import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/commands/init.js";
import { runInitLegacy } from "../../src/commands/legacy.js";
import { parseRef } from "../../src/legacy/evidence.js";
import { git } from "../git-helpers.js";
import { captureConsole } from "../helpers.js";
import { OLD_CODE, TODAY, check, commit, create, edit, evidence, oldCode, project, raw, read, reindex, write, type Fixture } from "./helpers.js";

let f: Fixture;
let rule: string;
beforeEach(() => {
  f = project();
  rule = create(f.dir, "rule", "Late fee");
});
afterEach(() => f.cleanup());

const REF = "erp:src/fee.cbl:2-4";
const setStatus = (value: string) => {
  write(f.dir, rule, read(f.dir, rule).replace(/^status: .*$/m, `status: ${value}`));
  reindex(f.dir);
};
const cite = (ref = REF) => {
  expect(evidence(f.dir, "add", ["RN-0001", ref]).code).toBe(0);
  reindex(f.dir);
};
const evidenceFindings = () => {
  const r = check(f.dir);
  return { errors: r.errors.filter((e) => e.startsWith("evidence")), warnings: r.warnings.filter((e) => e.startsWith("evidence")), text: r.text };
};
/** No line of the old code may end up in the project or in any output. */
const expectNoCode = (...texts: string[]) => {
  const files = (fs.readdirSync(f.dir, { recursive: true }) as string[])
    .map((n) => path.join(f.dir, n))
    .filter((n) => fs.statSync(n).isFile() && !n.includes(`${path.sep}.git${path.sep}`));
  for (const text of [...texts, ...files.map((n) => fs.readFileSync(n, "utf-8"))]) expect(text).not.toContain("ZZCODE");
};

describe("engkit evidence add", () => {
  it("records the reference and a quoted hash, without copying code or touching the body", () => {
    const body = read(f.dir, rule).split("\n---\n")[1];
    const r = evidence(f.dir, "add", ["RN-0001", REF]);
    expect(r.code).toBe(0);
    const text = read(f.dir, rule);
    expect(text).toMatch(/evidence:\n {2}- ref: erp:src\/fee\.cbl:2-4\n {4}hash: "[0-9a-f]{12}"\nquestions: \[\]\ndecision:\n---/);
    expect(text.split("\n---\n")[1]).toBe(body);
    expectNoCode(r.out, r.err);
  });

  it("records the commit only for a clean tracked file", () => {
    git(f.old, ["init", "-q"]);
    commit(f.old, "old");
    cite();
    expect(read(f.dir, rule)).toMatch(/commit: "[0-9a-f]{12}"/);
    oldCode(f.old, [...OLD_CODE, "dirty"]);
    cite("erp:src/fee.cbl:6");
    expect(read(f.dir, rule).match(/commit:/g)).toHaveLength(1);
  });

  it("fills the hash of a hand-written reference, keeps source entries and CRLF", () => {
    edit(f.dir, rule, "evidence: []", `evidence:\n  - source: F-01 # asked Jane\n  - ref: ${REF}`);
    write(f.dir, rule, read(f.dir, rule).replace(/\n/g, "\r\n"));
    reindex(f.dir);
    expect(evidenceFindings().warnings).toEqual(["evidence-unrecorded RN-0001"]);
    cite();
    const text = raw(f.dir, rule);
    expect(text.match(/ref:/g)).toHaveLength(1);
    expect(text).toContain("- source: F-01 # asked Jane");
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(evidenceFindings().warnings).toEqual([]);
  });

  it("keeps LF files as LF", () => {
    write(f.dir, rule, read(f.dir, rule));
    cite();
    expect(raw(f.dir, rule)).not.toContain("\r");
  });

  it("does not silently replace a recorded hash", () => {
    cite();
    expect(evidence(f.dir, "add", ["RN-0001", REF])).toMatchObject({ code: 0, out: expect.stringContaining("unchanged") });
    oldCode(f.old, OLD_CODE.map((l) => l.replace("0.05", "0.10")));
    const before = read(f.dir, rule);
    expect(evidence(f.dir, "add", ["RN-0001", REF]).code).toBe(1);
    expect(read(f.dir, rule)).toBe(before);
  });

  it.each([
    ["an unknown rule", "RN-0009", REF],
    ["a bad reference", "RN-0001", "erp:src/fee.cbl"],
    ["an unknown root", "RN-0001", "nope:src/fee.cbl:1"],
    ["a missing file", "RN-0001", "erp:src/other.cbl:1"],
    ["a line past the end", "RN-0001", "erp:src/fee.cbl:99"],
    ["a reversed range", "RN-0001", "erp:src/fee.cbl:4-2"],
  ])("rejects %s with exit 2", (_name, id, ref) => {
    const before = read(f.dir, rule);
    expect(evidence(f.dir, "add", [id, ref]).code).toBe(2);
    expect(read(f.dir, rule)).toBe(before);
  });
});

describe("path safety", () => {
  it.each(["erp:../secret:1", "erp:src/../../x:1", "erp:/etc/passwd:1", "erp:C:/x:1", "erp:src\\fee.cbl:1", "erp:.env:1", "erp:conf/.env.production:1"])(
    "rejects %s",
    (ref) => {
      expect(() => parseRef(ref)).toThrow();
      expect(evidence(f.dir, "add", ["RN-0001", ref]).code).toBe(2);
    }
  );

  it.skipIf(process.platform === "win32")("rejects symlinks that leave the root or point to an .env file", () => {
    write(f.dir, "outside.txt", "something outside the root\n");
    fs.symlinkSync(path.join(f.dir, "outside.txt"), path.join(f.old, "link.txt"));
    write(f.old, ".env", "SECRET=long-enough-secret-value\n");
    fs.symlinkSync(".env", path.join(f.old, "innocent.txt"));
    for (const name of ["link.txt", "innocent.txt"]) {
      const r = evidence(f.dir, "add", ["RN-0001", `erp:${name}:1`]);
      expect(r.code, name).toBe(2);
    }
    edit(f.dir, rule, "evidence: []", `evidence:\n  - ref: erp:link.txt:1\n    hash: "000000000000"`);
    reindex(f.dir);
    expect(evidenceFindings().errors).toEqual(["evidence-invalid RN-0001"]);
  });
});

describe("outdated evidence", () => {
  it("ignores indentation, trailing spaces and CRLF", () => {
    cite();
    write(f.old, "src/fee.cbl", OLD_CODE.map((l) => `\t\t${l.trim()}  `).join("\r\n") + "\r\n");
    expect(evidenceFindings()).toMatchObject({ errors: [], warnings: [] });
  });

  it("works on bytes that are not UTF-8", () => {
    fs.writeFileSync(path.join(f.old, "latin1.cbl"), Buffer.from("MOVE 'AÑO FISCAL' TO TITULO\xA0\n", "latin1"));
    cite("erp:latin1.cbl:1");
    expect(evidenceFindings().warnings).toEqual([]);
    fs.writeFileSync(path.join(f.old, "latin1.cbl"), Buffer.from("MOVE 'ANO FISCAL' TO TITULO\xA0\n", "latin1"));
    expect(evidenceFindings().warnings).toEqual(["evidence-changed RN-0001"]);
  });

  it("reports moved lines and update rewrites only the numbers", () => {
    cite();
    setStatus("confirmed");
    oldCode(f.old, ["* new header", "* more", ...OLD_CODE]);
    const found = evidenceFindings();
    expect(found).toMatchObject({ errors: [], warnings: ["evidence-moved RN-0001"] });
    expect(found.text).toContain("erp:src/fee.cbl:4-6");
    const hash = /hash: "(\w+)"/.exec(read(f.dir, rule))![1]!;
    const r = evidence(f.dir, "update", []);
    expect(r.code).toBe(0);
    expect(read(f.dir, rule)).toContain(`- ref: erp:src/fee.cbl:4-6\n    hash: "${hash}"`);
    expect(evidenceFindings().warnings).toEqual([]);
    expectNoCode(r.out, r.err, found.text);
  });

  it.each([
    ["confirmed", "errors"],
    ["modified", "errors"],
    ["draft", "warnings"],
    ["discarded", "warnings"],
    ["disputed", "warnings"],
  ] as const)("a change in a %s rule goes to %s", (status, bucket) => {
    cite();
    setStatus(status);
    oldCode(f.old, OLD_CODE.map((l) => l.replace("0.05", "0.10")));
    const found = evidenceFindings();
    expect(found[bucket]).toEqual(["evidence-changed RN-0001"]);
    expectNoCode(found.text);
  });

  it("reports a missing file and a truncated one", () => {
    cite();
    setStatus("confirmed");
    oldCode(f.old, OLD_CODE.slice(0, 2));
    expect(evidenceFindings().errors).toEqual(["evidence-changed RN-0001"]);
    const r = evidence(f.dir, "update", [], ["RN-0001"]);
    expect(r).toMatchObject({ code: 1, err: expect.stringContaining("past the end") });
    fs.rmSync(path.join(f.old, "src/fee.cbl"));
    expect(evidenceFindings().errors).toEqual(["evidence-missing RN-0001"]);
  });

  it("update records changed content only when the item is named with --accept", () => {
    cite();
    oldCode(f.old, OLD_CODE.map((l) => l.replace("0.05", "0.10")));
    const before = read(f.dir, rule);
    for (const ids of [[], ["RN-0001"]]) expect(evidence(f.dir, "update", ids).code).toBe(1);
    expect(read(f.dir, rule)).toBe(before);
    const r = evidence(f.dir, "update", [], ["RN-0001"]);
    expect(r).toMatchObject({ code: 0, out: expect.stringContaining("accepted") });
    expect(read(f.dir, rule)).not.toBe(before);
    expect(evidenceFindings().warnings).toEqual([]);
    expectNoCode(r.out, r.err);
  });

  it("does not move evidence that is ambiguous or too short", () => {
    cite("erp:src/fee.cbl:6");
    oldCode(f.old, ["x", "x", "x", "x", "x", "x", OLD_CODE[5]!, OLD_CODE[5]!]);
    expect(evidenceFindings().warnings).toEqual(["evidence-ambiguous RN-0001"]);
    expect(evidence(f.dir, "update", []).code).toBe(1);

    edit(f.dir, rule, /evidence:\n(?: .*\n)+/, "evidence: []\n");
    oldCode(f.old, OLD_CODE);
    const r = evidence(f.dir, "add", ["RN-0001", "erp:src/fee.cbl:7"]);
    expect(r.err).toContain("too short");
    reindex(f.dir);
    expect(evidenceFindings().warnings).toEqual(["evidence-weak RN-0001"]);
    oldCode(f.old, ["a new first line", ...OLD_CODE.slice(0, 6), "other", "    }"]);
    expect(evidenceFindings().warnings).toEqual(["evidence-weak RN-0001"]);
    expect(evidence(f.dir, "update", []).code).toBe(1);
  });

  it("rejects an unquoted hash, which YAML may read as a number", () => {
    edit(f.dir, rule, "evidence: []", `evidence:\n  - ref: ${REF}\n    hash: 123456789012`);
    reindex(f.dir);
    expect(evidenceFindings().errors).toEqual(["evidence-invalid RN-0001"]);
  });

  it("supports the project itself as the root 'self'", () => {
    write(f.dir, "src/app.ts", "export const LATE_FEE_RATE = 0.05;\n");
    cite("self:src/app.ts:1");
    expect(evidenceFindings()).toMatchObject({ errors: [], warnings: [] });
  });
});

describe("unavailable evidence roots", () => {
  beforeEach(() => {
    cite();
    cite("erp:src/fee.cbl:6");
    setStatus("confirmed");
    create(f.dir, "test", "Day 31", { rule: ["RN-0001"], source: ["F-01"] });
    fs.rmSync(f.old, { recursive: true });
  });

  it("warns once per root, with the number of references that were not verified", () => {
    const r = check(f.dir);
    expect(r).toMatchObject({ errors: [], warnings: ["evidence-unavailable .engkit.json"] });
    expect(r.text).toContain("2 evidence reference(s) NOT verified");
    expect(r.result.summary.unverifiedEvidence).toBe(2);
    expect(r.result.ok).toBe(true);
  });

  it("is an error with --strict unless it is explicitly allowed", () => {
    expect(check(f.dir, { strict: true }).errors).toContain("evidence-unavailable .engkit.json");
    const allowed = check(f.dir, { strict: true, allowUnavailableEvidence: true });
    expect(allowed.errors).not.toContain("evidence-unavailable .engkit.json");
    expect(allowed.warnings).toEqual(["evidence-unavailable .engkit.json"]);
    expect(allowed.result.summary.unverifiedEvidence).toBe(2);
  });

  it("evidence commands say so and change nothing", () => {
    const before = read(f.dir, rule);
    expect(evidence(f.dir, "add", ["RN-0001", REF]).code).toBe(1);
    expect(evidence(f.dir, "update", [], ["RN-0001"]).code).toBe(1);
    expect(read(f.dir, rule)).toBe(before);
  });

  it(".engkit.local.json overrides the path on this machine", () => {
    const elsewhere = path.join(f.dir, "old-copy");
    write(elsewhere, "src/fee.cbl", OLD_CODE.join("\n"));
    write(f.dir, ".engkit.local.json", JSON.stringify({ evidenceRoots: { erp: { path: elsewhere } } }));
    expect(check(f.dir, { strict: true }).errors).toEqual([]);
    write(f.dir, ".engkit.local.json", JSON.stringify({ evidenceRoots: { other: { path: "x" } } }));
    expect(() => check(f.dir)).toThrow(/not declared/);
  });
});

describe("configuration and init", () => {
  it.each([
    [{ evidenceRoots: { self: { path: "x" } } }, /reserved/],
    [{ evidenceRoots: { c: { path: "x" } } }, /at least 2/],
    [{ evidenceRoots: { erp: {} } }, /path/],
    [{ legacy: { rulesDir: "docs/r" } }, /legacy.testsDir/],
    [{ legacy: { rulesDir: "../r", testsDir: "t", defectsDir: "d", sources: "s.md", rulesIndex: "i.md" } }, /inside the project/],
  ])("rejects %j", (patch, message) => {
    write(f.dir, ".engkit.json", JSON.stringify({ ...JSON.parse(read(f.dir, ".engkit.json")), ...patch }));
    expect(() => check(f.dir)).toThrow(message);
  });

  it("running init again keeps the legacy settings and the files", () => {
    cite();
    const config = read(f.dir, ".engkit.json");
    const ignore = read(f.dir, ".gitignore");
    captureConsole(() => {
      runInit("en", { cwd: f.dir, today: TODAY });
      runInitLegacy("en", { cwd: f.dir, today: TODAY });
    });
    expect(JSON.parse(read(f.dir, ".engkit.json"))).toEqual(JSON.parse(config));
    expect(read(f.dir, ".gitignore")).toBe(ignore);
  });
});

describe("a large catalogue", () => {
  it("checks 500 rules in reasonable time", () => {
    cite();
    const text = read(f.dir, rule);
    for (let n = 2; n <= 500; n++) {
      const id = `RN-${String(n).padStart(4, "0")}`;
      write(f.dir, `docs/reglas/${id}-copy.md`, text.replaceAll("RN-0001", id));
    }
    reindex(f.dir);
    const start = performance.now();
    const r = check(f.dir);
    expect(performance.now() - start).toBeLessThan(15_000);
    expect(r).toMatchObject({ errors: [], warnings: [] });
  });
});
