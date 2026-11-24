// engkit-guard v1
// PreToolUse hook for Claude Code, installed by `engkit init --profile agent`.
// Do not edit by hand: `engkit init --profile agent --update-guard` replaces it (showing a diff).
//
// Reads the hook JSON from stdin and exits with:
//   0  allowed
//   2  blocked (the reason goes to stderr, Claude Code shows it to the model)
// Any internal error also exits with 2 (fail closed).
//
// These are guards against accidents, not a security boundary. They do not cover scripts
// that delete or read files on their own (python -c, node -e), `find -delete`, `git clean`,
// aliases, shell variables or globs that expand to a secret file.
//
// Zero dependencies; runs on Node 22+ on Linux, macOS and Windows.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PROTECTED = ["main", "master"];

/** Thrown to block. */
class Block extends Error {}
const block = (reason) => {
  throw new Block(reason);
};

// ---------------------------------------------------------------- configuration

function loadProtected(projectDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(projectDir, ".engkit.json"), "utf-8"));
    const list = raw?.protectedBranches;
    if (Array.isArray(list) && list.length > 0 && list.every((b) => typeof b === "string" && b !== "")) return list;
  } catch {
    // missing or invalid .engkit.json: use the defaults (they are the strictest reasonable ones)
  }
  return DEFAULT_PROTECTED;
}

/** `release/*` style patterns; `*` matches any characters, including `/`. */
function matchesBranch(branch, patterns) {
  return patterns.some((p) => {
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(branch);
  });
}

// ---------------------------------------------------------------- secret files (.env*)

/** `.env*` except `.env.example`, judged on the last path segment (case-insensitive). */
function isSecretPath(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().replace(/^["']|["']$/g, "").replace(/[\\/]+$/, "");
  if (trimmed === "") return false;
  const base = trimmed.split(/[\\/]/).pop().toLowerCase();
  return base.startsWith(".env") && base !== ".env.example";
}

function checkSecretCandidate(word) {
  // `--env-file=.env`, `2>>.env`, `<.env`
  const stripped = word.replace(/^\d*[<>]+&?/, "");
  const afterEq = stripped.includes("=") ? stripped.slice(stripped.indexOf("=") + 1) : null;
  if (isSecretPath(stripped) || (afterEq !== null && isSecretPath(afterEq))) {
    block(`${JSON.stringify(word)} refers to an .env file (only .env.example may be read or written)`);
  }
}

/** All short strings of a tool input, depth-first. Multi-line strings (file contents) are skipped. */
function collectStrings(value, out = []) {
  if (typeof value === "string") {
    if (!value.includes("\n") && value.length <= 1024) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

// ---------------------------------------------------------------- shell parsing

/**
 * Splits a command line into segments of words (quotes removed). Separators: `&&`, `||`, `;`, `|`, `&`,
 * newlines, parentheses and backticks. `$(...)` and backticks inside double quotes are returned in `nested`.
 */
function parseShell(input) {
  const segments = [];
  const nested = [];
  let words = [];
  let word = "";
  let inWord = false;

  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };

  const n = input.length;
  for (let i = 0; i < n; i++) {
    const c = input[i];
    if (c === "'") {
      inWord = true;
      const end = input.indexOf("'", i + 1);
      const stop = end === -1 ? n : end;
      word += input.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      inWord = true;
      let j = i + 1;
      while (j < n && input[j] !== '"') {
        if (input[j] === "\\" && j + 1 < n) {
          word += input[j + 1];
          j += 2;
        } else if (input[j] === "$" && input[j + 1] === "(") {
          const close = matchParen(input, j + 1);
          nested.push(input.slice(j + 2, close));
          j = close + 1;
        } else if (input[j] === "`") {
          const close = input.indexOf("`", j + 1);
          const stop = close === -1 ? n : close;
          nested.push(input.slice(j + 1, stop));
          j = stop + 1;
        } else {
          word += input[j];
          j++;
        }
      }
      i = j;
    } else if (c === "\\") {
      // POSIX shells escape the next character. In Windows paths a backslash is a separator, so keep it
      // unless it is followed by whitespace or a quote.
      const next = input[i + 1];
      inWord = true;
      if (next !== undefined && /[\s"'\\$`]/.test(next)) {
        word += next;
        i++;
      } else {
        word += c;
      }
    } else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")" || c === "`") {
      // `>&2` and `2>&1` are redirections, not separators
      if (c === "&" && (input[i - 1] === ">" || input[i - 1] === "<" || input[i + 1] === ">")) {
        word += c;
        inWord = true;
      } else {
        endSegment();
      }
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
    } else if (c === "$" && input[i + 1] === "(") {
      endSegment();
      i++;
    } else {
      inWord = true;
      word += c;
    }
  }
  endSegment();
  return { segments, nested };
}

function matchParen(input, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < input.length; i++) {
    if (input[i] === "(") depth++;
    else if (input[i] === ")" && --depth === 0) return i;
  }
  return input.length;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]);
// wrapper -> options that take a value
const WRAPPERS = {
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S"]),
  command: new Set(),
  builtin: new Set(),
  exec: new Set(["-a"]),
  nohup: new Set(),
  nice: new Set(["-n"]),
  ionice: new Set(["-c", "-n", "-p"]),
  time: new Set(),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  xargs: new Set(["-I", "-n", "-P", "-d", "-L", "-s", "-E"]),
  stdbuf: new Set(["-i", "-o", "-e"]),
  setsid: new Set(),
};

function commandName(word) {
  return word.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
}

// ---------------------------------------------------------------- git helpers

function currentBranch(dir) {
  try {
    const out = execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null; // not a repository, or detached HEAD
  }
}

function stripRef(ref) {
  return ref.replace(/^\+/, "").replace(/^refs\/heads\//, "");
}

const GIT_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);
const PUSH_OPTS_WITH_VALUE = new Set(["--repo", "-o", "--push-option", "--receive-pack", "--exec", "--recurse-submodules", "--signed"]);

function checkGit(args, ctx) {
  let dir = ctx.cwd;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) break;
    if (a === "-C") {
      dir = path.resolve(dir, args[i + 1] ?? ".");
      i++;
    } else if (GIT_OPTS_WITH_VALUE.has(a)) {
      i++;
    }
  }
  const sub = args[i];
  const rest = args.slice(i + 1);

  if (sub === "commit") {
    const branch = currentBranch(dir);
    if (branch !== null && matchesBranch(branch, ctx.protectedBranches)) {
      block(`git commit on the protected branch "${branch}". Create a working branch first.`);
    }
    return;
  }

  if (sub !== "push") return;

  const positional = [];
  let forced = false;
  let deleting = false;
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    if (a === "--") {
      positional.push(...rest.slice(k + 1));
      break;
    }
    if (a === "--force" || a === "-f" || a.startsWith("--force-with-lease") || a === "--force-if-includes") {
      forced = true;
    } else if (a === "--delete" || a === "-d") {
      deleting = true;
    } else if (a === "--all" || a === "--mirror") {
      block(`git push ${a} would push protected branches`);
    } else if (a.startsWith("--")) {
      if (!a.includes("=") && PUSH_OPTS_WITH_VALUE.has(a)) k++;
    } else if (a.startsWith("-") && a.length > 1) {
      if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) forced = true;
      if (/^-[a-zA-Z]*d[a-zA-Z]*$/.test(a)) deleting = true;
      if (a === "-o") k++;
    } else {
      positional.push(a);
    }
  }
  if (forced) block("force push is not allowed (--force, -f, --force-with-lease)");

  const refspecs = positional.slice(1);
  if (refspecs.some((r) => r.startsWith("+"))) block("force push is not allowed (refspec starting with +)");

  const branch = currentBranch(dir);
  const targets = [];
  if (refspecs.length === 0) {
    if (branch !== null) targets.push(branch);
  } else {
    for (const spec of refspecs) {
      const [src, dst] = spec.includes(":") ? spec.split(":", 2) : [spec, ""];
      let target = stripRef(dst !== "" ? dst : src);
      if (target === "HEAD" || target === "@") target = branch ?? "";
      if (target !== "") targets.push(target);
      // `git push origin :main` deletes main
    }
  }
  for (const t of targets) {
    if (matchesBranch(t, ctx.protectedBranches)) {
      block(`${deleting ? "deleting" : "pushing to"} the protected branch "${t}" is not allowed. Push a working branch and open a pull request.`);
    }
  }
}

// ---------------------------------------------------------------- command analysis

function checkRm(args) {
  let recursive = false;
  let force = false;
  for (const a of args) {
    if (a === "--") break;
    if (a === "--recursive") recursive = true;
    else if (a === "--force") force = true;
    else if (/^-[a-zA-Z]+$/.test(a)) {
      if (/[rR]/.test(a)) recursive = true;
      if (a.includes("f")) force = true;
    }
  }
  if (recursive && force) block("rm with recursive and force flags (rm -rf) is not allowed");
}

function analyzeSegment(words, ctx) {
  let i = 0;
  // leading VAR=value
  while (i < words.length && ASSIGNMENT.test(words[i])) i++;
  // wrappers (sudo, env, timeout...)
  for (;;) {
    const name = words[i] === undefined ? "" : commandName(words[i]);
    const takesValue = WRAPPERS[name];
    if (takesValue === undefined) break;
    i++;
    while (i < words.length) {
      const w = words[i];
      if (ASSIGNMENT.test(w)) i++;
      else if (w.startsWith("-") && w !== "--") i += takesValue.has(w) ? 2 : 1;
      else break;
    }
    if (name === "timeout" && i < words.length) i++; // timeout [options] DURATION command
    while (i < words.length && ASSIGNMENT.test(words[i])) i++;
  }
  const cmd = words[i] === undefined ? "" : commandName(words[i]);
  const args = words.slice(i + 1);

  if (cmd === "cd" || cmd === "pushd") {
    if (args[0] !== undefined) ctx.cwd = path.resolve(ctx.cwd, args[0]);
  } else if (cmd === "rm") {
    checkRm(args);
  } else if (cmd === "git") {
    checkGit(args, ctx);
  } else if (SHELLS.has(cmd)) {
    const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (c !== -1 && args[c + 1] !== undefined) analyzeCommand(args[c + 1], ctx);
  } else if (cmd === "eval") {
    analyzeCommand(args.join(" "), ctx);
  }
}

function analyzeCommand(command, ctx, depth = 0) {
  if (depth > 6) block("command is nested too deeply to analyze");
  const { segments, nested } = parseShell(command);
  for (const words of segments) {
    for (const w of words) checkSecretCandidate(w);
  }
  for (const words of segments) analyzeSegment(words, ctx);
  for (const inner of nested) analyzeCommand(inner, ctx, depth + 1);
}

// ---------------------------------------------------------------- entry point

/**
 * @param {{ tool_name?: string, tool_input?: unknown, cwd?: string }} input hook payload
 * @param {{ projectDir: string }} env
 * @returns {string | null} reason when blocked, otherwise null
 */
export function evaluate(input, env) {
  try {
    const toolName = input.tool_name ?? "";
    const toolInput = input.tool_input ?? {};
    if (toolName === "Bash") {
      const command = toolInput.command;
      if (typeof command !== "string") return null;
      const ctx = {
        cwd: path.resolve(input.cwd ?? env.projectDir),
        protectedBranches: loadProtected(env.projectDir),
      };
      analyzeCommand(command, ctx);
    } else {
      for (const s of collectStrings(toolInput)) {
        if (isSecretPath(s)) block(`${JSON.stringify(s)} is an .env file (only .env.example may be read or written)`);
      }
    }
    return null;
  } catch (e) {
    if (e instanceof Block) return e.message;
    return `engkit-guard failed (${e instanceof Error ? e.message : String(e)}); blocking to be safe`;
  }
}

function readStdin() {
  return fs.readFileSync(0, "utf-8");
}

function main() {
  let reason;
  try {
    const input = JSON.parse(readStdin());
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    reason = evaluate(input, { projectDir });
  } catch (e) {
    reason = `engkit-guard could not read its input (${e instanceof Error ? e.message : String(e)}); blocking to be safe`;
  }
  if (reason !== null) {
    process.stderr.write(`engkit-guard: blocked. ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

let invoked = false;
try {
  invoked = fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(fileURLToPath(import.meta.url));
} catch {
  invoked = false;
}
if (invoked) main();
