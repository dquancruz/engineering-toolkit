import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installAgentProfile } from "../../src/agent/install.js";
import { runInitProfiles, parseProfiles } from "../../src/commands/init.js";
import { loadConfig } from "../../src/config.js";
import { tmpDir } from "../helpers.js";

// git may check files out with CRLF on Windows
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), "utf-8").replace(/\r\n/g, "\n");
const exists = (dir: string, f: string) => fs.existsSync(path.join(dir, f));
const install = async (dir: string, options: Parameters<typeof installAgentProfile>[1] = {}, lang: "es" | "en" = "en") => {
  const lines: string[] = [];
  const result = await installAgentProfile(lang, { cwd: dir, interactive: false, out: (l) => void lines.push(l), ...options });
  return { result, out: lines.join("\n") };
};

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("agent profile install", () => {
  it("with --yes creates both subagents, the guard, the settings and the config (en)", async () => {
    dir = tmpDir();
    const { result } = await install(dir, { yes: true });
    expect(result.code).toBe(0);
    expect(result.created).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/agents/builder.md",
      ".claude/hooks/engkit-guard.mjs",
      ".claude/settings.json",
    ]);
    expect(read(dir, ".claude/agents/reviewer.md")).toMatch(/^---\nname: reviewer\n[\s\S]*?\ntools: Read, Grep, Glob\n/);
    expect(read(dir, ".claude/agents/builder.md")).toContain("tools: Read, Grep, Glob, Edit, Write, Bash");
    expect(read(dir, ".claude/agents/builder.md")).toContain("](../../CLAUDE.md)");
    expect(read(dir, ".claude/agents/builder.md")).toContain("](../../docs/DECISIONS.md)");
    expect(loadConfig(dir).protectedBranches).toEqual(["main", "master"]);
    expect(JSON.parse(read(dir, ".claude/settings.json")).hooks.PreToolUse).toHaveLength(1);
  });

  it("writes the subagents in Spanish with the paths of .engkit.json", async () => {
    dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ lang: "es", paths: { claude: "docs/CLAUDE.md" } }));
    await install(dir, { yes: true }, "es");
    const text = read(dir, ".claude/agents/builder.md");
    expect(text).toContain("Implementas la tarea");
    expect(text).toContain("](../../docs/CLAUDE.md)");
  });

  it("--agent selects the subagents", async () => {
    dir = tmpDir();
    await install(dir, { yes: true, agent: "reviewer" });
    expect(exists(dir, ".claude/agents/reviewer.md")).toBe(true);
    expect(exists(dir, ".claude/agents/builder.md")).toBe(false);
  });

  it("never overwrites an existing subagent", async () => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".claude/agents"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude/agents/reviewer.md"), "mine");
    const { result } = await install(dir, { yes: true });
    expect(read(dir, ".claude/agents/reviewer.md")).toBe("mine");
    expect(result.skipped).toContain(".claude/agents/reviewer.md");
  });

  it("without a terminal and without --yes it shows the diff, does not write settings and exits 1", async () => {
    dir = tmpDir();
    const { result, out } = await install(dir);
    expect(result.code).toBe(1);
    expect(exists(dir, ".claude/settings.json")).toBe(false);
    expect(out).toContain("+++ .claude/settings.json (proposed)");
    expect(out).toContain("Run again with --yes");
  });

  it("--dry-run writes nothing at all", async () => {
    dir = tmpDir();
    const { result, out } = await install(dir, { dryRun: true, yes: true });
    expect(result.code).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(out).toContain("would create  .claude/agents/builder.md");
    expect(out).toContain("dry-run: .claude/settings.json not written");
  });

  it("asks for confirmation on a terminal: yes writes, no leaves the file untouched", async () => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".claude"));
    const original = '{\n  "model": "opus"\n}\n';
    fs.writeFileSync(path.join(dir, ".claude/settings.json"), original);

    const asked: string[] = [];
    const no = await install(dir, { interactive: true, confirm: async (m) => (asked.push(m), false) });
    expect(no.result.code).toBe(0);
    expect(read(dir, ".claude/settings.json")).toBe(original);
    expect(asked).toEqual(["Write these changes to .claude/settings.json?"]);
    expect(no.out).toContain('-  "model": "opus"');
    expect(no.out).toContain('+  "model": "opus",');
    expect(no.out).toContain('+  "permissions"');

    const yes = await install(dir, { interactive: true, confirm: async () => true });
    expect(yes.result.updated).toContain(".claude/settings.json");
    expect(JSON.parse(read(dir, ".claude/settings.json")).model).toBe("opus");
    expect(exists(dir, ".claude/settings.json.engkit-tmp")).toBe(false);
  });

  it("running it twice changes nothing the second time", async () => {
    dir = tmpDir();
    await install(dir, { yes: true });
    const before = read(dir, ".claude/settings.json");
    const { result, out } = await install(dir, { yes: true });
    expect(result.created).toEqual([]);
    expect(result.code).toBe(0);
    expect(read(dir, ".claude/settings.json")).toBe(before);
    expect(out).toContain("guards already present");
  });

  it("stops without touching anything when settings.json is invalid", async () => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(path.join(dir, ".claude/settings.json"), "{ // comment\n}");
    const { result, out } = await install(dir, { yes: true });
    expect(result.code).toBe(1);
    expect(out).toContain("is not valid JSON");
    expect(read(dir, ".claude/settings.json")).toBe("{ // comment\n}");
  });

  it("--update-guard shows a diff and replaces a changed script only when confirmed", async () => {
    dir = tmpDir();
    await install(dir, { yes: true });
    const file = path.join(dir, ".claude/hooks/engkit-guard.mjs");
    const shipped = fs.readFileSync(file, "utf-8");
    fs.writeFileSync(file, shipped.replace("engkit-guard v1", "engkit-guard v0"));

    const kept = await install(dir, { yes: true });
    expect(kept.out).toContain("use --update-guard");
    expect(fs.readFileSync(file, "utf-8")).toContain("v0");

    const declined = await install(dir, { updateGuard: true, interactive: true, confirm: async () => false });
    expect(declined.out).toContain("-// engkit-guard v0");
    expect(fs.readFileSync(file, "utf-8")).toContain("v0");

    const updated = await install(dir, { updateGuard: true, yes: true });
    expect(updated.result.updated).toEqual([".claude/hooks/engkit-guard.mjs"]);
    expect(fs.readFileSync(file, "utf-8")).toBe(shipped);
  });

  it("keeps an existing protectedBranches list", async () => {
    dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify({ protectedBranches: ["main", "release/*"] }));
    await install(dir, { yes: true });
    expect(loadConfig(dir).protectedBranches).toEqual(["main", "release/*"]);
  });
});

describe("engkit init profiles", () => {
  it("parses combinable profiles and rejects unknown ones", () => {
    expect(parseProfiles("base")).toEqual(["base"]);
    expect(parseProfiles("base, agent,agent")).toEqual(["base", "agent"]);
    expect(() => parseProfiles("base,legacy")).toThrow(/Invalid profile "legacy"/);
    expect(() => parseProfiles(" , ")).toThrow(/Empty/);
  });

  it("base,agent creates the documents and the agent files; agent alone leaves the documents alone", async () => {
    dir = tmpDir();
    const both = await runInitProfiles("en", { cwd: dir, profiles: ["base", "agent"], owner: "Jane Doe", yes: true, interactive: false });
    expect(both).toBe(0);
    expect(exists(dir, "CLAUDE.md")).toBe(true);
    expect(exists(dir, ".claude/agents/builder.md")).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
    dir = tmpDir();
    await runInitProfiles("en", { cwd: dir, profiles: ["agent"], yes: true, interactive: false });
    expect(exists(dir, "CLAUDE.md")).toBe(false);
    expect(exists(dir, ".claude/agents/builder.md")).toBe(true);
  });

  it("init --dry-run on the base profile writes nothing", async () => {
    dir = tmpDir();
    await runInitProfiles("en", { cwd: dir, profiles: ["base"], dryRun: true });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
