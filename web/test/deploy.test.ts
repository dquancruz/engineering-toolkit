import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CSP } from "../csp.js";

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "vercel.json"), "utf-8")) as {
  headers: { headers: { key: string; value: string }[] }[];
};

describe("vercel.json", () => {
  it("sends the same policy as the page, plus the part that only a header can say", () => {
    const header = config.headers[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(header).toBe(`${CSP}; frame-ancestors 'none'`);
  });
});
