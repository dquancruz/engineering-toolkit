import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// web/ is a separate package: it must not reach the CLI's tarball or its dependencies.
const root = path.join(import.meta.dirname, "..");
const json = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf-8")) as Record<string, any>;

describe("web/ stays out of the engkit package", () => {
  it("is not in the npm tarball", { timeout: 120_000 }, () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    const files = (Object.values(JSON.parse(out) as object)[0] as { files: { path: string }[] }).files.map((f) => f.path);
    expect(files).toContain("package.json");
    expect(files.filter((f) => f === "web" || f.startsWith("web/"))).toEqual([]);
  });

  it("is not a workspace and shares no dependency declaration", () => {
    const cli = json("package.json");
    expect(cli["workspaces"]).toBeUndefined();
    expect(cli["files"]).not.toContain("web");
    expect(Object.keys(cli["dependencies"])).not.toContain("preact");
  });

  it("is private and carries the same version", () => {
    expect(json("web/package.json")).toMatchObject({ private: true, version: json("package.json")["version"] });
  });
});
