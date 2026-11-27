import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CSP, MERMAID_CSP } from "../csp.js";

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "vercel.json"), "utf-8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** The headers a path gets. These sources are plain regular expressions over the whole path. */
const headers = (file: string) => config.headers.filter((rule) => new RegExp(`^${rule.source}$`).test(file)).flatMap((rule) => rule.headers);
const policies = (file: string) =>
  headers(file)
    .filter((h) => h.key === "Content-Security-Policy")
    .map((h) => h.value);

describe("vercel.json", () => {
  // two policies on one response would both apply, and the strict one would stop the diagrams
  it.each(["/", "/index.html", "/assets/index-abc.js", "/other.html", "/mermaid.html.bak"])("%s gets only the strict policy, plus what only a header can say", (file) => {
    expect(policies(file)).toEqual([`${CSP}; frame-ancestors 'none'`]);
  });

  it("/mermaid.html gets only its own policy", () => {
    expect(policies("/mermaid.html")).toEqual([`${MERMAID_CSP}; frame-ancestors 'none'`]);
  });

  it.each(["/", "/mermaid.html"])("%s gets the other security headers", (file) => {
    expect(headers(file).map((h) => h.key)).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]));
  });
});

describe("the Mermaid policy", () => {
  it("differs only in inline styles and workers", () => {
    const a = CSP.split("; ");
    const b = MERMAID_CSP.split("; ");
    expect(b.filter((d) => !a.includes(d))).toEqual(["style-src 'self' 'unsafe-inline'", "worker-src 'none'"]);
    expect(MERMAID_CSP.match(/unsafe-[a-z]+/g)).toEqual(["unsafe-inline"]);
  });
});
