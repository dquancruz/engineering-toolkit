import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SELF_ROOT, type EvidenceRootConfig } from "../config.js";
import { runGit } from "../git/exec.js";

// Code cited as evidence is read and hashed, never printed or copied into the project.

export interface EvidenceRef {
  root: string;
  /** Relative to the root, with "/" separators. */
  path: string;
  start: number;
  end: number;
}

export class EvidenceRefError extends Error {}

const REF = /^([A-Za-z0-9_-]{2,}):(.+?):(\d+)(?:-(\d+))?$/;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** A range with fewer significant characters (a lone `}` or `END-IF.`) matches too many places. */
export const WEAK_LENGTH = 12;

const isSecretName = (segment: string) => {
  const name = segment.toLowerCase();
  return name.startsWith(".env") && name !== ".env.example";
};

export function parseRef(text: string): EvidenceRef {
  const m = REF.exec(text.trim());
  if (!m) throw new EvidenceRefError(`"${text}" is not <root>:<path>:<line> or <root>:<path>:<start>-<end>.`);
  const [, root = "", file = "", a, b] = m;
  const start = Number(a);
  const end = b === undefined ? start : Number(b);
  if (start < 1 || end < start) throw new EvidenceRefError(`"${text}": invalid line range.`);
  const segments = file.split("/");
  if (file.includes("\\") || path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || segments.includes("..")) {
    throw new EvidenceRefError(`"${text}": the path must be relative to its root, with "/" and without "..".`);
  }
  if (segments.some(isSecretName)) throw new EvidenceRefError(`"${text}": .env files cannot be used as evidence.`);
  return { root, path: file, start, end };
}

export const formatRef = (r: EvidenceRef) => `${r.root}:${r.path}:${r.start}${r.end === r.start ? "" : `-${r.end}`}`;

/** Lines of a file without leading and trailing ASCII whitespace. Bytes are kept as they are (latin1 is 1:1). */
export function normalizedLines(content: Buffer): string[] {
  const text = content.toString("latin1").replace(/^\xEF\xBB\xBF/, "");
  const lines = text.split("\n").map((l) => l.replace(/^[ \t\r\f\v]+|[ \t\r\f\v]+$/g, ""));
  if (text.endsWith("\n") || text === "") lines.pop();
  return lines;
}

export const hashLines = (lines: string[]) =>
  createHash("sha256").update(Buffer.from(lines.join("\n"), "latin1")).digest("hex").slice(0, 12);

export const isWeak = (lines: string[]) => lines.join("").replace(/\s/g, "").length < WEAK_LENGTH;

export type RootState = { available: true; dir: string } | { available: false; configured: string };

/** Reads evidence files, with caching: hundreds of rules often cite the same files. */
export class EvidenceReader {
  private files = new Map<string, string[] | null>();
  private states = new Map<string, RootState>();

  constructor(
    private cwd: string,
    private roots: Record<string, EvidenceRootConfig>
  ) {}

  /** Throws EvidenceRefError for a root that is not configured. */
  root(name: string): RootState {
    let state = this.states.get(name);
    if (state) return state;
    const configured = name === SELF_ROOT ? "." : this.roots[name]?.path;
    if (configured === undefined) throw new EvidenceRefError(`unknown evidence root "${name}" (add it to "evidenceRoots" in .engkit.json).`);
    const dir = path.resolve(this.cwd, configured);
    state = fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()
      ? { available: true, dir: fs.realpathSync(dir) }
      : { available: false, configured };
    this.states.set(name, state);
    return state;
  }

  /**
   * Normalized lines of the referenced file, or null when it does not exist. The root must be available.
   * Throws EvidenceRefError when the file resolves outside its root (symlinks) or to an .env file.
   */
  lines(ref: EvidenceRef): string[] | null {
    const state = this.root(ref.root);
    if (!state.available) throw new EvidenceRefError(`evidence root "${ref.root}" is not available.`);
    const key = `${ref.root}:${ref.path}`;
    const cached = this.files.get(key);
    if (cached !== undefined) return cached;

    let result: string[] | null = null;
    const abs = path.join(state.dir, ref.path);
    if (fs.existsSync(abs)) {
      const real = fs.realpathSync(abs);
      const inside = path.relative(state.dir, real);
      if (inside.startsWith("..") || path.isAbsolute(inside)) throw new EvidenceRefError(`"${key}" points outside its root.`);
      if (inside.split(path.sep).some(isSecretName)) throw new EvidenceRefError(`"${key}": .env files cannot be used as evidence.`);
      const stat = fs.statSync(real);
      if (stat.size > MAX_FILE_BYTES) throw new EvidenceRefError(`"${key}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
      if (stat.isFile()) result = normalizedLines(fs.readFileSync(real));
    }
    this.files.set(key, result);
    return result;
  }

  /** Short commit of the root, only when the file is tracked there and unchanged. */
  commit(ref: EvidenceRef): string | null {
    const state = this.root(ref.root);
    if (!state.available) return null;
    const tracked = runGit(state.dir, ["ls-files", "--error-unmatch", "--", `./${ref.path}`]).ok;
    const status = runGit(state.dir, ["status", "--porcelain", "--", `./${ref.path}`]);
    if (!tracked || !status.ok || status.stdout.trim() !== "") return null;
    const head = runGit(state.dir, ["rev-parse", "--short=12", "HEAD"]);
    return head.ok ? head.stdout.trim() : null;
  }
}

export type Verdict =
  | { state: "ok"; weak: boolean }
  /** No hash recorded yet. */
  | { state: "unrecorded" }
  /** The recorded content is now in exactly one other place. */
  | { state: "moved"; to: EvidenceRef }
  | { state: "ambiguous"; matches: number }
  /** The recorded lines hold something else, and the content cannot be told apart from noise. */
  | { state: "weak" }
  | { state: "changed"; outOfRange: boolean }
  | { state: "missing-file" };

/** Compares the recorded hash with what the file holds today. */
export function verify(ref: EvidenceRef, hash: string | null, lines: string[] | null): Verdict {
  if (lines === null) return { state: "missing-file" };
  const outOfRange = ref.end > lines.length;
  if (hash === null) return outOfRange ? { state: "changed", outOfRange } : { state: "unrecorded" };

  const length = ref.end - ref.start + 1;
  const current = lines.slice(ref.start - 1, ref.end);
  if (!outOfRange && hashLines(current) === hash) return { state: "ok", weak: isWeak(current) };

  const found: number[] = [];
  for (let i = 0; i + length <= lines.length; i++) {
    if (hashLines(lines.slice(i, i + length)) === hash) found.push(i + 1);
  }
  if (found.length === 0) return { state: "changed", outOfRange };
  const at = found[0]!;
  if (isWeak(lines.slice(at - 1, at - 1 + length))) return { state: "weak" };
  if (found.length > 1) return { state: "ambiguous", matches: found.length };
  return { state: "moved", to: { ...ref, start: at, end: at + length - 1 } };
}
