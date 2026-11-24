import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { elementLines, type ElementId, type PromptAnswers, ELEMENT_IDS } from "./model.js";

export interface SecretFinding {
  element: ElementId;
  /** 1-based line inside the element's text. */
  line: number;
  kind: string;
  /** Masked excerpt. A secret is never shown in full. */
  excerpt: string;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "API key (sk-)", re: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{24,}/g },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Stripe key", re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "URL with credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s/]+/gi },
  {
    kind: "secret assignment",
    re: /\b[\w-]*(?:api[_-]?key|secret|token|passwd|password|private[_-]?key|access[_-]?key)[\w-]*\s*[:=]\s*["']?[A-Za-z0-9/+_=.-]{12,}/gi,
  },
];

/** Shows at most the first 4 characters of a match. */
export function mask(match: string): string {
  const visible = match.length >= 12 ? match.slice(0, 4) : "";
  return `${visible}***`;
}

/** `name=value` assignments: show only the name. */
function maskAssignment(match: string): string {
  const m = /^([^:=]*[:=])/.exec(match);
  return m ? `${m[1]}***` : mask(match);
}

const SECRET_NAME = /(key|secret|token|passw|pwd|credential|private|auth|signature|cert|dsn)/i;
const PLACEHOLDERS = /^(true|false|null|undefined|changeme|change-me|example|your[-_ ].*|xxx+|\*+|<.*>)$/i;

export interface EnvValue {
  name: string;
  file: string;
  value: string;
}

/**
 * Values from `.env` and `.env.*` in `cwd` (not `.env.example` and similar) that look secret: the variable
 * name suggests a secret, or the value matches a token pattern. Read in memory only; values are never printed.
 */
export function loadEnvSecrets(cwd: string): EnvValue[] {
  if (!existsSync(cwd)) return [];
  const out: EnvValue[] = [];
  for (const name of readdirSync(cwd)) {
    if (!/^\.env(\..+)?$/.test(name) || /\.(example|sample|template|dist)$/i.test(name)) continue;
    const file = path.join(cwd, name);
    if (!statSync(file).isFile()) continue;
    for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
      if (!m || m[1]!.startsWith("#")) continue;
      const value = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
      if (value.length < 8 || PLACEHOLDERS.test(value)) continue;
      const looksSecret = SECRET_NAME.test(m[1]!) || PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags.replace("g", "")).test(value));
      if (looksSecret) out.push({ name: m[1]!, file: name, value });
    }
  }
  return out;
}

/** Looks for secrets in every element. `env` are the values returned by `loadEnvSecrets`. */
export function scanForSecrets(answers: PromptAnswers, env: EnvValue[] = []): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const id of ELEMENT_IDS) {
    elementLines(answers, id).forEach((text, i) => {
      const line = i + 1;
      for (const { kind, re } of PATTERNS) {
        for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
          findings.push({ element: id, line, kind, excerpt: kind === "secret assignment" ? maskAssignment(m[0]) : mask(m[0]) });
        }
      }
      for (const e of env) {
        if (text.includes(e.value)) {
          findings.push({ element: id, line, kind: "value from an .env file", excerpt: `${e.file}:${e.name}` });
        }
      }
    });
  }
  // The same text can match two patterns (for example "sk-" key assigned to API_KEY): keep one finding per line and excerpt.
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.element}:${f.line}:${f.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
