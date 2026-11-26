import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../src/agent/diff.js";
import { ASK_RULES, DENY_RULES, GUARD_FILE, SettingsError, isGuardGroup, mergeSettings } from "../../src/agent/merge.js";

const parse = (text: string) => JSON.parse(text) as Record<string, any>;

describe("mergeSettings", () => {
  it("creates settings from nothing", () => {
    const r = mergeSettings(null);
    expect(r.changed).toBe(true);
    const s = parse(r.text);
    expect(s.permissions.deny).toEqual(DENY_RULES);
    expect(s.permissions.ask).toEqual(ASK_RULES);
    const group = s.hooks.PreToolUse[0];
    expect(group.hooks[0]).toEqual({
      type: "command",
      command: "node",
      args: ["${CLAUDE_PROJECT_DIR}/" + GUARD_FILE],
      onFailure: "block",
      timeout: 10,
    });
    expect(group.matcher).toContain("Bash");
    expect(r.text.endsWith("\n")).toBe(true);
  });

  it("keeps everything that was there and appends the new rules", () => {
    const existing = JSON.stringify(
      {
        model: "opus",
        env: { A: "1" },
        permissions: { allow: ["Bash(npm test)"], deny: ["Read(./secrets/**)"], defaultMode: "acceptEdits" },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-hook.sh" }] }],
          PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "fmt.sh" }] }],
        },
      },
      null,
      2
    );
    const s = parse(mergeSettings(existing).text);
    expect(s.model).toBe("opus");
    expect(s.env).toEqual({ A: "1" });
    expect(s.permissions.allow).toEqual(["Bash(npm test)"]);
    expect(s.permissions.defaultMode).toBe("acceptEdits");
    expect(s.permissions.deny.slice(0, 1)).toEqual(["Read(./secrets/**)"]);
    expect(s.permissions.deny).toEqual(["Read(./secrets/**)", ...DENY_RULES]);
    expect(s.hooks.PostToolUse).toHaveLength(1);
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("my-hook.sh");
    expect(isGuardGroup(s.hooks.PreToolUse[1])).toBe(true);
  });

  it("appends the ask rules to the existing ones without duplicates", () => {
    const existing = JSON.stringify({ permissions: { ask: ["Bash(npm publish *)", "Bash(git stash drop *)"] } });
    const ask = parse(mergeSettings(existing).text).permissions.ask as string[];
    expect(ask.slice(0, 2)).toEqual(["Bash(npm publish *)", "Bash(git stash drop *)"]);
    expect([...ask].sort()).toEqual([...new Set([...ASK_RULES, "Bash(npm publish *)"])].sort());
  });

  it("is idempotent: a second merge changes nothing", () => {
    const first = mergeSettings(null).text;
    const second = mergeSettings(first);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first);
  });

  it("does not duplicate a deny rule that is already there", () => {
    const existing = JSON.stringify({ permissions: { deny: ["Bash(rm -rf *)"] } });
    const deny = parse(mergeSettings(existing).text).permissions.deny as string[];
    expect(deny.filter((r) => r === "Bash(rm -rf *)")).toHaveLength(1);
  });

  it("updates its own hook group in place instead of adding another", () => {
    const old = JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "node .claude/hooks/engkit-guard.mjs" }] },
          { matcher: "Edit", hooks: [{ type: "command", command: "other.sh" }] },
        ],
      },
    });
    const s = parse(mergeSettings(old).text);
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[0].hooks[0].onFailure).toBe("block");
    expect(s.hooks.PreToolUse[1].hooks[0].command).toBe("other.sh");
  });

  it("keeps tab and 4-space indentation and CRLF", () => {
    expect(mergeSettings('{\n\t"model": "x"\n}\n').text).toMatch(/^\{\n\t"model"/);
    expect(mergeSettings('{\n    "model": "x"\n}\n').text).toMatch(/^\{\n {4}"model"/);
    const crlf = mergeSettings('{\r\n  "model": "x"\r\n}\r\n').text;
    expect(crlf).toContain("\r\n");
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it.each([
    ["invalid JSON", '{ "a": 1, // comment\n}'],
    ["not an object", "[]"],
    ["permissions of the wrong type", '{"permissions": []}'],
    ["deny of the wrong type", '{"permissions": {"deny": "x"}}'],
    ["ask of the wrong type", '{"permissions": {"ask": {}}}'],
    ["hooks of the wrong type", '{"hooks": []}'],
    ["PreToolUse of the wrong type", '{"hooks": {"PreToolUse": {}}}'],
  ])("refuses to merge: %s", (_name, text) => {
    expect(() => mergeSettings(text)).toThrow(SettingsError);
  });

  it("warns about bypassPermissions", () => {
    const r = mergeSettings('{"permissions": {"defaultMode": "bypassPermissions"}}');
    expect(r.warnings.join(" ")).toContain("bypassPermissions");
  });

  it("treats an empty file as no settings", () => {
    expect(mergeSettings("  \n").changed).toBe(true);
  });
});

/**
 * Replica of the documented Bash rule matching (https://code.claude.com/docs/en/permissions): `*` matches
 * anything, and a trailing " *" that is the only wildcard also matches the bare command. It checks that the
 * patterns say what we mean; it does not test Claude Code's permission engine.
 */
function ruleMatches(rule: string, command: string): boolean {
  const pattern = /^Bash\((.*)\)$/.exec(rule)![1]!;
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const optionalTail = pattern.endsWith(" *") && pattern.indexOf("*") === pattern.length - 1;
  const source = optionalTail ? `${escape(pattern.slice(0, -2))}( .*)?` : pattern.split("*").map(escape).join(".*");
  return new RegExp(`^${source}$`).test(command);
}

describe("ASK_RULES", () => {
  const asks = (command: string) => ASK_RULES.some((r) => ruleMatches(r, command));

  it.each([
    "git clean -f", "git clean -fd", "git clean -xdf", "git clean -d", "git clean -x", "git clean -X",
    "git clean --force", "git clean -q -fd", "git reset --hard", "git reset --hard origin/main",
    "git reset -q --hard", "git checkout .", "git checkout -- .", "git checkout HEAD -- .",
    "git restore .", "git restore --worktree .", "git stash drop", "git stash drop stash@{1}", "git stash clear",
  ])("covers %s", (command) => expect(asks(command)).toBe(true));

  it.each([
    "git clean -n", "git reset --soft HEAD~1", "git reset", "git checkout main", "git checkout -- src/a.ts",
    "git checkout .env.example", "git restore src/a.ts", "git stash", "git stash list", "git stash pop",
  ])("leaves %s alone", (command) => expect(asks(command)).toBe(false));

  it("does not overlap with the deny rules", () => {
    expect(ASK_RULES.filter((r) => DENY_RULES.includes(r))).toEqual([]);
  });
});

describe("unifiedDiff", () => {
  it("is empty when nothing changed", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "f")).toBe("");
  });

  it("shows added and removed lines with context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
    const after = ["1", "2", "3", "4", "X", "6", "7", "8", "9"].join("\n");
    const d = unifiedDiff(before, after, "f.json");
    expect(d).toContain("--- f.json (current)");
    expect(d).toContain("-5");
    expect(d).toContain("+X");
    expect(d).toContain("@@ -2,7 +2,7 @@");
    expect(d).not.toContain(" 1\n");
  });

  it("shows a new file as only additions", () => {
    const d = unifiedDiff("", "a\nb\n", "f");
    expect(d).toContain("@@ -0,0 +1,2 @@");
    expect(d.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toEqual(["+a", "+b"]);
  });
});
