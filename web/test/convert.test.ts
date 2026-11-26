import { describe, expect, it } from "vitest";
import { FORMATS, convert, read, write, type Format } from "../src/core/convert.js";
import { CoreError, Notices } from "../src/core/notice.js";
import type { Value } from "../src/core/value.js";

const run = (from: Format, to: Format, text: string, delimiter?: "," | ";" | "\t") => {
  const r = convert(from, to, text, delimiter ? { delimiter } : {});
  return { text: r.text, codes: [...new Set(r.notices.map((n) => n.code))].sort() };
};
const back = (format: Format, text: string): Value => read(format, text, new Notices());
const error = (from: Format, to: Format, text: string) => {
  try {
    convert(from, to, text);
  } catch (e) {
    return e instanceof CoreError ? e.code : `not a CoreError: ${String(e)}`;
  }
  return "no error";
};

/** Data every format can hold (strings, nested objects, lists of two or more). */
const COMMON = { root: { name: "Ana", note: 'a, "b" <c> & d\nline', tags: ["x", "y"], deep: { list: [{ k: "1" }, { k: "2" }] } } };

describe("round trips", () => {
  it.each(["json", "yaml", "toml", "xml"] as const)("%s keeps structure and text", (format) => {
    const written = write(format, COMMON, new Notices());
    expect(back(format, written)).toEqual(COMMON);
  });

  it("CSV keeps flat text rows", () => {
    const rows = [{ a: "1", b: 'x, "y"\nz' }, { a: "", b: " s " }];
    expect(back("csv", write("csv", rows, new Notices()))).toEqual(rows);
  });

  it.each(["json", "yaml", "toml"] as const)("%s keeps types and large integers", (format) => {
    const data = { i: 42, f: 1.5, t: true, big: 9007199254740993n, empty: "", list: [] as Value[] };
    expect(back(format, write(format, data, new Notices()))).toEqual(data);
  });

  const SOURCE: Record<Format, string> = {
    json: '{"root":{"a":"1","b":["x","y"]}}',
    yaml: "root:\n  a: '1'\n  b: [x, y]\n",
    toml: '[root]\na = "1"\nb = ["x", "y"]\n',
    xml: "<root><a>1</a><b>x</b><b>y</b></root>",
    csv: "a,b\n1,x\n2,y\n",
  };
  const pairs = FORMATS.flatMap((from) => FORMATS.filter((to) => to !== from).map((to) => [from, to] as const));

  it.each(pairs)("%s -> %s produces readable output", (from, to) => {
    const result = convert(from, to, SOURCE[from]);
    expect(() => read(to, result.text, new Notices())).not.toThrow();
    expect(result.text.trim()).not.toBe("");
  });
});

describe("nothing is lost in silence", () => {
  it.each([
    ["json", "toml", '{"a":null,"b":[1,null]}', ["toml-null"]],
    ["json", "toml", "[1]", ["toml-wrapped"]],
    ["json", "toml", '"x"', ["toml-wrapped"]],
    ["json", "toml", "null", ["toml-null", "toml-wrapped"]],
    ["json", "yaml", '{"a":1,"a":2}', ["duplicate-key"]],
    ["json", "yaml", '{"a":0.1234567890123456789}', ["number-precision"]],
    ["json", "yaml", '{"a":123456789012345678}', ["big-integer"]],
    ["yaml", "json", "a: .inf\nb: .nan", ["non-finite"]],
    ["yaml", "json", "# c\na: 1", ["comments-lost"]],
    ["yaml", "json", "a: 1 # c", ["comments-lost"]],
    ["yaml", "json", "a: &x [1]\nb: *x", ["yaml-aliases"]],
    ["yaml", "json", "a: 1\n---\nb: 2", ["yaml-multi-document"]],
    ["yaml", "json", "1: a\ntrue: b", ["key-as-text"]],
    ["yaml", "json", "a: !custom x", ["yaml-warning"]],
    ["yaml", "json", "a: 0.1234567890123456789", ["number-precision"]],
    ["toml", "json", "d = 2026-03-09T10:00:00Z", ["date-as-text"]],
    ["toml", "json", "# c\na = 1", ["comments-lost"]],
    ["toml", "json", "a = 0.1234567890123456789", ["number-precision"]],
    ["toml", "json", 'a = "# not a comment 0.1234567890123456789"', []],
    ["json", "csv", '[{"a":{"b":1}}]', ["csv-flattened", "csv-types"]],
    ["json", "csv", '[{"a":["x"]}]', ["csv-array"]],
    ["json", "csv", '[{"a":null},{"b":"x"}]', ["csv-missing", "csv-null"]],
    ["json", "csv", '{"a":"x"}', ["csv-single-row"]],
    ["json", "csv", '["x"]', ["csv-scalar-rows"]],
    ["json", "csv", '[{"a":"=1+1"},{"a":"@x"}]', ["csv-formula"]],
    ["json", "csv", '[{"a":"-12.5"}]', []],
    ["csv", "json", "a\n1", ["csv-text"]],
    ["xml", "json", "<a><!-- c --><b>1</b></a>", ["comments-lost", "xml-text"]],
    ["xml", "json", "<a><b/><c/><b/></a>", ["xml-order", "xml-text"]],
    ["xml", "json", "<a>t<b/>u</a>", ["xml-mixed", "xml-text"]],
    ["xml", "json", "<a>  s  </a>", ["xml-text", "xml-trimmed"]],
    ["xml", "json", "<a><![CDATA[x]]></a>", ["xml-cdata", "xml-text"]],
    ["xml", "json", '<?xml version="1.0"?><?pi x?><a/>', ["xml-instructions", "xml-text"]],
    ["json", "xml", '[{"a":"1"},{"a":"2"}]', ["xml-wrapped"]],
    ["json", "xml", '{"r":{"a":1,"b":null,"c":[],"d":["x"]}}', ["xml-empty-array", "xml-null", "xml-single-item", "xml-types"]],
  ] as const)("%s -> %s %j", (from, to, text, codes) => {
    expect(run(from, to, text).codes).toEqual(codes);
  });
});

describe("outputs", () => {
  it("flattens nested objects into columns and writes lists as JSON", () => {
    expect(run("json", "csv", '[{"customer":{"name":"Ana","tags":["a","b"]},"empty":{}}]').text).toBe('customer.name,customer.tags,empty\nAna,"[""a"",""b""]",{}\n');
  });

  it("uses the chosen delimiter both ways", () => {
    expect(run("json", "csv", '[{"a":"1","b":"2"}]', ";").text).toBe("a;b\n1;2\n");
    expect(JSON.parse(run("csv", "json", "a\tb\n1\t2", "\t").text)).toEqual([{ a: "1", b: "2" }]);
  });

  it("keeps XML values and attributes as text", () => {
    expect(back("xml", '<a id="007"><b>1.50</b><c>&#65;&amp;</c></a>')).toEqual({ a: { "@_id": "007", b: "1.50", c: "A&" } });
    expect(write("xml", { a: { "@_on": true, b: "<&>" } }, new Notices())).toContain('<a on="true">');
  });

  it("escapes everything it writes in XML", () => {
    const data = { a: { "@_q": '"<&>', b: "</a><x/>]]>" } };
    expect(back("xml", write("xml", data, new Notices()))).toEqual(data);
  });

  it("writes large integers exactly", () => {
    for (const to of ["yaml", "toml", "csv", "xml"] as const) {
      expect(run("json", to, '{"a":9223372036854775807}').text).toContain("9223372036854775807");
    }
  });

  it.each(["json", "yaml", "toml", "csv", "xml"] as const)("%s output treats __proto__ as data", (to) => {
    expect(run("json", to, '{"__proto__":"x"}').text).toContain("__proto__");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it.each([
    ["yaml", "__proto__: {polluted: 1}"],
    ["toml", "[__proto__]\npolluted = 1"],
    ["csv", "__proto__\nx"],
  ] as const)("reading %s does not pollute prototypes", (from, text) => {
    expect(run(from, "json", text).text).toContain("__proto__");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("errors", () => {
  it.each([
    ["json", "yaml", "{", "json-syntax"],
    ["yaml", "json", "a: [", "yaml-syntax"],
    ["yaml", "json", "a: 1\na: 2", "yaml-syntax"],
    ["toml", "json", "a = ", "toml-syntax"],
    ["json", "toml", '{"a":99999999999999999999}', "toml-range"],
    ["csv", "json", 'a,b\n"x,1', "csv-syntax"],
    ["csv", "json", "a,b\n1", "csv-syntax"],
    ["csv", "json", "a,a\n1,2", "csv-header"],
    ["csv", "json", "a,\n1,2", "csv-header"],
    ["json", "csv", '[{"a.b":1,"a":{"b":2}}]', "csv-collision"],
    ["xml", "json", "<a><b></a>", "xml-syntax"],
    ["xml", "json", "<a/><b/>", "xml-syntax"],
    ["xml", "json", "<a>x</a>tail", "xml-syntax"],
    ["xml", "json", "<constructor/>", "xml-syntax"],
    ["xml", "json", '<!DOCTYPE a [<!ENTITY x "xx">]><a>&x;</a>', "xml-doctype"],
    ["json", "xml", '{"a b":1}', "xml-name"],
    ["json", "xml", '{"r":{"<x>":1}}', "xml-name"],
    ["json", "xml", '{"r":[[1],[2]]}', "xml-value"],
    ["json", "xml", '{"r":{"@_a":{}}}', "xml-value"],
    ["json", "xml", '{"r":"\\u0001"}', "xml-value"],
  ] as const)("%s -> %s %j is %s", (from, to, text, code) => {
    expect(error(from, to, text)).toBe(code);
  });

  it("gives the line of a syntax error", () => {
    for (const [from, text] of [["yaml", "a: 1\nb: ["], ["toml", "a = 1\nb = "], ["xml", "<a>\n<b></a>"]] as const) {
      expect(() => convert(from, "json", text), from).toThrowError(expect.objectContaining({ line: expect.any(Number) }) as unknown as Error);
    }
  });

  it("stops YAML alias bombs", () => {
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x]", ...["b", "c", "d", "e", "f"].map((k, i) => `${k}: &${k} [${Array(9).fill(`*${"abcde"[i]}`).join(",")}]`)].join("\n");
    expect(error("yaml", "json", bomb)).toBe("yaml-syntax");
  });

  it("an XML comment mentioning DOCTYPE is fine", () => {
    expect(error("xml", "json", "<a><!-- <!DOCTYPE x> --></a>")).toBe("no error");
  });
});
