import { describe, expect, it } from "vitest";
import { cleanCss } from "../src/core/diagram/css.js";
import { EXAMPLES, KINDS, generate, type TableInput } from "../src/core/diagram/generate.js";
import { MAX_AREA, MAX_SIDE, pngSize } from "../src/core/diagram/png.js";
import { FORMULA_REFUSED, MAX_TEXT, check, parsedLines, toProblem, unsupported } from "../src/core/diagram/source.js";
import { TableError, detectDelimiter, readTable } from "../src/core/diagram/table.js";
import { LANGS } from "../src/i18n.js";
import { MERMAID_MESSAGES } from "../src/mermaid/i18n.js";

const failure = (input: TableInput) => {
  try {
    generate(input);
  } catch (e) {
    if (e instanceof TableError) return { code: e.code, line: e.line, column: e.column, value: e.value, table: e.table };
    throw e;
  }
  return null;
};

describe("reading tables", () => {
  const rows = [
    { line: 2, cells: ["a", "b c"] },
    { line: 3, cells: ["d", "e"] },
  ];

  it.each([
    ["comma", "x,y\na,b c\nd,e"],
    ["semicolon", "x;y\na;b c\nd;e"],
    ["tab", "x\ty\na\tb c\nd\te"],
    ["Windows line ends and a byte order mark", "\uFEFFx,y\r\na,b c\r\nd,e\r\n"],
    ["Markdown", "| x | y |\n|---|:--:|\n| a | b c |\n| d | e |"],
  ])("reads %s", (_, text) => {
    const table = readTable(text);
    expect(table.header).toEqual(["x", "y"]);
    expect(table.rows.map((r) => r.cells)).toEqual(rows.map((r) => r.cells));
  });

  it("reads Markdown without outer pipes, and an escaped pipe", () => {
    expect(readTable("x | y\n--- | ---\na \\| b | c").rows[0]!.cells).toEqual(["a | b", "c"]);
  });

  it("numbers the lines as typed, also after blank lines and cells of several lines", () => {
    expect(readTable('x,y\n\n"a\nmore",b\nc,d').rows.map((r) => r.line)).toEqual([3, 5]);
    expect(readTable("| x |\n|---|\n\n| a |").rows.map((r) => r.line)).toEqual([4]);
  });

  it("ignores delimiters inside quotes when it detects one", () => {
    expect(detectDelimiter('"a,b,c";d;e\n1;2;3')).toBe(";");
  });

  it.each([
    ["", "empty"],
    ["x,y", "no-rows"],
    ['x,y\n"a,b', "syntax"],
    ["x,y\na,b,c", "cell-count"],
    [`x\n${"a".repeat(200_001)}`, "too-long"],
  ])("refuses a table (%#)", (text, code) => {
    expect(() => readTable(text)).toThrow(expect.objectContaining({ code }));
  });
});

describe("column names", () => {
  const flow = (text: string) => failure({ kind: "flowchart", text });

  it("accepts Spanish and English, without caring about case or accents", () => {
    for (const header of ["origen,destino,etiqueta", "SOURCE,Target,Label", "from,to,label"]) expect(flow(`${header}\na,b,c`)).toBeNull();
    expect(failure({ kind: "gantt", text: "Sección,Tarea,Inicio,Duración,Después\nx,y,2026-01-01,1d," })).toBeNull();
  });

  it.each([
    ["origen,destino,color\na,b,c", { code: "unknown-column", line: 1, column: "color" }],
    ["origen,source,destino\na,b,c", { code: "repeated-column", line: 1, column: "source" }],
    ["origen\na", { code: "missing-column", line: 1, column: "destino / target" }],
    ["origen,destino\na,b\n,c", { code: "required", line: 3, column: "origen" }],
  ])("says what is wrong (%#)", (text, expected) => {
    expect(flow(text)).toMatchObject(expected);
  });
});

describe("generating code", () => {
  it.each(LANGS.flatMap((lang) => KINDS.map((kind) => [lang, kind] as const)))("the %s %s example has nothing to replace", (lang, kind) => {
    const example = EXAMPLES[lang][kind];
    const result = generate({ kind, ...example });
    expect(result.replaced).toEqual([]);
    expect(result.outline.length).toBeGreaterThan(0);
  });

  it("gives nodes generated ids, one per name", () => {
    const { code } = generate({ kind: "flowchart", direction: "TD", text: "source,target,label\nend,graph,\ngraph,end,go" });
    expect(code).toBe('flowchart TD\n  n1["end"]\n  n2["graph"]\n  n1 --> n2\n  n2 -->|"go"| n1');
  });

  it("writes a sequence diagram with entity codes", () => {
    const { code, replaced } = generate({ kind: "sequence", text: 'from,to,message,type\n"A;B",C,#1: <x>,reply' });
    expect(code).toBe("sequenceDiagram\n  participant p1 as A#59;B\n  participant p2 as C\n  p1-->>p2: #35;1#58; #lt;x#gt;");
    expect(replaced).toEqual([]);
  });

  it("reports what it cannot write as it is", () => {
    expect(generate({ kind: "flowchart", text: 'source,target\n"say ""x""",a>b' }).replaced).toEqual([
      { table: "main", line: 2, column: "source", from: 'say "x"', to: "say \uFF02x\uFF02" },
      { table: "main", line: 2, column: "target", from: "a>b", to: "a\uFF1Eb" },
    ]);
    expect(generate({ kind: "er", text: "entity,attribute,type\nclient,full name,var char" }).replaced.map((r) => r.to)).toEqual(["var_char", "full_name"]);
    // an underscore inside a word stays
    expect(generate({ kind: "er", text: "entity,attribute,type\norder_item,id,int" }).replaced).toEqual([]);
  });

  // every control and zero-width character, and the others that take no room
  const unseen = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
  const every: string[] = [];
  for (let c = 0; c <= 0x10ffff; c++) if (unseen.test(String.fromCodePoint(c))) every.push(String.fromCodePoint(c));

  /** One table of each kind with `text` in every field that takes free text. */
  const tables = (text: string): TableInput[] => {
    const q = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const row = (...cells: string[]) => cells.map(q).join(",");
    return [
      { kind: "flowchart", text: `source,target,label\n${row(`a${text}b`, text + "c", `d${text}`)}` },
      { kind: "sequence", text: `from,to,message\n${row(`a${text}b`, text + "c", `d${text}`)}` },
      { kind: "gantt", text: `section,task,start,duration\n${row(`a${text}b`, `section ${text}`, "2026-01-01", "1d")}\n${row("", `${text}c`, "2026-01-01", "1d")}` },
      {
        kind: "er",
        text: `entity,attribute,type,comment\n${row(`a${text}b`, `c${text}`, `d${text}`, `e${text}f`)}`,
        relations: `source,source_cardinality,target,target_cardinality,label\n${row(`${text}g`, "1", `h${text}`, "1", `i${text}j`)}`,
      },
    ];
  };

  it("never writes a control or zero-width character, whatever the cells have", () => {
    expect(every.length).toBeGreaterThan(4000);
    const syntax = ['<b> &amp; #35; %%{x}%% $$y$$ fa:fa-user `*_z_*` ~s~ \\n [a](b) "q" ; :', "section title", "click", "`start"];
    const chunks = Array.from({ length: Math.ceil(every.length / 500) }, (_, i) => every.slice(i * 500, (i + 1) * 500).join("x"));
    for (const text of [...chunks, ...syntax, ...syntax.map((s) => `\u200B${s}\u0007`)]) {
      for (const input of tables(text)) {
        const { code } = generate(input);
        // the line breaks between statements are the only ones
        expect(code.replaceAll("\n", "").match(unseen)?.[0].codePointAt(0), `${input.kind}`).toBeUndefined();
      }
    }
    for (const lang of LANGS) for (const kind of KINDS) expect(generate({ kind, ...EXAMPLES[lang][kind] }).code.replaceAll("\n", "")).not.toMatch(unseen);
  });

  it("writes an invisible character as its code point, and says in which field", () => {
    const { code, replaced } = generate({ kind: "sequence", text: "from,to,message\nA\u200BB,C,x\u0007y" });
    expect(code).toContain("A\u27E8U+200B\u27E9B");
    expect(replaced.map((r) => [r.line, r.column, r.to])).toEqual([
      [2, "message", "x\u27E8U+0007\u27E9y"],
      [2, "from", "A\u27E8U+200B\u27E9B"],
    ]);
  });

  it("replaces only what would be read as syntax", () => {
    const plain = "R&D, issue #4, 50% of $5: a_b [x]";
    expect(generate({ kind: "flowchart", text: `source,target\n"${plain}",b` }).replaced).toEqual([]);
    expect(generate({ kind: "flowchart", text: "source,target\n&amp; #35; %% $$,b" }).replaced[0]!.to).toBe("\uFF06amp\uFF1B".replace("\uFF1B", ";") + " \uFF0335; \uFF05\uFF05 \uFF04\uFF04");
    expect(generate({ kind: "gantt", text: "task,start,duration\nsection one,2026-01-01,1d" }).replaced.map((r) => r.to)).toEqual(["\uFF53ection one"]);
  });

  it("never writes a line break or a directive from a cell", () => {
    const { code } = generate({ kind: "sequence", text: 'from,to,message\nA,B,"one\ntwo %%{init: {}}%%"' });
    expect(code.split("\n")).toHaveLength(4);
    expect(code).not.toContain("%%");
  });

  it("orders tasks without a section first, and gives ids that do not collide", () => {
    const { code } = generate({ kind: "gantt", text: "section,task,id,start,end,after,status\nS,b,t1,2026-01-01,2026-01-02,,\n,a,,,,t1,milestone" });
    expect(code).toBe("gantt\n  dateFormat YYYY-MM-DD\n  a :milestone, t2, after t1, 0d\n  section S\n  b :t1, 2026-01-01, 2026-01-02");
  });

  it.each([
    ["task,start,duration\nx,2026-02-30,1d", "date"],
    ["task,start,end\nx,2026-02-02,2026-02-01", "date"],
    ["task,start,duration\nx,2026-01-01,soon", "duration"],
    ["task,duration\nx,1d", "start"],
    ["task,start\nx,2026-01-01", "end"],
    ["task,id,start,duration\nx,1a,2026-01-01,1d", "id"],
    ["task,id,start,duration\nx,a,2026-01-01,1d\ny,a,2026-01-01,1d", "repeated-id"],
    ["task,after,duration\nx,nobody,1d", "unknown-id"],
    ["task,start,duration,status\nx,2026-01-01,1d,maybe", "status"],
    ["task,start,duration,status\nx,2026-01-01,1d,constructor", "status"],
  ])("checks the gantt table (%#)", (text, code) => {
    expect(failure({ kind: "gantt", text })).toMatchObject({ code });
  });

  it("checks keys, cardinalities and message types, and names the table", () => {
    const text = "entity,attribute,type\nA,id,int";
    expect(failure({ kind: "er", text: "entity,attribute,type,key\nA,id,int,XX" })).toMatchObject({ code: "key", value: "XX", table: "main" });
    expect(failure({ kind: "er", text, relations: "source,source_cardinality,target,target_cardinality\nA,2,B,1" })).toMatchObject({ code: "cardinality", value: "2", line: 2, table: "relations" });
    expect(failure({ kind: "er", text, relations: "source\nA" })).toMatchObject({ code: "missing-column", table: "relations" });
    expect(failure({ kind: "sequence", text: "from,to,message,type\nA,B,c,toString" })).toMatchObject({ code: "message-type" });
  });
});

describe("error lines", () => {
  it("follows the removals Mermaid makes before parsing", () => {
    const text = '---\ntitle: x\n---\n\n%% comment\n%%{init: {}}%%\nflowchart LR\n\n  %% another\n  A';
    // the lines typed that are left: "flowchart LR", and "A"; blank lines before a comment go with it
    expect(parsedLines(text)).toEqual([7, 10]);
  });

  it("maps the line of each kind of parser", () => {
    const text = "%% c\nflowchart LR\n  ][";
    expect(toProblem(new Error("Parse error on line 2:\n..."), text)).toMatchObject({ code: "syntax", line: 3, source: "  ][" });
    expect(toProblem({ message: "Parsing failed", result: { lexerErrors: [{ line: 2 }] } }, text)).toMatchObject({ line: 3 });
    expect(toProblem({ message: "Parsing failed", result: { parserErrors: [{ token: { startLine: NaN } }] } }, text).line).toBeUndefined();
    expect(toProblem(new Error("Parse error on line 99:"), text).line).toBe(3);
  });

  it("does not invent a line", () => {
    expect(toProblem(new Error("Invalid date:x"), "gantt")).toEqual({ code: "invalid-date", detail: "Invalid date:x" });
    expect(toProblem("odd", "x")).toEqual({ code: "render", detail: "odd" });
  });
});

describe("checks before drawing", () => {
  it.each([
    'A@{ img: "https://a.example/x.png" }',
    "A@{ shape: x, img : '//a.example/x.png' }",
    'A@{ "img": "x.png" }',
    "A@{\n  img: https://a.example/x.png\n}",
  ])("refuses %s", (code) => {
    expect(check(`flowchart LR\n  ${code}`)).toMatchObject({ code: "external-image" });
  });

  it("accepts a data: picture and a label that says img", () => {
    expect(check('flowchart LR\n  A@{ img: "data:image/png;base64,AA==" }')).toBeNull();
    expect(check('flowchart LR\n  A["img: x"]')).toBeNull();
  });

  it("limits the size", () => {
    expect(check(" ")).toEqual({ code: "empty" });
    expect(check("x".repeat(MAX_TEXT + 1))).toEqual({ code: "too-long" });
  });

  it("refuses a formula, and says where", () => {
    expect(check("sequenceDiagram\n  A->>B: $$x$$ <img src=y>")).toMatchObject({ code: "formula", line: 2 });
    expect(check("flowchart LR\n  A[$5 and $$]")).toBeNull();
    expect(toProblem(new Error(FORMULA_REFUSED), "x")).toEqual({ code: "formula" });
  });

  it("notices ELK", () => {
    expect(unsupported("flowchart-elk LR")).toEqual(["no-elk"]);
    expect(unsupported('%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%')).toEqual(["no-elk"]);
    expect(unsupported("flowchart LR\n A[elk] --> B[$5]")).toEqual([]);
  });
});

describe("cleaning CSS", () => {
  it.each([
    "fill:url(https://a.example/x)",
    "fill:url( 'x.png' )",
    "@import 'x.css'; a{}",
    "@import url(//a.example/x);",
    "@font-face{src:url(x)}",
    "background:\\75rl(//a.example/x)",
    "background:u\\rl(//a.example/x)",
    "background:image-set('//a.example/x' 1x)",
    "fill:url/**/(//a.example/x)",
  ])("removes what loads from %s", (css) => {
    expect(cleanCss(css, true)).not.toMatch(/a\.example|x\.png|x\.css|@import|url\(x/);
  });

  it("keeps references inside the file, and CSS that loads nothing, as they are", () => {
    for (const css of ["url(#arrow)", 'url("#a b")', "fill: #333; font-family: system-ui", ".a::after{content:'\\201C'}"]) expect(cleanCss(css, true)).toBe(css);
  });
});

describe("the PNG size", () => {
  it("uses the scale, within what browsers can draw", () => {
    expect(pngSize(100, 50, 2)).toEqual({ width: 200, height: 100, scaled: false });
    const wide = pngSize(20_000, 10, 2);
    expect(wide).toMatchObject({ width: MAX_SIDE, scaled: true });
    const big = pngSize(5000, 5000, 3);
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_AREA);
  });
});

describe("the translations of the Mermaid page", () => {
  const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const keys = Object.keys(MERMAID_MESSAGES.es) as (keyof typeof MERMAID_MESSAGES.es)[];

  it("both languages have the same keys and parameters, and no empty text", () => {
    expect(Object.keys(MERMAID_MESSAGES.en)).toEqual(keys);
    for (const key of keys) {
      for (const lang of LANGS) expect(MERMAID_MESSAGES[lang][key].trim(), `${lang} ${key}`).not.toBe("");
      expect(params(MERMAID_MESSAGES.en[key]), key).toEqual(params(MERMAID_MESSAGES.es[key]));
    }
  });
});
