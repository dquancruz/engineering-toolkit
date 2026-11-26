import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { open, panel, tab, token } from "./helpers.js";

const check = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
};

/** Puts every tool in the states with the most elements: results, warnings, errors and tables. */
const fill: Record<string, (page: Page) => Promise<void>> = {
  JSON: async (page) => {
    await panel(page).getByRole("textbox", { name: "Input" }).fill('{"a":1,"a":2}');
    await panel(page).getByRole("button", { name: "TypeScript types" }).click();
  },
  Converter: async (page) => {
    await panel(page).getByRole("combobox", { name: "Output format" }).selectOption("csv");
    await panel(page).getByRole("textbox", { name: "Input" }).fill('[{"a":{"b":null}}]');
    await panel(page).getByRole("button", { name: "Convert", exact: true }).click();
  },
  Regex: async (page) => {
    await panel(page).getByRole("textbox", { name: /^Pattern/ }).fill("(a)|b*");
    await panel(page).getByRole("textbox", { name: "Text" }).fill("abbc a");
    await panel(page).getByRole("table").waitFor();
  },
  JWT: async (page) => {
    await panel(page).getByRole("textbox", { name: "Token" }).fill(token({ exp: 1000, nbf: "x" }));
    await panel(page).getByRole("table").waitFor();
  },
};

for (const theme of ["light", "dark"]) {
  for (const [name, prepare] of Object.entries(fill)) {
    test(`axe: ${name}, ${theme} theme`, async ({ page }) => {
      await open(page);
      await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
      await tab(page, name).click();
      await check(page);
      await prepare(page);
      await check(page);
    });
  }
}

test("axe: errors, and the system's dark preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await panel(page).getByRole("textbox", { name: "Input" }).fill("{");
  await panel(page).getByRole("button", { name: "Validate" }).click();
  await check(page);
});

test("tabs work with the keyboard", async ({ page }) => {
  await open(page);
  const selected = page.getByRole("tab", { selected: true });
  await tab(page, "JSON").focus();
  for (const [key, name] of [
    ["ArrowRight", "Converter"],
    ["End", "JWT"],
    ["ArrowRight", "JSON"],
    ["ArrowLeft", "JWT"],
    ["Home", "JSON"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(selected).toHaveText(name);
    await expect(selected).toBeFocused();
  }
  expect(await page.getByRole("tab").evaluateAll((tabs) => tabs.map((t) => (t as HTMLElement).tabIndex))).toEqual([0, -1, -1, -1]);
});

test("a whole task can be done with the keyboard", async ({ page, browserName }) => {
  await open(page);
  // WebKit only moves to buttons with Alt+Tab, like Safari's default setting
  const next = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tab(page, "JSON").focus();
  await page.keyboard.press(next);
  const input = panel(page).getByRole("textbox", { name: "Input" });
  await expect(input).toBeFocused();
  await page.keyboard.type("[1]");
  await page.keyboard.press(next); // leaves the text area: Tab is not trapped
  await expect(panel(page).getByRole("button", { name: "Prettify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("textbox", { name: "Result" })).toHaveValue("[\n  1\n]");
});

test("focus is visible", async ({ page }) => {
  await open(page);
  await tab(page, "JSON").focus();
  await page.keyboard.press("ArrowRight");
  expect(await page.getByRole("tab", { selected: true }).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
});
