import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { CSP } from "../../csp.js";
import { ALLOWED, review, scan } from "../../scripts/network-scan.js";

// Runs after `npm run build`.
const web = path.join(import.meta.dirname, "..", "..");
const dist = path.join(web, "dist");
const files = () => (fs.readdirSync(dist, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(dist, f)).isFile());
const read = (f: string) => fs.readFileSync(path.join(dist, f), "utf-8");

/** gzip bytes of everything the browser downloads. */
const BUDGET = 150 * 1024;

describe("the built site", () => {
  it("exists", () => {
    expect(fs.existsSync(path.join(dist, "index.html")), 'run "npm run build" first').toBe(true);
  });

  it("has only an HTML file, one script and one style sheet", () => {
    expect(files().map((f) => path.extname(f)).sort()).toEqual([".css", ".html", ".js"]);
  });

  it("declares the policy before any script or style", () => {
    const html = read("index.html");
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
    expect(html).toContain(meta);
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf("<script"));
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf("<link"));
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it("loads only its own relative files", () => {
    const urls = [...read("index.html").matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
    expect(urls.filter((u) => !u.startsWith("./") && u !== "data:,")).toEqual([]);
    for (const css of files().filter((f) => f.endsWith(".css"))) expect(read(css)).not.toMatch(/url\(|@import/);
  });

  it("has no network or eval code outside the reviewed list", () => {
    const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
    const findings = files().flatMap((f) => scan(f.endsWith(".html") ? html : read(f)));
    const result = review(findings);
    expect(result.unexpected.map((f) => `${f.rule}: …${f.context}…`)).toEqual([]);
    expect(result.stale.map((s) => `${s.entry.match}: expected ${s.entry.count}, found ${s.found}`)).toEqual([]);
  });

  it("fits the size budget", () => {
    const sizes = files().map((f) => ({ file: f, gzip: zlib.gzipSync(fs.readFileSync(path.join(dist, f)), { level: 9 }).length }));
    const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
    console.log(sizes.map((s) => `${s.file}: ${(s.gzip / 1024).toFixed(1)} KB`).join("\n"), `\ntotal gzip: ${(total / 1024).toFixed(1)} KB`);
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});

describe("the reviewed list", () => {
  const spec = fs.readFileSync(path.join(web, "e2e", "privacy.spec.ts"), "utf-8");
  const source = fs.readFileSync(path.join(web, "scripts", "network-scan.ts"), "utf-8");

  it.each(ALLOWED)("$match ($library) names an existing test", (entry) => {
    expect(spec).toContain(`test("${entry.test}"`);
    for (const text of [entry.what, entry.unreachable, entry.library]) expect(text.length).toBeGreaterThan(3);
  });

  it("has a comment above every entry", () => {
    const comments = [...source.matchAll(/\/\/ TEST: "([^"]+)"\.\n {2}\{/g)].map((m) => m[1]);
    expect(comments).toEqual(ALLOWED.map((a) => a.test));
    expect(source.match(/\/\/ WHAT: /g)).toHaveLength(ALLOWED.length);
    expect(source.match(/\/\/ LIBRARY: /g)).toHaveLength(ALLOWED.length);
  });
});
