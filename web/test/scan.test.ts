import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { review, scan } from "../scripts/network-scan.js";

const src = path.join(import.meta.dirname, "..", "src");

describe("sources", () => {
  const files = (fs.readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.(tsx?|css)$/.test(f));

  /**
   * The one allowed use: RegexTool starts the inline worker (`?worker&inline`). It is the `new Worker` of the
   * reviewed list in scripts/network-scan.ts, seen in the source.
   */
  const allowed: Record<string, string[]> = { "ui/RegexTool.tsx": ["new Worker"] };

  it.each(files)("%s has no network or eval code", (file) => {
    const found = scan(fs.readFileSync(path.join(src, file), "utf-8")).map((f) => f.match);
    expect(found).toEqual(allowed[file.replaceAll("\\", "/")] ?? []);
  });
});

describe("the scanner", () => {
  it.each([
    ["fetch", 'fetch("/x")'],
    ["fetch", "window.fetch(u)"],
    ["xml-http-request", "new XMLHttpRequest"],
    ["web-socket", "new WebSocket(u)"],
    ["event-source", "new EventSource(u)"],
    ["beacon", "navigator.sendBeacon(u)"],
    ["web-rtc", "new RTCPeerConnection()"],
    ["worker", 'new Worker("w.js")'],
    ["worker", "importScripts(u)"],
    ["dynamic-import", "import(u)"],
    ["external-url", 'x="https://example.com/a"'],
    ["protocol-relative-url", 'x="//cdn.example.com/a"'],
    ["css-import", '@import "x"'],
    ["navigation", "location.href = u"],
    ["navigation", "window.open(u)"],
    ["element-loading", "new Image().src=u"],
    ["element-loading", 'document.createElement("script")'],
    ["eval", "new Function(code)"],
    ["eval", "eval (code)"],
  ])("finds %s in %s", (rule, code) => {
    expect(scan(code).map((f) => f.rule)).toContain(rule);
  });

  it("does not report comparisons of the location", () => {
    expect(scan("if (location.hash === x) {}")).toEqual([]);
  });

  it("reports what is not allowed, and entries that are no longer used as listed", () => {
    const entry = { rule: "external-url", match: "http://a.example", count: 1, library: "x", what: "w", unreachable: "u", test: "t" };
    expect(review(scan('"http://a.example" "http://b.example"'), [entry]).unexpected.map((f) => f.match)).toEqual(["http://b.example"]);
    expect(review([], [entry]).stale).toEqual([{ entry, found: 0 }]);
    expect(review(scan('"http://a.example" "http://a.example"'), [entry]).stale).toEqual([{ entry, found: 2 }]);
  });
});
