import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { codeBox, diagram, draw, openMermaid, panel, tab } from "./helpers.js";

const check = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
};

for (const theme of ["light", "dark"]) {
  test(`axe: Diagram, ${theme} theme`, async ({ page }) => {
    await openMermaid(page);
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    await check(page);
    await draw(page, '---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A --> B\n  click A "https://blocked.invalid/"');
    await expect(diagram(page)).toBeVisible();
    await panel(page).locator("summary").click();
    await check(page);
    await draw(page, "flowchart LR\n  ][");
    await check(page);
  });

  test(`axe: Table, ${theme} theme`, async ({ page }) => {
    await openMermaid(page, "?lang=en", "#table");
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    await check(page);
    await tab(page, "Diagram").click();
    await codeBox(page).fill("pie");
    await tab(page, "Table → Mermaid").click();
    await panel(page).getByRole("combobox", { name: "Diagram type" }).selectOption("gantt");
    await panel(page).getByRole("textbox", { name: "Table (CSV or Markdown)" }).fill("task,start,duration\na: b,2026-01-01,1d");
    await panel(page).getByRole("button", { name: "Generate code" }).click();
    await panel(page).getByRole("button", { name: "Open in Diagram" }).click();
    await check(page);
    await panel(page).getByRole("textbox", { name: "Table (CSV or Markdown)" }).fill("x");
    await panel(page).getByRole("button", { name: "Generate code" }).click();
    await check(page);
  });
}

test("the page can be used with the keyboard", async ({ page, browserName }) => {
  // WebKit only moves to buttons with Alt+Tab, like Safari's default setting
  const next = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await openMermaid(page);
  await tab(page, "Diagram").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Table → Mermaid")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press(next);
  await expect(codeBox(page)).toBeFocused();
  await page.keyboard.type("pie\n");
  await page.keyboard.type('"a" : 1');
  await expect(diagram(page)).toBeVisible();

  // the diagram's scroll area can be reached, and Tab is not trapped on the way
  const view = panel(page).getByRole("group", { name: "Diagram view" });
  for (let i = 0; i < 10 && !(await view.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(next);
  await expect(view).toBeFocused();
  expect(await view.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
});

test("the question before replacing takes the focus", async ({ page }) => {
  await openMermaid(page);
  await codeBox(page).fill("pie");
  await tab(page, "Table → Mermaid").click();
  await panel(page).getByRole("button", { name: "Load example" }).click();
  await panel(page).getByRole("button", { name: "Generate code" }).click();
  await panel(page).getByRole("button", { name: "Open in Diagram" }).press("Enter");
  await expect(panel(page).getByRole("button", { name: "Replace", exact: true })).toBeFocused();
  await panel(page).getByRole("button", { name: "Cancel" }).press("Enter");
  await expect(panel(page).getByRole("button", { name: "Open in Diagram" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("button", { name: "Replace", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tab(page, "Diagram")).toBeFocused();
});
