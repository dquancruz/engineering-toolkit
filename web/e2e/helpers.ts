import { expect, type Page } from "@playwright/test";

export const tab = (page: Page, name: string) => page.getByRole("tab", { name });
export const panel = (page: Page) => page.getByRole("tabpanel");
export const output = (page: Page) => panel(page).getByRole("textbox", { name: "Result" });

export async function open(page: Page, query = "?lang=en", hash = ""): Promise<void> {
  await page.goto(`/${query}${hash}`);
  await page.getByRole("tablist").waitFor();
}

export async function openMermaid(page: Page, query = "?lang=en", hash = ""): Promise<void> {
  await page.goto(`/mermaid.html${query}${hash}`);
  await page.getByRole("tablist").waitFor();
}

export const codeBox = (page: Page) => panel(page).getByRole("textbox", { name: "Mermaid code" });
export const diagram = (page: Page) => panel(page).getByRole("group", { name: "Diagram view" }).getByRole("img");

/** Types the code and waits until its drawing, or its error, is shown. */
export async function draw(page: Page, code: string): Promise<void> {
  await codeBox(page).fill(code);
  await expect(panel(page).locator("[data-busy]")).toHaveAttribute("data-busy", "false", { timeout: 20_000 });
}

/** The SVG that is on screen. */
export async function shownSvg(page: Page): Promise<string> {
  const src = (await diagram(page).getAttribute("src"))!;
  return decodeURIComponent(src.slice(src.indexOf(",") + 1));
}

/** Records what the policy blocks, from before the page's own code runs. */
export async function watchPolicy(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { violations: string[] }).violations = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { violations: string[] }).violations);
}

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
export const token = (payload: unknown) => `${part({ alg: "HS256" })}.${part(payload)}.c2lnbmF0dXJl`;

/** Uses the four tools with `value` somewhere in each input. */
export async function useEveryTool(page: Page, value: string): Promise<void> {
  const here = panel(page);

  await tab(page, "JSON").click();
  await here.getByRole("textbox", { name: "Input" }).fill(`{"secret":"${value}"}`);
  for (const name of ["Prettify", "Minify", "Validate", "TypeScript types", "Zod schema"]) await here.getByRole("button", { name }).click();

  await tab(page, "Converter").click();
  for (const format of ["yaml", "toml", "csv", "xml", "json"]) {
    await here.getByRole("combobox", { name: "Output format" }).selectOption(format);
    await here.getByRole("textbox", { name: "Input" }).fill(`{"secret":"${value}"}`);
    await here.getByRole("button", { name: "Convert", exact: true }).click();
  }
  await here.getByRole("combobox", { name: "Input format" }).selectOption("xml");
  await here.getByRole("textbox", { name: "Input" }).fill(`<a href="https://example.com/${value}"><img src="https://example.com/${value}.png"/></a>`);
  await here.getByRole("button", { name: "Convert", exact: true }).click();

  await tab(page, "Regex").click();
  await here.getByRole("textbox", { name: /^Pattern/ }).fill(value);
  await here.getByRole("textbox", { name: "Text" }).fill(`<img src="https://example.com/${value}"> ${value}`);
  await here.getByRole("status").filter({ hasText: "match" }).waitFor();

  await tab(page, "JWT").click();
  await here.getByRole("textbox", { name: "Token" }).fill(token({ secret: value, iss: `https://example.com/${value}`, exp: 4102444800 }));
  await here.getByRole("textbox", { name: "Payload" }).waitFor();
}
