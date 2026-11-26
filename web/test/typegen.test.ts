import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseJson } from "../src/core/json.js";
import { Notices } from "../src/core/notice.js";
import { toTypeScript, toZod } from "../src/core/typegen.js";

const SAMPLES: Record<string, string> = {
  object: '{"id":1,"name":"a","ok":true,"none":null}',
  nested: '{"customer":{"address":{"city":"x"}},"items":[{"sku":"a","qty":1},{"sku":"b","note":null}]}',
  arrays: '{"mixed":[1,"a",true,null],"empty":[],"grid":[[1],[2,3]],"maybe":[{"a":1},null]}',
  rootArray: '[{"a":1},{"b":"x"}]',
  rootScalar: '"text"',
  rootNull: "null",
  rootUnion: '[1,{"a":[]}]',
  names: '{"a b":1,"1x":2,"class":{"x":1},"date":{"y":1},"Root":{"z":1},"item":[{"q":1}],"items":[{"w":1}],"z":{},"__proto__":{"p":1},"áéí":{"n":1}}',
  sameKeys: '{"a":{"child":{"x":1}},"b":{"child":{"y":"s"}}}',
  changingTypes: '[{"v":1},{"v":"s"},{"v":{"w":1}},{"v":[1]},{"v":null},{}]',
};

const dir = path.join(import.meta.dirname, ".tmp-typegen");
const node = (name: string) => parseJson(SAMPLES[name]!).node;

beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(SAMPLES)) {
    // the sample goes through JSON.parse so that "__proto__" stays a key
    fs.writeFileSync(path.join(dir, `${name}.types.ts`), `${toTypeScript(node(name), new Notices())}\nexport const sample: Root = ${name === "names" ? "undefined as never" : SAMPLES[name]};\n`);
    fs.writeFileSync(path.join(dir, `${name}.zod.ts`), toZod(node(name), new Notices()));
  }
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { types: [] }, include: ["./*.ts"] }));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("generated code", () => {
  it("type-checks, and each sample satisfies its TypeScript type", { timeout: 60_000 }, () => {
    const tsc = path.join(import.meta.dirname, "..", "node_modules", "typescript", "bin", "tsc");
    try {
      execFileSync(process.execPath, [tsc, "--noEmit", "-p", path.join(dir, "tsconfig.json")], { encoding: "utf-8", stdio: "pipe" });
    } catch (e) {
      expect.fail((e as { stdout: string }).stdout);
    }
  });

  it.each(Object.keys(SAMPLES))("the Zod schema of %s accepts the sample", async (name) => {
    const module = (await import(/* @vite-ignore */ pathToFileURL(path.join(dir, `${name}.zod.ts`)).href)) as {
      RootSchema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } };
    };
    const result = module.RootSchema.safeParse(JSON.parse(SAMPLES[name]!));
    expect(result.error).toBeUndefined();
    expect(module.RootSchema.safeParse(Symbol("wrong")).success).toBe(false);
  });
});

describe("shapes", () => {
  it("marks optional keys and nullable values", () => {
    const ts = toTypeScript(node("nested"), new Notices());
    expect(ts).toContain("export interface Item {\n  sku: string;\n  qty?: number;\n  note?: null;\n}");
    expect(ts).toContain("items: Item[];");
  });

  it("writes unions, empty arrays and aliases", () => {
    expect(toTypeScript(node("arrays"), new Notices())).toContain("mixed: (string | number | boolean | null)[];\n  empty: unknown[];\n  grid: number[][];");
    expect(toTypeScript(node("rootScalar"), new Notices())).toBe("export type Root = string;\n");
    expect(toZod(node("arrays"), new Notices())).toContain("z.union([z.string(), z.number(), z.boolean()]).nullable()");
  });

  it("does not shadow global names and quotes keys that need it", () => {
    const ts = toTypeScript(node("names"), new Notices());
    expect(ts).not.toMatch(/interface (Date|Object|String) /);
    expect(ts).toContain('"a b": number;');
    expect(toZod(node("names"), new Notices())).toContain('["__proto__"]:');
  });

  it("reports numbers a number type cannot hold", () => {
    const notices = new Notices();
    toTypeScript(parseJson('{"id":12345678901234567890123}').node, notices);
    expect(notices.list().map((n) => n.code)).toEqual(["number-precision"]);
  });
});
