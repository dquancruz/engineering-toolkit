/**
 * Every allowed diagram type with hostile markup in its labels: no navigation, no request, nothing run, and
 * none of it put into the page as HTML, not even for a moment.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ALLOWED_TYPES } from "../src/core/diagram/types.js";
import { draw, openMermaid, panel } from "./helpers.js";
import { PAYLOADS, TEMPLATES } from "./hostile.js";

const MARK = "ZZhostile";

/**
 * Records, from before the page's own code runs, every HTML element outside the app that holds the mark (in a
 * text or an attribute) or that could navigate or load something, including through innerHTML on an element
 * that is not attached.
 */
async function watchPage(page: Page) {
  await page.addInitScript((mark) => {
    const found: string[] = [];
    (window as unknown as { inserted: string[] }).inserted = found;
    const HTML = "http://www.w3.org/1999/xhtml";
    const ACTIVE = "meta,base,link,img,image,script,iframe,object,embed,form,video,audio,source";
    const inspect = (root: Element) => {
      for (const element of [root, ...root.querySelectorAll("*")]) {
        if (element.namespaceURI !== HTML || element.closest("#app, head > meta, head > script, head > link") || element === document.documentElement || element === document.head || element === document.body) continue;
        const own = [...element.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("");
        const marked = own.includes(mark) || [...element.attributes].some((a) => a.value.includes(mark));
        // a download link of the app is outside #app for a moment
        if (marked || (element.matches(ACTIVE) && !element.closest("#app"))) found.push(element.outerHTML.slice(0, 200));
      }
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element && record.target.closest("#app")) continue;
        if (record.target instanceof Element && record.target !== document.documentElement && record.target !== document.body) inspect(record.target);
        // also what has been removed by now
        for (const node of record.addedNodes) if (node instanceof Element) inspect(node);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
    const property = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...property,
      set(this: Element, value: string) {
        property.set!.call(this, value);
        if (this.ownerDocument === document && !(this instanceof HTMLTemplateElement)) for (const child of this.querySelectorAll("*")) inspect(child);
      },
    });
  }, MARK);
  return () => page.evaluate(() => (window as unknown as { inserted: string[] }).inserted);
}

/** Everything that leaves the page: requests, navigations and new windows. */
async function watchNetwork(page: Page, context: BrowserContext) {
  const events: string[] = [];
  await page.waitForLoadState("networkidle");
  await context.route("**/*", (route) => {
    if (/^(blob|data):/.test(route.request().url())) return route.continue();
    events.push(`request ${route.request().url()}`);
    return route.abort();
  });
  page.on("request", (r) => {
    if (!/^(blob|data):/.test(r.url())) events.push(`attempt ${r.url()}`);
  });
  page.on("websocket", (s) => events.push(`socket ${s.url()}`));
  page.on("framenavigated", (f) => events.push(`navigation ${f.url()}`));
  context.on("page", (p) => events.push(`window ${p.url()}`));
  return events;
}

const state = (page: Page) =>
  page.evaluate(() => ({ pwned: (window as { pwned?: number }).pwned, alive: (window as { alive?: boolean }).alive, base: document.baseURI }));

for (const type of ALLOWED_TYPES) {
  test(`hostile labels do nothing: ${type}`, async ({ page, context }) => {
    test.slow();
    const inserted = await watchPage(page);
    const violations: string[] = [];
    await page.exposeFunction("violated", (v: string) => violations.push(v));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { violated: (v: string) => void }).violated(`${e.effectiveDirective} ${e.blockedURI}`)));
    await openMermaid(page);
    const events = await watchNetwork(page, context);
    const url = page.url();
    const base = (await state(page)).base;
    await page.evaluate(() => ((window as { alive?: boolean }).alive = true));

    const drawn: string[] = [];
    const refused: string[] = [];
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      // as typed; without the `:` and `;` that some grammars take; and as entity codes, which some decode
      for (const [form, text] of [
        ["typed", payload],
        ["without separators", payload.replace("https:", "").replace("0;url=", "0 url=")],
        ["entities", payload.replaceAll("<", "#lt;").replaceAll(">", "#gt;")],
      ] as const) {
        await draw(page, TEMPLATES[type]!.replaceAll("X", () => text));
        ((await panel(page).getByRole("alert").textContent()) === "" ? drawn : refused).push(`${name} (${form})`);
      }
    }
    // a refresh or a late request would happen now
    await page.waitForTimeout(1000);

    console.log(`${type}: drew ${drawn.length}, refused ${refused.length}${refused.length ? `: ${refused.join(", ")}` : ""}`);
    expect(await inserted()).toEqual([]);
    expect(events).toEqual([]);
    // Mermaid's sanitizer parses labels into a document that is never shown, and some browsers report the
    // policy for a <base> there too: the base of the page is checked below
    expect(violations.filter((v) => !v.startsWith("base-uri "))).toEqual([]);
    expect(await state(page)).toEqual({ pwned: undefined, alive: true, base });
    expect(page.url()).toBe(url);
    expect(context.pages()).toHaveLength(1);
    // the labels reached the drawing code: every payload is drawn in at least one of its forms
    if (type !== "info") for (const name of Object.keys(PAYLOADS)) expect(drawn.some((d) => d.startsWith(name)), `${name} was never drawn`).toBe(true);
  });
}

// the checks above must be able to fail
test("the watch sees markup that reaches the page", async ({ page, context }) => {
  const inserted = await watchPage(page);
  await openMermaid(page);
  const events = await watchNetwork(page, context);
  await page.evaluate((mark) => {
    const box = document.createElement("div");
    document.body.append(box);
    const span = document.createElement("span");
    box.append(span);
    span.textContent = `text ${mark}`;
    span.remove();
    document.createElement("div").innerHTML = "<img>";
  }, MARK);
  await expect.poll(async () => (await inserted()).join()).toMatch(/<img>[\s\S]*<span>|<span>[\s\S]*<img>/);
  await page.evaluate((mark) => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "refresh";
    meta.content = `0;url=https://blocked.invalid/${mark}`;
    document.body.append(meta);
  }, MARK);
  await expect.poll(() => events.join()).toContain("blocked.invalid");
});

// a formula would make Mermaid put the text around it into the page as HTML
for (const [name, code] of [
  ["typed", `sequenceDiagram\n  A->>B: $$x$$ ${PAYLOADS["img with an event"]}`],
  ["written with escapes, in a participant", `sequenceDiagram\n  participant A@{ "alias": "\\u0024\\u0024x\\u0024\\u0024 ${PAYLOADS["img with an event"]}" }\n  A->>A: x`],
  ["in a class", `classDiagram\n  class A {\n    $$x$$ ${PAYLOADS["img with an event"]}\n  }`],
] as const) {
  test(`a formula ${name} puts nothing into the page`, async ({ page, context }) => {
    const inserted = await watchPage(page);
    await openMermaid(page);
    const events = await watchNetwork(page, context);
    await draw(page, code);
    await page.waitForTimeout(500);
    expect(await inserted()).toEqual([]);
    expect(events).toEqual([]);
    expect((await state(page)).pwned).toBeUndefined();
    await expect(panel(page).getByRole("alert")).toContainText("Formulas ($$…$$) are not accepted");
  });
}
