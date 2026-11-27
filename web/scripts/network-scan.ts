/**
 * Looks for code that could reach the network (or run text as code) in the sources and in the build.
 * It is a text search: it cannot see `globalThis["fe" + "tch"]`. The e2e privacy tests and the
 * Content-Security-Policy cover what it cannot.
 */
export const RULES: Record<string, RegExp> = {
  fetch: /\bfetch\b/g,
  "xml-http-request": /XMLHttpRequest/g,
  "web-socket": /WebSocket|WebTransport/g,
  "event-source": /EventSource/g,
  beacon: /sendBeacon/g,
  "web-rtc": /RTCPeerConnection|RTCDataChannel/g,
  worker: /new (?:Shared)?Worker\b|importScripts|serviceWorker/g,
  "dynamic-import": /\bimport\s*\(/g,
  "external-url": /\b(?:https?|wss?|ftp):\/\/[^\s"'`)\\<>]*/g,
  "protocol-relative-url": /["'`(=]\/\/[a-z0-9-]+\.[a-z]{2,}/gi,
  "css-import": /@import/g,
  navigation: /window\.open\b|location\.(?:assign|replace)\s*\(|location(?:\.href)?\s*=[^=]/g,
  "element-loading": /new Image\b|createElement\(\s*["'`](?:script|iframe|img|link|object|embed|form)\b|\.submit\(\)/g,
  eval: /\beval\s*\(|new Function\b|\bFunction\s*\(\s*["'`]/g,
};

export interface Finding {
  rule: string;
  match: string;
  /** The text around the match. */
  context: string;
}

export function scan(code: string): Finding[] {
  return Object.entries(RULES).flatMap(([rule, pattern]) =>
    [...code.matchAll(pattern)].map((m) => ({
      rule,
      match: m[0],
      context: code.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80),
    }))
  );
}

export interface Allowed {
  rule: string;
  /** The exact matched text. */
  match: string;
  /** Narrows the entry to this code. */
  context?: RegExp;
  /** How many times it appears in the build. A different number means the code changed: review it again. */
  count: number;
  library: string;
  what: string;
  unreachable: string;
  /** Title of the test in e2e/privacy.spec.ts that shows it. */
  test: string;
}

/**
 * The reviewed list: every finding of the build must match one entry, and every entry must still be used.
 * Adding an entry requires the comment above it and the same justification in the pull request.
 */
export const ALLOWED: Allowed[] = [
  // WHAT: the SVG namespace identifier, compared and passed to createElementNS by Preact's renderer.
  // LIBRARY: preact (diff and props code).
  // WHY IT CANNOT REACH THE NETWORK: it is a name, not an address that is loaded; its branch also needs an
  // <svg> element, and the app renders none.
  // TEST: "renders no SVG or MathML and requests nothing".
  {
    rule: "external-url",
    match: "http://www.w3.org/2000/svg",
    count: 2,
    library: "preact",
    what: "SVG namespace identifier used when rendering",
    unreachable: "a namespace name is never requested, and the app renders no <svg>",
    test: "renders no SVG or MathML and requests nothing",
  },
  // WHAT: the MathML namespace identifier, for <math> elements.
  // LIBRARY: preact (element creation).
  // WHY IT CANNOT REACH THE NETWORK: a name passed to createElementNS; the app renders no <math>.
  // TEST: "renders no SVG or MathML and requests nothing".
  {
    rule: "external-url",
    match: "http://www.w3.org/1998/Math/MathML",
    count: 2,
    library: "preact",
    what: "MathML namespace identifier used when rendering",
    unreachable: "a namespace name is never requested, and the app renders no <math>",
    test: "renders no SVG or MathML and requests nothing",
  },
  // WHAT: the XHTML namespace identifier, the namespace of every ordinary element.
  // LIBRARY: preact (element creation).
  // WHY IT CANNOT REACH THE NETWORK: this code does run, but the string only names the namespace for
  // createElementNS; browsers never load it.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "external-url",
    match: "http://www.w3.org/1999/xhtml",
    count: 2,
    library: "preact",
    what: "XHTML namespace identifier used when creating elements",
    unreachable: "it runs, but as a namespace name: nothing is loaded from it",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: the regex worker, started from a blob: URL built from code that is inside the bundle.
  // LIBRARY: Vite's inline-worker loader (the `?worker&inline` import in RegexTool).
  // WHY IT CANNOT REACH THE NETWORK: the URL is local memory, and a blob: worker inherits the page's policy
  // (connect-src 'none'). Its code is part of this same scan.
  // TEST: "runs the regex in a blob: worker that cannot connect".
  {
    rule: "worker",
    match: "new Worker",
    context: /createObjectURL\([\s\S]{0,60}new Worker\(\w+,\{name:/,
    count: 1,
    library: "vite",
    what: "creates the inline regex worker from a blob: URL",
    unreachable: "reachable on purpose; the worker cannot connect",
    test: "runs the regex in a blob: worker that cannot connect",
  },
  // WHAT: the loader's fallback: the same code as a data: URL, used only if creating the blob URL throws.
  // LIBRARY: Vite's inline-worker loader.
  // WHY IT IS UNREACHABLE: the policy allows workers from blob: only, so the browser refuses a data: worker;
  // it would not load anything remote either, since the code is in the URL itself.
  // TEST: "refuses a data: worker".
  {
    rule: "worker",
    match: "new Worker",
    context: /new Worker\(`data:text\/javascript/,
    count: 1,
    library: "vite",
    what: "fallback that would start the worker from a data: URL",
    unreachable: "worker-src blob: makes the browser refuse it",
    test: "refuses a data: worker",
  },
];

export interface ScanResult {
  /** Findings that no entry allows. */
  unexpected: Finding[];
  /** Entries whose number of uses differs from `count`. */
  stale: { entry: Allowed; found: number }[];
}

export function review(findings: Finding[], allowed: Allowed[] = ALLOWED): ScanResult {
  const used = new Map<Allowed, number>();
  const unexpected = findings.filter((f) => {
    const entry = allowed.find((a) => a.rule === f.rule && a.match === f.match && (!a.context || a.context.test(f.context)));
    if (entry) used.set(entry, (used.get(entry) ?? 0) + 1);
    return !entry;
  });
  const stale = allowed.filter((a) => (used.get(a) ?? 0) !== a.count).map((entry) => ({ entry, found: used.get(entry) ?? 0 }));
  return { unexpected, stale };
}
