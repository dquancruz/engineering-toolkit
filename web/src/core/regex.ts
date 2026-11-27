export interface RegexRequest {
  pattern: string;
  flags: string;
  text: string;
}

export interface Group {
  /** Group number, from 1. */
  number: number;
  name?: string;
  /** Undefined when the group did not take part in the match. */
  value?: string;
}

export interface Match {
  start: number;
  end: number;
  value: string;
  groups: Group[];
}

export type Evaluation =
  | { ok: true; matches: Match[]; truncated: boolean; elapsedMs: number }
  | { ok: false; error: string };

export const MAX_MATCHES = 1000;
/**
 * An evaluation this slow is suspicious. WebKit (Safari) stops catastrophic backtracking on its own, in well
 * under the worker's time limit, and then reports no match instead of an error: the result cannot be trusted
 * and the engine gives no way to know. So a slow evaluation is flagged in every browser.
 */
export const SLOW_MS = 100;

/** Runs a JavaScript regular expression. Call it from a worker: a bad pattern can take practically forever. */
export function evaluate({ pattern, flags, text }: RegexRequest, limit = MAX_MATCHES): Evaluation {
  let re: RegExp;
  let names: (string | undefined)[];
  try {
    re = new RegExp(pattern, flags.includes("d") ? flags : `${flags}d`);
    names = groupNames(pattern);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const started = performance.now();
  const done = (matches: Match[], truncated: boolean): Evaluation => ({ ok: true, matches, truncated, elapsedMs: performance.now() - started });
  const matches: Match[] = [];
  const toMatch = (m: RegExpExecArray): Match => ({
    start: m.index,
    end: m.index + m[0].length,
    value: m[0],
    groups: m.slice(1).map((value, i) => {
      const name = names[i];
      return { number: i + 1, ...(name !== undefined ? { name } : {}), ...(value !== undefined ? { value } : {}) };
    }),
  });

  if (!re.global) {
    const m = re.exec(text);
    return done(m ? [toMatch(m)] : [], false);
  }
  for (const m of text.matchAll(re)) {
    if (matches.length === limit) return done(matches, true);
    matches.push(toMatch(m));
  }
  return done(matches, false);
}

/** The name of each capturing group, in order (undefined for unnamed ones). */
export function groupNames(pattern: string): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") i++;
    else if (inClass) inClass = c !== "]";
    else if (c === "[") inClass = true;
    else if (c === "(") {
      if (pattern[i + 1] !== "?") names.push(undefined);
      else {
        const named = /^\?<([^=!>][^>]*)>/.exec(pattern.slice(i + 1));
        if (named) names.push(named[1]);
      }
    }
  }
  return names;
}

export interface Segment {
  text: string;
  /** Index of the match this piece belongs to. */
  match?: number;
}

/** The text cut into matched and unmatched pieces. An empty match is a segment with empty text. */
export function segments(text: string, matches: Match[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  matches.forEach((m, i) => {
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    if (m.start >= at) {
      out.push({ text: text.slice(m.start, m.end), match: i });
      at = m.end;
    }
  });
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
