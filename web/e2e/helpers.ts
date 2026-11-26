import type { Page } from "@playwright/test";

export const tab = (page: Page, name: string) => page.getByRole("tab", { name });
export const panel = (page: Page) => page.getByRole("tabpanel");
export const output = (page: Page) => panel(page).getByRole("textbox", { name: "Result" });

export async function open(page: Page, query = "?lang=en", hash = ""): Promise<void> {
  await page.goto(`/${query}${hash}`);
  await page.getByRole("tablist").waitFor();
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
