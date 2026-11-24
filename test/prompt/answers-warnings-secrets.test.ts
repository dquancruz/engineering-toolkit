import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AnswersError, mergeAnswers, readAnswersFile, serializeAnswers, validateAnswers } from "../../src/prompt/answers.js";
import { loadChecklist } from "../../src/prompt/checklist.js";
import { applyPreset, normalizeAnswers } from "../../src/prompt/model.js";
import { loadEnvSecrets, mask, scanForSecrets } from "../../src/prompt/secrets.js";
import { evaluate } from "../../src/prompt/warnings.js";
import { tmpDir } from "../helpers.js";
import { promptFixture } from "./helpers.js";

describe("answers file", () => {
  it("reads the same answers from YAML and JSON", () => {
    expect(readAnswersFile(promptFixture("full.yaml"))).toEqual(readAnswersFile(promptFixture("full.json")));
    expect(readAnswersFile(promptFixture("full.yaml")).verify).toEqual(["`npm test`"]);
  });

  it("rejects unknown keys, wrong types, bad presets and missing files", () => {
    expect(() => validateAnswers({ goal: "x", nope: 1 }, "f")).toThrow(/unknown key\(s\) "nope"/);
    expect(() => validateAnswers({ goal: ["a"] }, "f")).toThrow(/"goal" must be text/);
    expect(() => validateAnswers({ limits: [1] }, "f")).toThrow(/text or a list of text/);
    expect(() => validateAnswers({ preset: "x" }, "f")).toThrow(/preset/);
    expect(() => validateAnswers([], "f")).toThrow(AnswersError);
    expect(() => readAnswersFile("/nope/missing.yaml")).toThrow(/File not found/);
    const bad = path.join(tmpDir(), "bad.json");
    fs.writeFileSync(bad, "{nope");
    expect(() => readAnswersFile(bad)).toThrow(/could not be parsed/);
  });

  it("accepts a single string for list elements and normalizes", () => {
    expect(validateAnswers({ limits: " a ", verify: ["x", "x", " "] }, "f")).toEqual({ limits: ["a"], verify: ["x"] });
  });

  it("round-trips through serialize", () => {
    const a = readAnswersFile(promptFixture("full.yaml"));
    const file = path.join(tmpDir(), "a.yaml");
    fs.writeFileSync(file, serializeAnswers(a));
    expect(readAnswersFile(file)).toEqual(a);
  });

  it("flags win over the file and replace lists", () => {
    expect(mergeAnswers({ goal: "a", limits: ["x"] }, { goal: "b", limits: ["y"] })).toEqual({ goal: "b", limits: ["y"] });
  });

  it("a preset adds its items before the user's, without duplicates", () => {
    const p = loadChecklist("en").presets.bugfix;
    const a = applyPreset({ limits: [p.limits[0]!, "mine"] }, p);
    expect(a.limits).toEqual([...p.limits, "mine"]);
    expect(normalizeAnswers({ goal: "  " }).goal).toBeUndefined();
  });
});

describe("warnings (empty or weak elements)", () => {
  const es = loadChecklist("es");
  const en = loadChecklist("en");
  const codes = (a: Parameters<typeof evaluate>[0], c = en) => evaluate(a, c).map((w) => `${w.element}:${w.code}`);

  it("flags every empty element, with specific messages for limits and autonomy", () => {
    const w = evaluate({}, en);
    expect(w.map((x) => x.element)).toEqual(["goal", "context", "material", "limits", "autonomy", "done", "verify", "response"]);
    expect(w.find((x) => x.element === "limits")?.message).toMatch(/no limits set/);
    expect(w.find((x) => x.element === "autonomy")?.message).toMatch(/when to stop and ask/);
  });

  it("a complete, concrete prompt has no warnings", () => {
    const a = {
      goal: "Add pagination to GET /orders",
      context: "v1 clients need a flat array",
      material: ["src/orders.ts"],
      limits: ["Do not change the schema"],
      autonomy: "Stop and ask before changing the public API",
      done: "GET /orders?page=2 returns 20 items",
      verify: ["`npm test`"],
      response: "A short summary",
    };
    expect(evaluate(a, en)).toEqual([]);
  });

  it("flags vague wording using the signals from the checklist, in each language", () => {
    expect(codes({ goal: "Improve the code base a lot" })).toContain("goal:weak");
    expect(codes({ goal: "Mejorar el rendimiento de todo" }, es)).toContain("goal:weak");
    expect(codes({ goal: "Add pagination to GET /orders" })).not.toContain("goal:weak");
    expect(codes({ goal: "Fix it" })).toContain("goal:weak"); // very short
  });

  it("flags a definition of done that cannot be checked", () => {
    expect(codes({ done: "make it work" })).toContain("done:not-checkable");
    expect(codes({ done: "Que quede bien" }, es)).toContain("done:not-checkable");
    expect(codes({ done: "returns 400 for an empty body" })).not.toContain("done:not-checkable");
    expect(codes({ done: "`npm test` passes" })).not.toContain("done:not-checkable");
    expect(codes({ done: "should be better" })).toContain("done:not-checkable");
  });

  it("flags a verification without a command", () => {
    expect(codes({ verify: ["see that it works"] })).toContain("verify:no-command");
    expect(codes({ verify: ["`npm test`"] })).not.toContain("verify:no-command");
    expect(codes({ verify: ["$ npm test"] })).not.toContain("verify:no-command");
  });
});

// Fake credentials are assembled at run time so that this file never contains a realistic token.
const fake = {
  github: "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5",
  aws: "AK" + "IA" + "ABCDEFGHIJKLMNOP",
  anthropic: "sk-" + "ant-" + "api03-" + "abcdefghijklmnopqrstuvwx",
  openai: "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz012345",
  slack: "xo" + "xb-" + "1234567890-abcdefghij",
  google: "AI" + "za" + "SyA1234567890abcdefghijklmnopqrstuv",
  stripe: "sk_" + "live_" + "abcdefghijklmnop1234",
  jwt: ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnop"].join("."),
  privateKey: "-----BEGIN " + "RSA PRIVATE KEY-----",
  url: "postgres://admin:" + "hunter2hunter2" + "@db.internal/app",
  assignment: "api_key = " + "abcd1234efgh5678ijkl",
};

describe("secret detection", () => {
  it.each(Object.entries(fake))("detects %s, and never reports it in full", (name, secret) => {
    const found = scanForSecrets({ context: `Look at this: ${secret}` });
    expect(found.length, name).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({ element: "context", line: 1 });
    for (const f of found) expect(f.excerpt, name).not.toContain(secret);
    expect(JSON.stringify(found)).not.toContain(secret.slice(4));
  });

  it("reports the element and the line, also in list items", () => {
    const found = scanForSecrets({ goal: "fine", limits: ["ok", `use ${fake.aws}`] });
    expect(found).toEqual([{ element: "limits", line: 2, kind: "AWS access key", excerpt: "AKIA***" }]);
  });

  it("does not flag ordinary text, paths, commands or placeholders", () => {
    const text = [
      "Add pagination to GET /orders and run `npm test`",
      "see docs/adr/0003-use-postgres.md and https://example.com/docs",
      "set API_KEY in your environment (never commit it)",
      "the password field must be hashed",
      "use sk-learn for the model", // too short to be a key
    ].join("\n");
    expect(scanForSecrets({ context: text })).toEqual([]);
  });

  it("masks to at most four characters", () => {
    expect(mask("abcdefghijklmnop")).toBe("abcd***");
    expect(mask("short")).toBe("***");
  });

  it("detects values from .env files by variable, never printing the value, and ignores examples", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".env"), ["API_TOKEN=zq9Xv-not-a-real-value-123", "DEBUG=true", "PORT=3000", "export DB_PASSWORD='p4ssw0rd-local-xyz'"].join("\n"));
    fs.writeFileSync(path.join(dir, ".env.example"), "API_TOKEN=example-token-value-123\n");
    const env = loadEnvSecrets(dir);
    expect(env.map((e) => e.name).sort()).toEqual(["API_TOKEN", "DB_PASSWORD"]);

    const found = scanForSecrets({ goal: "Call it with zq9Xv-not-a-real-value-123", context: "example-token-value-123 is fine" }, env);
    expect(found).toEqual([{ element: "goal", line: 1, kind: "value from an .env file", excerpt: ".env:API_TOKEN" }]);
  });

  it("does not flag short or boolean .env values", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".env"), "SECRET_FLAG=true\nAPI_KEY=abc\nNODE_ENV=development\n");
    expect(loadEnvSecrets(dir)).toEqual([]);
  });
});
