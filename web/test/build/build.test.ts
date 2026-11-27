import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { CSP, MERMAID_CSP } from "../../csp.js";
import { ALLOWED, MERMAID_ALLOWED, MERMAID_CODE, review, scan } from "../../scripts/network-scan.js";

// Runs after `npm run build`.
const web = path.join(import.meta.dirname, "..", "..");
const dist = path.join(web, "dist");
const files = () => (fs.readdirSync(dist, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(dist, f)).isFile());
const read = (f: string) => fs.readFileSync(path.join(dist, f), "utf-8");

/** gzip bytes of everything the browser downloads for each page. */
const PAGES = [
  { page: "index.html", assets: /^assets\/(index|style)-/, budget: 150 * 1024, policy: CSP, allowed: ALLOWED },
  { page: "mermaid.html", assets: /^assets\/mermaid-/, budget: 1000 * 1024, policy: MERMAID_CSP, allowed: MERMAID_ALLOWED },
];

/** The files a page names in its HTML. */
const filesOf = (page: string) => [page, ...[...read(page).matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)].map((m) => m[1]!)];

describe("the built site", () => {
  it("exists", () => {
    for (const { page } of PAGES) expect(fs.existsSync(path.join(dist, page)), 'run "npm run build" first').toBe(true);
  });

  it("has only the two pages and the files they name", () => {
    const named = PAGES.flatMap(({ page }) => filesOf(page));
    expect(files().map((f) => f.replaceAll("\\", "/")).sort()).toEqual(named.sort());
  });

  describe.each(PAGES)("$page", ({ page, assets, budget, policy, allowed }) => {
    it("has one script and one style sheet of its own", () => {
      const own = filesOf(page).slice(1);
      expect(own.map((f) => path.extname(f)).sort()).toEqual([".css", ".js"]);
      for (const file of own) expect(file).toMatch(assets);
    });

    it("declares its policy before any script or style", () => {
      const html = read(page);
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
      expect(html).toContain(meta);
      expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
      expect(html.indexOf(meta)).toBeLessThan(html.indexOf("<script"));
      expect(html.indexOf(meta)).toBeLessThan(html.indexOf("<link"));
      expect(html).toContain("connect-src 'none'");
      expect(html).toContain("script-src 'self';");
      expect(html).not.toContain("unsafe-eval");
    });

    it("loads only its own relative files", () => {
      const urls = [...read(page).matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
      expect(urls.filter((u) => !u.startsWith("./") && u !== "data:,")).toEqual([]);
      for (const css of filesOf(page).filter((f) => f.endsWith(".css"))) expect(read(css)).not.toMatch(/url\(|@import|@font-face/);
    });

    it("has no network or eval code outside its reviewed list", () => {
      const html = read(page).replace(/<!--[\s\S]*?-->/g, "");
      const findings = filesOf(page).flatMap((f) => scan(f.endsWith(".html") ? html : read(f)));
      const result = review(findings, allowed);
      expect(result.unexpected.map((f) => `${f.rule}: ${f.match} …${f.context}…`)).toEqual([]);
      expect(result.stale.map((s) => `${s.entry.match}: expected ${s.entry.count}, found ${s.found}`)).toEqual([]);
    });

    it("fits its size budget", () => {
      const sizes = filesOf(page).map((f) => ({ file: f, gzip: zlib.gzipSync(fs.readFileSync(path.join(dist, f)), { level: 9 }).length }));
      const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
      console.log(sizes.map((s) => `${s.file}: ${s.gzip} bytes`).join("\n"), `\n${page} total gzip: ${total} bytes (${(total / 1024).toFixed(1)} KB)`);
      expect(total).toBeLessThanOrEqual(budget);
    });
  });

  const script = (page: string) => read(filesOf(page).find((f) => f.endsWith(".js"))!);
  const library = (file: string) => fs.readFileSync(path.join(web, "node_modules", file), "utf-8");

  it("keeps Mermaid out of the first page", () => {
    expect(script("mermaid.html")).toContain("securityLevel");
    expect(script("index.html")).not.toMatch(/securityLevel|flowchart-v2|dompurify/i);
  });

  it.each([
    ["elkjs", "elkjs/lib/elk.bundled.js", "org.eclipse.elk"],
    ["katex", "katex/dist/katex.mjs", "KaTeX parse error"],
  ])("does not include %s", (_, file, marker) => {
    // the marker is in the library, so its absence means something
    expect(library(file)).toContain(marker);
    expect(script("mermaid.html")).not.toContain(marker);
  });
});

describe("the reviewed lists", () => {
  const specs = ["privacy.spec.ts", "mermaid-privacy.spec.ts", "mermaid-types.spec.ts"].map((f) => fs.readFileSync(path.join(web, "e2e", f), "utf-8")).join("\n");
  const source = fs.readFileSync(path.join(web, "scripts", "network-scan.ts"), "utf-8");
  const written = [...ALLOWED, ...MERMAID_CODE];

  it.each([...ALLOWED, ...MERMAID_ALLOWED])("$match ($library) names an existing test", (entry) => {
    expect(specs).toContain(`test("${entry.test}"`);
    for (const text of [entry.what, entry.unreachable, entry.library]) expect(text.length).toBeGreaterThan(3);
  });

  it("has a comment above every entry that is written one by one", () => {
    const comments = [...source.matchAll(/\/\/ TEST: "([^"]+)"\.\n {2}\{/g)].map((m) => m[1]);
    expect(comments).toEqual(written.map((a) => a.test));
    expect(source.match(/\/\/ WHAT: /g)).toHaveLength(written.length);
    expect(source.match(/\/\/ LIBRARY: /g)).toHaveLength(written.length);
  });

  it("fails when a count changes in either direction", () => {
    for (const entry of MERMAID_ALLOWED) {
      const finding = (n: number) => Array.from({ length: n }, () => ({ rule: entry.rule, match: entry.match, context: "" }));
      const anywhere = { ...entry };
      delete anywhere.context;
      expect(review(finding(entry.count), [anywhere]).stale).toEqual([]);
      expect(review(finding(entry.count + 1), [anywhere]).stale).toHaveLength(1);
      expect(review(finding(entry.count - 1), [anywhere]).stale).toHaveLength(1);
    }
  });
});
