import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveLang } from "../src/config.js";
import { templatePath } from "../src/i18n/index.js";
import { tmpDir } from "./helpers.js";

describe("loadConfig", () => {
  it("returns an empty config when .engkit.json is missing", () => {
    expect(loadConfig(tmpDir())).toEqual({});
  });

  it("reads lang from .engkit.json", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ lang: "en" }));
    expect(loadConfig(dir)).toEqual({ lang: "en" });
  });

  it("rejects invalid JSON and invalid lang", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".engkit.json"), "{nope");
    expect(() => loadConfig(dir)).toThrow(/Invalid \.engkit\.json/);
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ lang: "fr" }));
    expect(() => loadConfig(dir)).toThrow(/"lang" must be/);
  });
});

describe("resolveLang", () => {
  it("defaults to es", () => expect(resolveLang(undefined, {})).toBe("es"));
  it("uses the config when there is no flag", () => expect(resolveLang(undefined, { lang: "en" })).toBe("en"));
  it("lets the flag win over the config", () => expect(resolveLang("es", { lang: "en" })).toBe("es"));
  it("rejects unknown languages", () => expect(() => resolveLang("fr", {})).toThrow(/Invalid --lang/));
});

describe("templatePath", () => {
  it("resolves templates/<lang>/<name> under the repo root", () => {
    expect(templatePath("en", "adr.md")).toBe(path.join(import.meta.dirname, "..", "templates", "en", "adr.md"));
  });
});
