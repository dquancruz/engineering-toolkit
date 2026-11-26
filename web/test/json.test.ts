import { describe, expect, it } from "vitest";
import { jsonValue, parseJson, printJson } from "../src/core/json.js";
import { CoreError, Notices } from "../src/core/notice.js";
import { losesPrecision } from "../src/core/value.js";

const print = (text: string, indent = 2) => printJson(parseJson(text).node, indent);

describe("parseJson and printJson", () => {
  it("prettifies and minifies", () => {
    const text = '{"a":[1,{"b":null}],"c":{},"d":[]}';
    expect(print(text)).toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "c": {},\n  "d": []\n}');
    expect(print(print(text), 0)).toBe(text);
  });

  it("never alters numbers or strings", () => {
    const text = '{"big":12345678901234567890,"dec":0.1000000000000000000001,"exp":1E+400,"neg":-0,"s":"\\u0041\\/"}';
    expect(print(text, 0)).toBe(text);
    expect(print(print(text), 0)).toBe(text);
  });

  it("reports repeated keys with their path, without removing them", () => {
    const parsed = parseJson('{"a":{"b":1,"b":2},"c":[{"d":1,"d":1}]}');
    expect(parsed.duplicates).toEqual(["a.b", "c[0].d"]);
    expect(printJson(parsed.node, 0)).toContain('"b":1,"b":2');
  });

  it.each(["1", '"x"', "true", "null", " [ ] ", "﻿{}"])("accepts %s", (text) => {
    expect(() => parseJson(text)).not.toThrow();
  });

  it.each([
    ["", 1, 1],
    ["{", 1, 2],
    ['{"a":1,}', 1, 8],
    ["[1,]", 1, 4],
    ['{a:1}', 1, 2],
    ["{\n  \"a\": 1\n  \"b\": 2\n}", 3, 3],
    ["01", 1, 2],
    ["'x'", 1, 1],
    ['"abc', 1, 1],
    ['"a\tb"', 1, 1],
    ["[1] [2]", 1, 5],
    ["// c\n1", 1, 1],
    ["NaN", 1, 1],
  ])("rejects %j at line %i column %i", (text, line, column) => {
    expect(() => parseJson(text)).toThrowError(expect.objectContaining({ code: "json-syntax", line, column }) as unknown as Error);
  });

  it("limits the depth instead of overflowing the stack", () => {
    expect(() => parseJson("[".repeat(100_000))).toThrow(CoreError);
  });
});

describe("jsonValue", () => {
  const value = (text: string) => {
    const notices = new Notices();
    return { value: jsonValue(parseJson(text).node, notices), codes: notices.list().map((n) => n.code) };
  };

  it("keeps large integers exact and says so", () => {
    expect(value("[9007199254740993]")).toEqual({ value: [9007199254740993n], codes: ["big-integer"] });
    expect(value("9007199254740991")).toEqual({ value: 9007199254740991, codes: [] });
  });

  it("reports decimals that are rounded", () => {
    expect(value("0.12345678901234567891").codes).toEqual(["number-precision"]);
    expect(value("[0.1, 1.50, 1e3, 2E-7, -0.0]").codes).toEqual([]);
  });

  it("treats __proto__ as an ordinary key", () => {
    const result = value('{"__proto__":{"x":1},"constructor":2}').value as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["__proto__", "constructor"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as { x?: number }).x).toBeUndefined();
  });

  it.each([
    ["1e400", true],
    ["100000000000000000000", false],
    ["1_000.5", false],
    ["abc", false],
  ])("losesPrecision(%s) = %s", (literal, expected) => expect(losesPrecision(literal)).toBe(expected));
});
