import { expect, test } from "@playwright/test";
import { open, output, panel, tab, token } from "./helpers.js";

test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => {
    throw e;
  });
});

test("JSON: prettify, types, Zod and an error with its position", async ({ page }) => {
  await open(page);
  const input = panel(page).getByRole("textbox", { name: "Input" });
  await input.fill('{"id":12345678901234567890,"tags":["a"]}');
  await panel(page).getByRole("button", { name: "Prettify" }).click();
  await expect(output(page)).toHaveValue('{\n  "id": 12345678901234567890,\n  "tags": [\n    "a"\n  ]\n}');
  await panel(page).getByRole("button", { name: "TypeScript types" }).click();
  await expect(output(page)).toHaveValue(/export interface Root/);
  await panel(page).getByRole("button", { name: "Zod schema" }).click();
  await expect(output(page)).toHaveValue(/z\.object/);
  await input.fill('{\n "a": }');
  await panel(page).getByRole("button", { name: "Validate" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("(line 2, column 7)");
});

test("Converter: converts and lists what cannot be kept", async ({ page }) => {
  await open(page, "?lang=en", "#convert");
  await panel(page).getByRole("combobox", { name: "Output format" }).selectOption("csv");
  await panel(page).getByRole("textbox", { name: "Input" }).fill('[{"a":{"b":null}}]');
  await panel(page).getByRole("button", { name: "Convert", exact: true }).click();
  await expect(output(page)).toHaveValue("a.b\n\n");
  await expect(panel(page)).toContainText("flattened into parent.child columns");
  await expect(panel(page)).toContainText("null becomes an empty cell");
});

test("Regex: highlights matches and groups", async ({ page }) => {
  await open(page, "?lang=en", "#regex");
  await panel(page).getByRole("textbox", { name: /^Pattern/ }).fill("(?<year>\\d{4})-(\\d\\d)");
  await panel(page).getByRole("textbox", { name: "Text" }).fill("from 2026-03 to 2027-04");
  await expect(panel(page).getByRole("status")).toHaveText("2 match(es)");
  await expect(panel(page).locator("mark")).toHaveCount(2);
  await expect(panel(page).getByRole("table")).toContainText("1 (year): 2026");
});

for (const [lang, expected] of [
  ["en", /catastrophic backtracking.*nested or overlapping quantifiers/s],
  ["es", /backtracking catastrófico.*cuantificadores anidados/s],
] as const) {
  test(`Regex: explains catastrophic backtracking (${lang})`, async ({ page, browserName }) => {
    await open(page, `?lang=${lang}`, "#regex");
    await panel(page).getByRole("textbox", { name: /^(Pattern|Patrón)/ }).fill("^(a+)+$");
    // long enough that no engine can try every combination
    await panel(page).getByRole("textbox", { name: /^(Text|Texto)$/ }).fill(`${"a".repeat(60)}!`);
    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText(expected, { timeout: 15_000 });
    // Chromium and Firefox keep going until the worker is stopped; WebKit gives up first and answers "no match"
    if (browserName === "webkit") await expect(alert).toContainText(/may be missing|pueden faltar/);
    else await expect(alert).toContainText(/was stopped|Se detuvo/);
    // the page keeps working
    await panel(page).getByRole("textbox", { name: /^(Pattern|Patrón)/ }).fill("!");
    await expect(panel(page).getByRole("status")).toContainText("1 ");
    await expect(alert).toBeEmpty();
  });
}

test("Regex: no slowness warning for an ordinary pattern", async ({ page }) => {
  await open(page, "?lang=en", "#regex");
  await panel(page).getByRole("textbox", { name: /^Pattern/ }).fill("\\d+");
  await panel(page).getByRole("textbox", { name: "Text" }).fill("a1 b22 c333 ".repeat(200));
  await expect(panel(page).getByRole("status")).toHaveText("600 match(es)");
  await expect(panel(page).getByRole("alert")).toBeEmpty();
});

test("JWT: decodes and says the signature is not verified", async ({ page }) => {
  await open(page, "?lang=en", "#jwt");
  await expect(panel(page)).toContainText("Signature not verified");
  await panel(page).getByRole("textbox", { name: "Token" }).fill(token({ sub: "123", exp: 1000 }));
  await expect(panel(page).getByRole("textbox", { name: "Payload" })).toHaveValue(/"sub": "123"/);
  await expect(panel(page).getByRole("status")).toHaveText("The token has expired.");
  await expect(panel(page).getByRole("table")).toContainText("1970-01-01T00:16:40.000Z");
});

test("language: Spanish by default, switchable and remembered", async ({ page }) => {
  await open(page, "");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Utilidades de desarrollo");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Developer utilities");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/?lang=es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});

test("switching tools keeps what was typed and the URL only names the tool", async ({ page }) => {
  await open(page);
  await panel(page).getByRole("textbox", { name: "Input" }).fill("[1]");
  await tab(page, "JWT").click();
  await expect(page).toHaveURL(/\?lang=en#jwt$/);
  await tab(page, "JSON").click();
  await expect(panel(page).getByRole("textbox", { name: "Input" })).toHaveValue("[1]");
});
