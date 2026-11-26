import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { bash, guardScript, repoOn, runGuard } from "./helpers.js";

const dirs: string[] = [];
const repo = (branch: string, patterns?: string[]) => {
  const d = repoOn(branch, patterns);
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const feature = repo("feature/x");
const onMain = repo("main");
const onMaster = repo("master");

describe("engkit-guard: Bash commands that must be blocked", () => {
  const blocked: [string, string][] = [
    ["rm -rf build", "rm -rf"],
    ["rm -fr build", "rm -fr"],
    ["rm -Rf build", "rm -Rf"],
    ["rm -r -f build", "split flags"],
    ["rm -rfv build", "cluster with extra flag"],
    ["rm --recursive --force build", "long flags"],
    ["rm -r --force build", "mixed flags"],
    ["/bin/rm -rf build", "absolute path"],
    ["sudo rm -rf /x", "sudo"],
    ["sudo -u root rm -rf /x", "sudo with option value"],
    ["env FOO=1 rm -rf x", "env wrapper"],
    ["FOO=1 rm -rf x", "assignment prefix"],
    ["timeout 5 rm -rf x", "timeout"],
    ["nohup rm -rf x", "nohup"],
    ["ls && rm -rf x", "after &&"],
    ["ls; rm -rf x", "after ;"],
    ["ls | xargs rm -rf", "xargs"],
    ["ls || rm -rf x", "after ||"],
    ["echo hi\nrm -rf x", "second line"],
    ["sh -c 'rm -rf x'", "sh -c"],
    ['bash -lc "rm -rf x"', "bash -lc"],
    ["echo $(rm -rf x)", "command substitution"],
    ['echo "$(rm -rf x)"', "substitution in double quotes"],
    ["echo `rm -rf x`", "backticks"],
    ["eval 'rm -rf x'", "eval"],
    ["git push --force", "git push --force"],
    ["git push -f origin x", "git push -f"],
    ["git push origin x --force", "force after refspec"],
    ["git push --force-with-lease origin x", "force-with-lease"],
    ["git push --force-with-lease=x:abc origin x", "force-with-lease with value"],
    ["git push origin +x", "+refspec"],
    ["git -C . push --force", "git -C"],
    ["git -c core.x=1 push -f", "git -c"],
    ["command git push -f", "command wrapper"],
    ["git push origin main", "push main"],
    ["git push origin master", "push master"],
    ["git push -u origin main", "push -u main"],
    ["git push origin HEAD:main", "HEAD:main"],
    ["git push origin x:refs/heads/main", "refs/heads/main"],
    ["git push origin :main", "delete main by refspec"],
    ["git push --delete origin main", "delete main"],
    ["git push --all", "push all"],
    ["git push --mirror", "mirror"],
  ];
  it.each(blocked)("%s (%s)", (command) => {
    const r = bash(command, feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("engkit-guard: blocked");
  });

  it("blocks commit and push without arguments on main and master", () => {
    for (const dir of [onMain, onMaster]) {
      expect(bash('git commit -m "x"', dir).status).toBe(2);
      expect(bash("git -C . commit -m x", dir).status).toBe(2);
      expect(bash("git push", dir).status).toBe(2);
      expect(bash("git push origin", dir).status).toBe(2);
      expect(bash("git push origin HEAD", dir).status).toBe(2);
    }
  });

  it("follows cd and git -C to the directory where the commit happens", () => {
    const parent = repo("feature/x");
    expect(bash(`cd ${onMain} && git commit -m x`, parent).status).toBe(2);
    expect(bash(`git -C ${onMain} commit -m x`, parent).status).toBe(2);
  });
});

describe("engkit-guard: Bash commands that must be allowed", () => {
  const allowed = [
    "rm old.txt",
    "rm -r build",
    "rm -f old.txt",
    "rm -v a b",
    "ls -la",
    "git status",
    "git push -u origin feature/x",
    "git push origin feature/x",
    "git push origin HEAD",
    "git push",
    "git commit -m 'work'",
    "git push --tags origin",
    'echo "never run rm -rf"',
    "echo 'git push --force'",
    'git commit -m "document .env handling"',
    "cat .env.example",
    "cp .env.example docs/sample.txt",
    "npm test 2>&1",
    "ls 2>/dev/null && echo done",
    "git log --oneline | head -5",
  ];
  it.each(allowed)("%s", (command) => {
    const r = bash(command, feature);
    expect(r).toEqual({ status: 0, stderr: "", stdout: "" });
  });
});

describe("engkit-guard: .env files", () => {
  const blocked: [string, Record<string, unknown>][] = [
    ["Read", { file_path: ".env" }],
    ["Read", { file_path: "./.env.local" }],
    ["Read", { file_path: "/home/u/app/.env.production" }],
    ["Read", { file_path: "C:\\work\\app\\.env" }],
    ["Read", { file_path: "config\\.env.staging" }],
    ["Read", { file_path: ".ENV" }],
    ["Write", { file_path: ".env", content: "A=1" }],
    ["Edit", { file_path: ".env.test", old_string: "a", new_string: "b" }],
    ["MultiEdit", { file_path: ".env", edits: [{ old_string: "a", new_string: "b" }] }],
    ["NotebookEdit", { notebook_path: ".env" }],
    ["Grep", { pattern: "KEY", path: ".env" }],
    ["Glob", { pattern: "**/.env*" }],
  ];
  it.each(blocked)("%s %j", (tool, input) => {
    expect(runGuard(tool, input, feature).status).toBe(2);
  });

  it.each([
    "cat .env",
    "cat ./.env.local",
    "source .env.production",
    "cat < .env",
    "echo X=1 > .env",
    "echo X=1 >> config/.env",
    "cp .env /tmp/x",
    "docker run --env-file=.env x",
    'cat ".env"',
    "bash -c 'cat .env'",
    "echo $(cat .env)",
    "head -1 /app/.env.production",
  ])("Bash: %s", (command) => {
    expect(bash(command, feature).status).toBe(2);
  });

  it.each([
    ["Read", { file_path: ".env.example" }],
    ["Read", { file_path: "docs/.env.example" }],
    ["Read", { file_path: "src/environment.ts" }],
    ["Edit", { file_path: "src/env.ts", old_string: "dotenv.config()", new_string: "loadConfig()" }],
    ["Write", { file_path: "README.md", content: "Copy .env.example to .env\nthen edit\n" }],
    ["Grep", { pattern: "dotenv", path: "src" }],
  ])("allows %s %j", (tool, input) => {
    expect(runGuard(tool, input, feature).status).toBe(0);
  });
});

describe("engkit-guard: protected branches from .engkit.json", () => {
  it("defaults to main and master without a config", () => {
    expect(bash("git push origin main", feature).status).toBe(2);
    expect(bash("git push origin develop", feature).status).toBe(0);
  });

  it("uses protectedBranches, including patterns like release/*", () => {
    const patterns = ["main", "release/*"];
    const onRelease = repo("release/1.2", patterns);
    const onDevelop = repo("develop", patterns);
    expect(bash("git commit -m x", onRelease).status).toBe(2);
    expect(bash("git push origin release/1.3", onDevelop).status).toBe(2);
    expect(bash("git push origin releases", onDevelop).status).toBe(0);
    expect(bash("git commit -m x", onDevelop).status).toBe(0);
  });

  it("a custom list replaces the defaults", () => {
    const dir = repo("master", ["main"]);
    expect(bash("git commit -m x", dir).status).toBe(0);
    expect(bash("git push origin main", dir).status).toBe(2);
  });

  it("falls back to the defaults when the config is invalid", () => {
    const dir = repoOn("main");
    dirs.push(dir);
    fs.writeFileSync(`${dir}/.engkit.json`, "{ nope");
    expect(bash("git commit -m x", dir).status).toBe(2);
  });

  it("does not block commits outside a git repository", () => {
    const dir = repoOn("main");
    dirs.push(dir);
    fs.rmSync(`${dir}/.git`, { recursive: true, force: true });
    expect(bash("git commit -m x", dir).status).toBe(0);
  });
});

describe("engkit-guard: failing closed", () => {
  it("blocks on input that is not JSON", () => {
    const r = runGuard("Bash", {}, feature, "not json");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("blocking to be safe");
  });

  it("blocks on empty input", () => {
    expect(runGuard("Bash", {}, feature, "").status).toBe(2);
  });

  it("ignores tools it does not know and Bash without a command", () => {
    expect(runGuard("WebFetch", { url: "https://example.com" }, feature).status).toBe(0);
    expect(runGuard("Bash", {}, feature).status).toBe(0);
  });

  it("has a version header", () => {
    expect(fs.readFileSync(guardScript, "utf-8").split(/\r?\n/)[0]).toMatch(/^\/\/ engkit-guard v\d+$/);
  });
});

describe("engkit-guard: commands that discard work ask for confirmation", () => {
  it("answers with the documented PreToolUse JSON and exit 0", () => {
    const r = bash("git reset --hard", feature);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: expect.stringContaining("git reset --hard"),
      },
    });
  });

  it.each(["git clean -e keep -f", "git -c core.x=1 clean -fdx", "timeout 5 git stash clear", 'echo "$(git restore .)"', "git checkout -f ."])(
    "asks: %s",
    (command) => {
      expect(JSON.parse(bash(command, feature).stdout).hookSpecificOutput.permissionDecision).toBe("ask");
    }
  );

  it.each(["git clean -e -f -n", "git clean -efoo", "git reset -- --hard", 'echo "git stash drop"'])("stays silent: %s", (command) => {
    const r = bash(command, feature);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("blocks, without asking, when the command also does something blocked", () => {
    const r = bash("git stash drop; git push --force", feature);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
  });
});
