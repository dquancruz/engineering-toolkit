import { expect, test } from "@playwright/test";
import { open, panel, tab, useEveryTool } from "./helpers.js";

const CANARY = "ZZcanary7f3a";

test("makes no request after loading, whatever is typed", async ({ page, context }) => {
  const requests: string[] = [];
  await open(page);
  await page.waitForLoadState("networkidle");
  // every request of the page and its workers from here on
  context.on("request", (r) => requests.push(r.url()));
  page.on("websocket", (s) => requests.push(s.url()));
  await context.route("**/*", (route) => route.abort());

  await useEveryTool(page, CANARY);
  await page.waitForTimeout(500);

  expect(requests.filter((url) => !url.startsWith("blob:") && !url.startsWith("data:"))).toEqual([]);
  expect(requests.join(" ")).not.toContain(CANARY);
});

test("loads only its own files", async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await open(page);
  await page.waitForLoadState("networkidle");
  expect(requests.filter((url) => !url.startsWith(baseURL!) && !url.startsWith("data:") && !url.startsWith("blob:"))).toEqual([]);
});

test("keeps nothing of what is typed", async ({ page, context }) => {
  await open(page);
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await useEveryTool(page, CANARY);

  const stored = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases: "databases" in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [],
    caches: "caches" in self ? await caches.keys() : [],
    url: location.href,
    title: document.title,
  }));
  expect(stored.local).toEqual({ "engkit-web.theme": "dark" });
  expect(stored.session).toEqual({});
  expect(stored.databases).toEqual([]);
  expect(stored.caches).toEqual([]);
  expect(JSON.stringify(stored)).not.toContain(CANARY);
  expect(await context.cookies()).toEqual([]);

  await page.reload();
  expect(await page.locator("textarea, input[type=text]").evaluateAll((fields) => fields.map((f) => (f as HTMLInputElement).value).join(""))).toBe("");
});

test("the policy blocks every way of connecting from the page", async ({ page }) => {
  const reached: string[] = [];
  await open(page);
  await page.context().route("https://blocked.invalid/**", (route) => {
    reached.push(route.request().url());
    return route.fulfill({ body: "reached", headers: { "access-control-allow-origin": "*" } });
  });

  const results = await page.evaluate(async () => {
    const url = "https://blocked.invalid/x";
    const outcome = (start: () => Promise<unknown>) =>
      Promise.race([
        start().then(
          () => "connected",
          () => "blocked"
        ),
        new Promise<string>((r) => setTimeout(() => r("blocked"), 1500)),
      ]);
    const opened = (target: EventTarget) =>
      new Promise((resolve, reject) => {
        target.addEventListener("load", resolve);
        target.addEventListener("open", resolve);
        target.addEventListener("error", reject);
      });
    return {
      fetch: await outcome(() => fetch(url)),
      sameOrigin: await outcome(() => fetch("./")),
      xhr: await outcome(() => {
        const x = new XMLHttpRequest();
        x.open("GET", url);
        const done = opened(x);
        x.send();
        return done;
      }),
      events: await outcome(() => opened(new EventSource(url))),
      socket: await outcome(async () => opened(new WebSocket("wss://blocked.invalid/x"))),
      image: await outcome(() => {
        const img = new Image();
        const done = opened(img);
        img.src = url;
        return done;
      }),
      script: await outcome(() => {
        const s = document.createElement("script");
        s.src = url;
        const done = opened(s);
        document.head.append(s);
        return done;
      }),
    };
  });

  expect(Object.entries(results).filter(([, r]) => r !== "blocked")).toEqual([]);
  expect(reached).toEqual([]);
});

test("runs the regex in a blob: worker that cannot connect", async ({ page }) => {
  await open(page, "?lang=en", "#regex");
  const started = page.waitForEvent("worker");
  await panel(page).getByRole("textbox", { name: /^Pattern/ }).fill("a");
  const worker = await started;
  expect(worker.url()).toMatch(/^blob:/);
  await expect(panel(page).getByRole("status")).toContainText("0 match");

  const result = await worker.evaluate(async () => {
    try {
      await fetch("https://blocked.invalid/from-worker");
      return "connected";
    } catch {
      return "blocked";
    }
  });
  expect(result).toBe("blocked");
  const sameOrigin = await worker.evaluate(async (url) => {
    try {
      await fetch(url);
      return "connected";
    } catch {
      return "blocked";
    }
  }, page.url());
  expect(sameOrigin).toBe("blocked");
});

test("refuses a data: worker", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        try {
          const worker = new Worker("data:text/javascript,postMessage(1)");
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

test("renders no SVG or MathML and requests nothing", async ({ page }) => {
  await open(page);
  await useEveryTool(page, CANARY);
  await tab(page, "JSON").click();
  expect(await page.locator("svg, math").count()).toBe(0);
});

test("markup typed by the user stays text", async ({ page }) => {
  await open(page, "?lang=en", "#regex");
  const markup = '<img src="x" onerror="window.pwned=1">';
  await panel(page).getByRole("textbox", { name: /^Pattern/ }).fill("<img[^>]*>");
  await panel(page).getByRole("textbox", { name: "Text" }).fill(markup);
  await expect(panel(page).locator("mark")).toContainText(markup);
  expect(await page.locator("#app img").count()).toBe(0);
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
});

test("text fields have spell checking off", async ({ page }) => {
  await open(page);
  await useEveryTool(page, CANARY);
  const enabled = await page.locator("textarea, input[type=text]").evaluateAll((fields) => fields.filter((f) => f.getAttribute("spellcheck") !== "false").length);
  expect(enabled).toBe(0);
});
