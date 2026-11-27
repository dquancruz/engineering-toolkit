/** The privacy tests of the Mermaid page, with diagrams that try to reach the network or to run something. */
import { expect, test, type Page } from "@playwright/test";
import { CSP, MERMAID_CSP } from "../csp.js";
import { codeBox, diagram, draw, openMermaid, panel, shownSvg, tab, watchPolicy } from "./helpers.js";

const CANARY = "ZZcanary7f3a";
const url = (name: string) => `https://blocked.invalid/${CANARY}/${name}`;

const HOSTILE = [
  `flowchart LR\n  A@{ img: "${url("shape")}", h: 60 }`,
  `flowchart LR\n  A["<img src='${url("label")}' onerror='window.pwned=1'>"]`,
  `flowchart LR\n  A["\`![x](${url("markdown")})\`"]`,
  `flowchart LR\n  A --> B\n  click A href "javascript:window.pwned=1"\n  click B "${url("link")}" _blank`,
  "flowchart LR\n  A --> B\n  click A call alert()\n  click B callback",
  `sequenceDiagram\n  participant A\n  link A: Home @ ${url("sequence")}\n  A->>A: x`,
  `classDiagram\n  class A\n  click A href "${url("class")}"`,
  `gantt\n  dateFormat YYYY-MM-DD\n  T :a, 2026-01-01, 1d\n  click a href "${url("gantt")}"`,
  `%%{init: {"themeCSS": "rect{fill:url(${url("themecss")})} @import url(${url("import")}); body{display:none}"}}%%\nflowchart LR\n  A`,
  `---\nconfig:\n  htmlLabels: true\n  securityLevel: loose\n  themeCSS: "body{display:none}"\n  fontFamily: "x; } body { display:none"\n  dompurifyConfig: { ADD_TAGS: ["script"] }\n---\nflowchart LR\n  A[<b>x</b><script>window.pwned=1</script>]`,
  `%%{init: {"securityLevel":"loose","htmlLabels":true,"flowchart":{"htmlLabels":true},"journey":{"textPlacement":"fo"}}}%%\njourney\n  section s\n    x: 5: Me`,
  `%%{init: {"themeVariables": {"fontFamily": "x; } body { display: none } @import url(${url("variables")}); {"}}}%%\nflowchart LR\n  A`,
  `flowchart LR\n  A\n  classDef x fill:#fff,background:url(${url("classdef")})\n  class A x`,
  `eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd AddItem { "<img src=${url("eventmodeling")} onerror=window.pwned=1>" }`,
  `architecture-beta\n  service a("${url("icon")}")[A]`,
  `C4Context\n  Person(a, "A", "<img src='${url("c4")}'>", $link="${url("c4link")}")`,
];

async function useBothTools(page: Page): Promise<void> {
  for (const code of HOSTILE) await draw(page, code);
  await draw(page, `flowchart LR\n  A[${CANARY}] --> B`);
  for (const name of ["Download SVG", "Download PNG"]) {
    const download = page.waitForEvent("download");
    await panel(page).getByRole("button", { name }).click();
    await download;
  }
  await tab(page, "Table → Mermaid").click();
  await panel(page).getByRole("textbox", { name: "Table (CSV or Markdown)" }).fill(`source,target\n${CANARY},"<img src=${url("table")}>"`);
  await panel(page).getByRole("button", { name: "Generate code" }).click();
  await panel(page).getByRole("button", { name: "Open in Diagram" }).click();
  await panel(page).getByRole("button", { name: "Replace", exact: true }).click();
  await expect(diagram(page)).toHaveAttribute("alt", new RegExp(CANARY));
}

test("makes no request after loading, whatever is typed", async ({ page, context }) => {
  test.slow();
  const requests: string[] = [];
  await openMermaid(page);
  await page.waitForLoadState("networkidle");
  // requests that reach the network layer: one that the policy blocks never does
  await context.route("**/*", (route) => {
    if (/^(blob|data):/.test(route.request().url())) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  page.on("websocket", (s) => requests.push(s.url()));

  await useBothTools(page);
  await page.waitForTimeout(500);

  expect(requests).toEqual([]);
  expect(page.url()).not.toContain(CANARY);
  expect(context.pages()).toHaveLength(1);
});

test("loads only its own files", async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await openMermaid(page);
  await page.waitForLoadState("networkidle");
  expect(requests.filter((u) => !u.startsWith(baseURL!) && !u.startsWith("data:"))).toEqual([]);
});

test("keeps nothing of what is typed", async ({ page, context }) => {
  test.slow();
  await openMermaid(page);
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await useBothTools(page);

  const stored = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases: "databases" in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [],
    caches: "caches" in self ? await caches.keys() : [],
    url: location.href,
    title: document.title,
    name: window.name,
  }));
  expect(stored.local).toEqual({ "engkit-web.theme": "dark" });
  expect(stored.session).toEqual({});
  expect(stored.databases).toEqual([]);
  expect(stored.caches).toEqual([]);
  expect(JSON.stringify(stored)).not.toContain(CANARY);
  expect(await context.cookies()).toEqual([]);

  await page.reload();
  await expect(codeBox(page)).toHaveValue("");
});

test("hostile diagrams run nothing, restyle nothing and leave no links in the file", async ({ page }) => {
  test.slow();
  await openMermaid(page);
  for (const code of HOSTILE) {
    await draw(page, code);
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned), code).toBeUndefined();
    expect(await page.evaluate(() => getComputedStyle(document.body).display), code).not.toBe("none");
    if ((await panel(page).getByRole("alert").textContent()) !== "") continue;
    const unsafe = await page.evaluate((svg) => {
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const found = [...parsed.querySelectorAll("parsererror, a, script, foreignObject, iframe, animate, set")].map((e) => e.localName);
      for (const element of parsed.querySelectorAll("*")) {
        for (const a of element.attributes) {
          if (a.localName.startsWith("on")) found.push(a.name);
          if (a.localName === "href" && !/^(#|data:image\/)/.test(a.value)) found.push(a.value);
          if (/url\(\s*["']?(?!#)/i.test(a.value)) found.push(a.value);
        }
        if (element.localName === "style" && /@import|url\(\s*["']?(?!#)/i.test(element.textContent ?? "")) found.push("style");
      }
      return found;
    }, await shownSvg(page));
    expect(unsafe, code).toEqual([]);
    // the diagram is a picture: it is not part of the page
    expect(await page.locator("#app svg").count()).toBe(0);
  }
});

test("a diagram cannot change the locked configuration", async ({ page }) => {
  await openMermaid(page);
  await draw(page, '%%{init: {"htmlLabels": true, "flowchart": {"htmlLabels": true}, "themeCSS": ".node rect { stroke-width: 91px }", "fontFamily": "Chosenfont"}}%%\nflowchart LR\n  A[x]');
  const svg = await shownSvg(page);
  expect(svg).not.toMatch(/91px|Chosenfont|foreignObject/);
});

test("the policy blocks every way of connecting from the page", async ({ page }) => {
  const reached: string[] = [];
  await openMermaid(page);
  await page.context().route("https://blocked.invalid/**", (route) => {
    reached.push(route.request().url());
    return route.fulfill({ body: "reached", headers: { "access-control-allow-origin": "*" } });
  });
  const results = await page.evaluate(async () => {
    const target = "https://blocked.invalid/x";
    const outcome = (start: () => Promise<unknown>) =>
      Promise.race([
        new Promise((resolve) => resolve(start())).then(
          () => "connected",
          () => "blocked"
        ),
        new Promise<string>((r) => setTimeout(() => r("blocked"), 1500)),
      ]);
    const opened = (node: EventTarget) =>
      new Promise((resolve, reject) => {
        node.addEventListener("load", resolve);
        node.addEventListener("open", resolve);
        node.addEventListener("error", reject);
      });
    const element = <K extends "img" | "script" | "link">(name: K, set: (e: HTMLElementTagNameMap[K]) => void) => {
      const e = document.createElement(name);
      const done = opened(e);
      set(e);
      document.head.append(e);
      return done;
    };
    return {
      fetch: await outcome(() => fetch(target)),
      sameOrigin: await outcome(() => fetch("./")),
      xhr: await outcome(() => {
        const x = new XMLHttpRequest();
        x.open("GET", target);
        const done = opened(x);
        x.send();
        return done;
      }),
      events: await outcome(() => opened(new EventSource(target))),
      socket: await outcome(async () => opened(new WebSocket("wss://blocked.invalid/x"))),
      image: await outcome(() => element("img", (e) => (e.src = target))),
      script: await outcome(() => element("script", (e) => (e.src = target))),
      // inline styles are allowed here; style sheets from elsewhere are not
      styles: await outcome(() => element("link", (e) => ((e.rel = "stylesheet"), (e.href = target)))),
      font: await outcome(() => new FontFace("x", `url(${target})`).load()),
    };
  });
  expect(Object.entries(results).filter(([, r]) => r !== "blocked")).toEqual([]);
  expect(reached).toEqual([]);
});

test("refuses workers", async ({ page }) => {
  await openMermaid(page);
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        try {
          const worker = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" })));
          worker.onmessage = () => resolve("ran");
          worker.onerror = () => resolve("refused");
          setTimeout(() => resolve("refused"), 1500);
        } catch {
          resolve("refused");
        }
      })
  );
  expect(result).toBe("refused");
});

test("only this page allows inline styles, and it still refuses inline scripts", async ({ page }) => {
  const attempt = () =>
    page.evaluate(async () => {
      const box = document.createElement("div");
      box.setAttribute("style", "width: 123px");
      document.body.append(box);
      const sheet = document.createElement("style");
      sheet.textContent = "body { outline-width: 7px; outline-style: solid }";
      document.head.append(sheet);
      const script = document.createElement("script");
      script.textContent = "window.pwned = 1";
      document.head.append(script);
      await new Promise((r) => setTimeout(r, 100));
      return { attribute: box.style.width === "123px", element: getComputedStyle(document.body).outlineWidth === "7px", script: (window as { pwned?: number }).pwned === 1 };
    });
  const violations = await watchPolicy(page);
  const policy = () => page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");

  await openMermaid(page);
  expect(await policy()).toBe(MERMAID_CSP);
  expect(await attempt()).toEqual({ attribute: true, element: true, script: false });

  await page.goto("/?lang=en");
  await page.getByRole("tablist").waitFor();
  expect(await policy()).toBe(CSP);
  expect(await attempt()).toEqual({ attribute: false, element: false, script: false });
  expect((await violations()).filter((v) => v.startsWith("style-src")).length).toBeGreaterThanOrEqual(2);
});

test("text fields have spell checking off", async ({ page }) => {
  await openMermaid(page);
  await tab(page, "Table → Mermaid").click();
  await panel(page).getByRole("combobox", { name: "Diagram type" }).selectOption("er");
  const enabled = await page.locator("textarea, input[type=text]").evaluateAll((fields) => fields.filter((f) => f.getAttribute("spellcheck") !== "false").length);
  expect(enabled).toBe(0);
});
