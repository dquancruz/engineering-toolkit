/** Every diagram type, drawn under the policy of the built page: no unsafe-eval. */
import { expect, test } from "@playwright/test";
import { diagram, draw, openMermaid, panel, shownSvg, watchPolicy } from "./helpers.js";
import { SAMPLES } from "./samples.js";

for (const [type, code] of Object.entries(SAMPLES)) {
  test(`draws ${type} under the real policy`, async ({ page }) => {
    const violations = await watchPolicy(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openMermaid(page);
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).not.toContain("unsafe-eval");

    await draw(page, code);

    await expect(panel(page).getByRole("alert")).toBeEmpty();
    await expect(diagram(page)).toBeVisible();
    // the browser can read the file as a picture, so it is well-formed
    expect(await diagram(page).evaluate(async (img: HTMLImageElement) => (await img.decode(), img.naturalWidth))).toBeGreaterThan(0);
    const svg = await shownSvg(page);
    expect(svg).not.toMatch(/<foreignObject|<script|<a[\s>]|@import/);
    // nothing had to be removed from it
    await expect(panel(page).locator(".warning li").filter({ hasText: /removed/ })).toHaveCount(0);
    // only event modeling writes its labels as HTML: they are turned into SVG text, and still there
    await expect(panel(page).locator(".warning li").filter({ hasText: "HTML labels" })).toHaveCount(type === "eventmodeling" ? 1 : 0);
    if (type === "eventmodeling") for (const label of ["CartUI", "AddItem", "ItemAdded"]) expect(svg).toContain(label);

    // and it can be turned into a PNG
    const download = page.waitForEvent("download");
    await panel(page).getByRole("button", { name: "Download PNG" }).click();
    expect((await download).suggestedFilename()).toBe("diagram.png");

    expect(await violations()).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the check above would see code that needs eval", async ({ page }) => {
  const violations = await watchPolicy(page);
  // the real page, with one line added to its script
  await page.route("**/assets/mermaid-*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n;try { Function("return 1")() } catch { document.documentElement.dataset.evalRefused = "yes" }` });
  });
  await openMermaid(page);
  await expect(page.locator("html")).toHaveAttribute("data-eval-refused", "yes");
  await expect.poll(violations).toContainEqual(expect.stringMatching(/^script-src.* eval$/));
});
