/** The Mermaid page: drawing, errors, tables and downloads. */
import fs from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { generate, type TableInput } from "../src/core/diagram/generate.js";
import { codeBox, diagram, draw, openMermaid, panel, shownSvg, tab } from "./helpers.js";

const alert = (page: Page) => panel(page).getByRole("alert");
const bytes = async (download: Download) => fs.readFileSync(await download.path());
async function downloaded(page: Page, button: string): Promise<Download> {
  const event = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: button }).click();
  return event;
}

/** Width, height, and the share of pixels that are not transparent, of a PNG, as the browser reads it. */
const readPng = (page: Page, data: Buffer) =>
  page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [image.naturalWidth, image.naturalHeight];
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! > 0) painted++;
      if (pixels[i + 3]! > 200 && pixels[i]! + pixels[i + 1]! + pixels[i + 2]! < 300) dark++;
    }
    const total = canvas.width * canvas.height;
    return { width: canvas.width, height: canvas.height, painted: painted / total, dark };
  }, data.toString("base64"));

test("draws as the code is typed, and keeps the last valid diagram on an error", async ({ page }) => {
  await openMermaid(page);
  await draw(page, "flowchart LR\n  A[First] --> B[Second]");
  await expect(diagram(page)).toHaveAttribute("alt", /First.*Second/);

  await draw(page, "flowchart LR\n  A[First] --> B[Second]\n  B --x-->[");
  await expect(alert(page)).toContainText("Syntax error");
  await expect(alert(page)).toContainText("line 3");
  await expect(alert(page).locator("pre")).toHaveText("  B --x-->[");
  await expect(panel(page)).toContainText("last valid one");
  await expect(diagram(page)).toHaveAttribute("alt", /Second/);
  await expect(panel(page).getByRole("button", { name: "Download SVG" })).toBeDisabled();

  await draw(page, "flowchart LR\n  C[Third]");
  await expect(alert(page)).toBeEmpty();
  await expect(diagram(page)).toHaveAttribute("alt", /Third/);
});

// Mermaid removes front matter, directives, comments and leading blank lines before parsing
const BEFORE = '---\ntitle: x\n---\n\n%% a comment\n%%{init: {"theme": "default"}}%%\n';
for (const [type, code, bad] of [
  ["flowchart", "flowchart LR\n  A --> B\n%% another\n\n  ][", "  ]["],
  ["sequence", "sequenceDiagram\n  A->>B: x\n%% another\n  ???", "  ???"],
  ["er", "erDiagram\n  %% another\n  A ||--o{ B\n  C", "  A ||--o{ B"],
  ["class", "classDiagram\n  class A\n%% another\n  A <|-- ", "  A <|-- "],
  ["pie", 'pie\n%% another\n  "a" : 1\n  b c', "  b c"],
  ["gitGraph", "gitGraph\n  commit\n%% another\n  nonsense here", "  nonsense here"],
] as const) {
  test(`reports the line typed, not the line parsed (${type})`, async ({ page }) => {
    await openMermaid(page);
    const text = BEFORE + code;
    await draw(page, text);
    const expected = text.split("\n").indexOf(bad) + 1;
    await expect(alert(page)).toContainText(`(line ${expected})`);
  });
}

for (const [name, code, message] of [
  ["unknown type", "hello", "Unknown diagram type"],
  ["a date without a line", "gantt\n  dateFormat YYYY-MM-DD\n  T :a, 2026-99-99, 3d", "A date is not valid"],
  ["too long", `flowchart LR\n  A["${"x".repeat(50_001)}"]`, "longer than 50 000"],
  ["too many edges", `flowchart LR\n${"  A --> B\n".repeat(501)}`, "too many edges"],
  ["a web picture", 'flowchart LR\n  A@{ img: "https://blocked.invalid/a.png" }', "External images"],
] as const) {
  test(`explains ${name}`, async ({ page }) => {
    await openMermaid(page);
    await draw(page, code);
    await expect(alert(page)).toContainText(message);
    // nothing left behind by the failed drawing
    expect(await page.locator("body > *:not(#app):not(noscript):not(script)").count()).toBe(0);
  });
}

test("says what the build does not include", async ({ page }) => {
  await openMermaid(page);
  await draw(page, '---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A["$$x^2$$"] --> B');
  await expect(panel(page)).toContainText("The ELK layout is not included");
  await expect(panel(page)).toContainText("Formulas are not included");
  await expect(diagram(page)).toBeVisible();
});

test("journey labels are readable", async ({ page }) => {
  await openMermaid(page);
  await draw(page, "journey\n  section Work\n    Code: 5: Me");
  const fills = await page.evaluate((svg) => {
    const box = document.createElement("div");
    box.innerHTML = svg;
    document.body.append(box);
    const found = [...box.querySelectorAll("text.task, text.journey-section")].map((t) => getComputedStyle(t).fill);
    box.remove();
    return found;
  }, await shownSvg(page));
  expect(fills).toEqual(["rgb(51, 51, 51)", "rgb(51, 51, 51)"]);
});

test("downloads the SVG and the PNG", async ({ page }) => {
  await openMermaid(page);
  await draw(page, "flowchart LR\n  A[Start] --> B[End]");
  const svg = (await bytes(await downloaded(page, "Download SVG"))).toString("utf-8");
  expect(svg).toBe(await shownSvg(page));
  expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  const size = { width: Number(/ width="(\d+)"/.exec(svg)![1]), height: Number(/ height="(\d+)"/.exec(svg)![1]) };

  const white = await readPng(page, await bytes(await downloaded(page, "Download PNG")));
  expect(white).toMatchObject({ width: size.width * 2, height: size.height * 2, painted: 1 });
  // the text and the lines are there, not only the background
  expect(white.dark).toBeGreaterThan(100);

  await panel(page).getByRole("combobox", { name: "PNG scale" }).selectOption("3");
  await panel(page).getByRole("combobox", { name: "PNG background" }).selectOption("transparent");
  const clear = await readPng(page, await bytes(await downloaded(page, "Download PNG")));
  expect(clear).toMatchObject({ width: size.width * 3, height: size.height * 3 });
  expect(clear.painted).toBeGreaterThan(0.05);
  expect(clear.painted).toBeLessThan(1);
});

test("reduces a PNG that no browser could draw", async ({ page }) => {
  await openMermaid(page);
  await draw(page, `flowchart LR\n${Array.from({ length: 90 }, (_, i) => `  N${i}[Node number ${i}] --> N${i + 1}`).join("\n")}`);
  const png = await bytes(await downloaded(page, "Download PNG"));
  // the size is in the file's header
  expect(png.readUInt32BE(16)).toBeLessThanOrEqual(16_384);
  await expect(panel(page)).toContainText("the PNG was reduced");
});

test("zoom", async ({ page }) => {
  await openMermaid(page);
  await draw(page, "flowchart LR\n  A --> B");
  const natural = await diagram(page).evaluate((img: HTMLImageElement) => img.naturalWidth);
  await panel(page).getByRole("button", { name: "Zoom in" }).click();
  await expect(diagram(page)).toHaveAttribute("width", String(Math.round(natural * 1.5)));
  await panel(page).getByRole("button", { name: "Actual size" }).click();
  await expect(diagram(page)).toHaveAttribute("width", String(natural));
});

test("uses the diagram's own description as the text alternative", async ({ page }) => {
  await openMermaid(page);
  await draw(page, "flowchart LR\n  accTitle: Orders\n  accDescr: An order is paid and shipped\n  A --> B");
  await expect(diagram(page)).toHaveAttribute("alt", "Orders. An order is paid and shipped");
});

/** The text of the drawing without spaces: Mermaid splits words and lines into separate elements. */
const drawn = async (page: Page) =>
  page.evaluate(
    (svg) => [...new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("text")].map((t) => t.textContent).join("").replace(/[\s​]+/g, ""),
    await shownSvg(page)
  );
const squash = (text: string) => text.replace(/\s+/g, "");

/** Text that would be syntax, markup, an entity, a directive, an icon, Markdown or a formula. */
const HOSTILE = [
  'say "hi"',
  "a # b ; c : d",
  "<b>bold</b> <br/> & &amp;",
  "#quot; #35;",
  '%%{init: {"theme":"dark"}}%%',
  "%% not a comment",
  "fa:fa-user $$x$$",
  "`**md**` _x_ ~y~",
  "[x] (y) {z} |w| -->",
  "back\\nslash \\",
  "end",
  "section title click",
  "Ñandú café 你好",
];
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(",")).join("\n");

/** Every hostile text, in every place of each kind of table that takes free text. */
const TABLES: Record<string, (text: string) => { input: TableInput; shown: string[] }> = {
  "flowchart node and label": (text) => ({ input: { kind: "flowchart", text: csv([["source", "target", "label"], [`from ${text}`, text, `on ${text}`]]) }, shown: [`from ${text}`, text, `on ${text}`] }),
  "sequence participant and message": (text) => ({ input: { kind: "sequence", text: csv([["from", "to", "message"], [text, "Other", `say ${text}`]]) }, shown: [text, `say ${text}`] }),
  "gantt task and section": (text) => ({ input: { kind: "gantt", text: csv([["section", "task", "start", "duration"], [`part ${text}`, text, "2026-01-01", "30d"]]) }, shown: [`part ${text}`, text] }),
  "er entity, comment and relation": (text) => ({
    input: {
      kind: "er",
      text: csv([["entity", "attribute", "type", "comment"], [text, "id", "int", `about ${text}`]]),
      relations: csv([["source", "source_cardinality", "target", "target_cardinality", "label"], [text, "1", "Other", "0..n", `has ${text}`]]),
    },
    shown: [text, `about ${text}`, `has ${text}`],
  }),
};

for (const [name, table] of Object.entries(TABLES)) {
  test(`table texts are drawn as written or as reported: ${name}`, async ({ page }) => {
    test.slow();
    await openMermaid(page);
    for (const hostile of HOSTILE) {
      const { input, shown } = table(hostile);
      const result = generate(input);
      await draw(page, result.code);
      await expect(alert(page), `${hostile}\n${result.code}`).toBeEmpty();
      await expect(diagram(page)).toBeVisible();
      const text = await drawn(page);
      for (const expected of shown) {
        const written = result.replaced.find((r) => r.from === expected)?.to ?? expected;
        expect(text, `${hostile}\n${result.code}`).toContain(squash(written));
      }
    }
  });
}

test("a table becomes code, the code opens in the diagram, and replacing asks first", async ({ page }) => {
  await openMermaid(page, "?lang=en", "#table");
  for (const kind of ["flowchart", "er", "gantt", "sequence"]) {
    await tab(page, "Table → Mermaid").click();
    await panel(page).getByRole("combobox", { name: "Diagram type" }).selectOption(kind);
    await panel(page).getByRole("button", { name: "Load example" }).click();
    await panel(page).getByRole("button", { name: "Generate code" }).click();
    const code = await panel(page).getByRole("textbox", { name: "Generated code" }).inputValue();
    await panel(page).getByRole("button", { name: "Open in Diagram" }).click();
    if (kind !== "flowchart") await panel(page).getByRole("button", { name: "Replace", exact: true }).click();
    await expect(tab(page, "Diagram")).toHaveAttribute("aria-selected", "true");
    await expect(codeBox(page)).toHaveValue(code);
    await expect(panel(page).getByRole("alert")).toBeEmpty();
    // the description in words comes from the table
    await expect(diagram(page)).toHaveAttribute("alt", kind === "flowchart" ? /Start → Validate/ : kind === "er" ? /Customer \(1\) — Order \(0\.\.n\)/ : kind === "gantt" ? /Design: Sketch/ : /Web → API: POST \/orders/);
  }

  const before = await codeBox(page).inputValue();
  await tab(page, "Table → Mermaid").click();
  await panel(page).getByRole("button", { name: "Open in Diagram" }).click();
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await tab(page, "Diagram").click();
  await expect(codeBox(page)).toHaveValue(before);
});

test("table errors name the line and the column, and replacements are listed", async ({ page }) => {
  await openMermaid(page, "?lang=en", "#table");
  const input = panel(page).getByRole("textbox", { name: "Table (CSV or Markdown)" });
  await input.fill("source,target\nA,B\nC,");
  await panel(page).getByRole("button", { name: "Generate code" }).click();
  await expect(alert(page)).toHaveText("The column “target” cannot be empty. (line 3)");

  await panel(page).getByRole("combobox", { name: "Diagram type" }).selectOption("gantt");
  await panel(page).getByRole("textbox", { name: "Table (CSV or Markdown)" }).fill("task,start,duration\nFix: login,2026-01-01,1d");
  await panel(page).getByRole("button", { name: "Generate code" }).click();
  await expect(panel(page)).toContainText("line 2: “Fix: login” is written “Fix꞉ login”");
});

test("the main page links here, and back", async ({ page }) => {
  await page.goto("/?lang=en#jwt");
  await page.getByRole("link", { name: "Mermaid diagrams" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mermaid diagrams");
  await page.getByRole("link", { name: "Back to the other utilities" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Developer utilities");
});

test("in Spanish", async ({ page }) => {
  await openMermaid(page, "");
  await expect(page).toHaveTitle("Diagramas Mermaid");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await codeBox(page).count();
  await panel(page).getByRole("button", { name: "Cargar ejemplo" }).click();
  await expect(panel(page).getByRole("group", { name: "Vista del diagrama" }).getByRole("img")).toHaveAttribute("alt", /Pedido/);
});
