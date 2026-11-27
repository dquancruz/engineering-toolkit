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
 * The reviewed list of index.html and its script: every finding must match one entry, and every entry must still be used.
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

/**
 * Every web address in the script of the Mermaid page, with how many times it appears. None is loaded: they are
 * XML namespace names and links inside error messages (and, once, the "http://" that Markdown puts before
 * "www."). A different number, a new address or a missing one fails the build tests: a new Mermaid version has to
 * be reviewed here.
 */
export const MERMAID_URLS: Record<"namespace" | "message", Record<string, number>> = {
  namespace: {
    "http://www.w3.org/1998/Math/MathML": 3,
    "http://www.w3.org/1999/xhtml": 8,
    "http://www.w3.org/1999/xlink": 4,
    "http://www.w3.org/2000/svg": 17,
    "http://www.w3.org/2000/xmlns/": 1,
    "http://www.w3.org/XML/1998/namespace": 2,
  },
  message: {
    "http://": 1,
    "https://chevrotain.io/docs/FAQ.html#NUMERICAL_SUFFIXES": 2,
    "https://chevrotain.io/docs/changes/BREAKING_CHANGES.html#_4-0-0": 2,
    "https://chevrotain.io/docs/changes/BREAKING_CHANGES.html#_6-0-0": 2,
    "https://chevrotain.io/docs/guide/internals.html#grammar-recording": 6,
    "https://chevrotain.io/docs/guide/resolving_grammar_errors.html#AMBIGUOUS_ALTERNATIVES": 3,
    "https://chevrotain.io/docs/guide/resolving_grammar_errors.html#COMMON_PREFIX": 2,
    "https://chevrotain.io/docs/guide/resolving_grammar_errors.html#IGNORING_AMBIGUITIES": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#ANCHORS": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#COMPLEMENT": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#CUSTOM_LINE_BREAK": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#CUSTOM_OPTIMIZE": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#IDENTIFY_TERMINATOR": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#LINE_BREAKS": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#MISSING_LINE_TERM_CHARS": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#REGEXP_PARSING": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#UNICODE_OPTIMIZE": 2,
    "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#UNREACHABLE": 2,
    "https://en.wikipedia.org/wiki/LL_parser#Left_factoring.": 2,
    "https://github.com/chevrotain/chevrotain/issues": 2,
    "https://github.com/chevrotain/chevrotain/issues/564#issuecomment-349062346": 2,
    "https://github.com/markedjs/marked.": 1,
    "https://github.com/mermaid-js/mermaid/issues": 1,
    "https://github.com/mermaid-js/mermaid/issues.": 4,
    "https://github.com/mermaid-js/mermaid/releases/tag/v11.0.0": 1,
    "https://langium.org/docs/reference/configuration-services/#resolving-cyclic-dependencies": 1,
  },
};

const URL_REASONS = {
  namespace: { what: "XML namespace name", unreachable: "a namespace name is compared or passed to createElementNS, never requested" },
  message: { what: "link inside a message", unreachable: "text of an error message; the policy blocks connections in any case" },
} as const;

const mermaidUrls: Allowed[] = (["namespace", "message"] as const).flatMap((kind) =>
  Object.entries(MERMAID_URLS[kind]).map(([match, count]) => ({
    rule: "external-url",
    match,
    count,
    library: "mermaid and its dependencies",
    ...URL_REASONS[kind],
    test: "makes no request after loading, whatever is typed",
  }))
);

/** The reviewed findings of the Mermaid page, other than addresses. */
export const MERMAID_CODE: Allowed[] = [
  // WHAT: the name of the CSS statement in the style preprocessor that Mermaid uses.
  // LIBRARY: stylis.
  // WHY IT CANNOT REACH THE NETWORK: a diagram cannot set themeCSS, and the policy allows no style sheet from elsewhere.
  // TEST: "hostile diagrams run nothing, restyle nothing and leave no links in the file".
  {
    rule: "css-import",
    match: "@import",
    context: /`@namespace`/,
    count: 1,
    library: "stylis",
    what: "the name of the CSS statement in the style preprocessor that Mermaid uses",
    unreachable: "a diagram cannot set themeCSS, and the policy allows no style sheet from elsewhere",
    test: "hostile diagrams run nothing, restyle nothing and leave no links in the file",
  },
  // WHAT: the patterns that remove the statement from a diagram.
  // LIBRARY: this app.
  // WHY IT CANNOT REACH THE NETWORK: it deletes imports; it never loads one.
  // TEST: "hostile diagrams run nothing, restyle nothing and leave no links in the file".
  {
    rule: "css-import",
    match: "@import",
    context: /@font-face/,
    count: 2,
    library: "this app",
    what: "the patterns that remove the statement from a diagram",
    unreachable: "it deletes imports; it never loads one",
    test: "hostile diagrams run nothing, restyle nothing and leave no links in the file",
  },
  // WHAT: a property named location on the nodes of a parser.
  // LIBRARY: chevrotain.
  // WHY IT CANNOT REACH THE NETWORK: it is the position of a token in the text, not the address of the page.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "navigation",
    match: "location={",
    context: /\.location=\{startOffset/,
    count: 8,
    library: "chevrotain",
    what: "a property named location on the nodes of a parser",
    unreachable: "it is the position of a token in the text, not the address of the page",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: the handler that a click statement attaches to a drawn node.
  // LIBRARY: mermaid.
  // WHY IT CANNOT REACH THE NETWORK: handlers are attached only by bindFunctions, which the app never calls, and the diagram is shown as a picture.
  // TEST: "hostile diagrams run nothing, restyle nothing and leave no links in the file".
  {
    rule: "navigation",
    match: "window.open",
    context: /window\.open\(\w+,`_self`\)/,
    count: 1,
    library: "mermaid",
    what: "the handler that a click statement attaches to a drawn node",
    unreachable: "handlers are attached only by bindFunctions, which the app never calls, and the diagram is shown as a picture",
    test: "hostile diagrams run nothing, restyle nothing and leave no links in the file",
  },
  // WHAT: the picture drawn to a canvas to make the PNG.
  // LIBRARY: this app.
  // WHY IT CANNOT REACH THE NETWORK: its address is a data: URL of the cleaned diagram, the only kind the policy allows.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "element-loading",
    match: "new Image",
    context: /createElement\(`canvas`\)/,
    count: 1,
    library: "this app",
    what: "the picture drawn to a canvas to make the PNG",
    unreachable: "its address is a data: URL of the cleaned diagram, the only kind the policy allows",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: loads the picture of a node written with img:.
  // LIBRARY: mermaid.
  // WHY IT CANNOT REACH THE NETWORK: the app refuses a web address before drawing, and img-src data: blocks any other way to write it.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "element-loading",
    match: "new Image",
    context: /\?\.img\?\?``/,
    count: 1,
    library: "mermaid",
    what: "loads the picture of a node written with img:",
    unreachable: "the app refuses a web address before drawing, and img-src data: blocks any other way to write it",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: loads background pictures of graph nodes.
  // LIBRARY: cytoscape.
  // WHY IT CANNOT REACH THE NETWORK: Mermaid uses cytoscape to place nodes and gives them no picture; img-src data: blocks any.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "element-loading",
    match: "new Image",
    context: /addEventListener\(`load`/,
    count: 1,
    library: "cytoscape",
    what: "loads background pictures of graph nodes",
    unreachable: "Mermaid uses cytoscape to place nodes and gives them no picture; img-src data: blocks any",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: a form element used to detect clobbered properties.
  // LIBRARY: dompurify.
  // WHY IT CANNOT REACH THE NETWORK: it is never filled, attached or submitted, and form-action is none.
  // TEST: "hostile diagrams run nothing, restyle nothing and leave no links in the file".
  {
    rule: "element-loading",
    match: "createElement(`form",
    context: /createElement\(`form`\),\w+=function/,
    count: 1,
    library: "dompurify",
    what: "a form element used to detect clobbered properties",
    unreachable: "it is never filled, attached or submitted, and form-action is none",
    test: "hostile diagrams run nothing, restyle nothing and leave no links in the file",
  },
  // WHAT: asks whether the browser supports preload links.
  // LIBRARY: vite.
  // WHY IT CANNOT REACH THE NETWORK: the element is only inspected, never attached.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "element-loading",
    match: "createElement(`link",
    context: /\.relList/,
    count: 1,
    library: "vite",
    what: "asks whether the browser supports preload links",
    unreachable: "the element is only inspected, never attached",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: the preload of the files of a chunk loaded later.
  // LIBRARY: vite.
  // WHY IT CANNOT REACH THE NETWORK: the build has a single script, so there is nothing to preload, and the policy allows only the site's own files.
  // TEST: "makes no request after loading, whatever is typed".
  {
    rule: "element-loading",
    match: "createElement(`link",
    context: /`stylesheet`/,
    count: 1,
    library: "vite",
    what: "the preload of the files of a chunk loaded later",
    unreachable: "the build has a single script, so there is nothing to preload, and the policy allows only the site's own files",
    test: "makes no request after loading, whatever is typed",
  },
  // WHAT: a fallback that finds the global object by running text as code.
  // LIBRARY: es-toolkit / lodash.
  // WHY IT CANNOT REACH THE NETWORK: it is only reached when self does not exist, and without unsafe-eval the browser refuses it.
  // TEST: "the check above would see code that needs eval".
  {
    rule: "eval",
    match: "Function(`",
    context: /Function\(`return this`\)/,
    count: 3,
    library: "es-toolkit / lodash",
    what: "a fallback that finds the global object by running text as code",
    unreachable: "it is only reached when self does not exist, and without unsafe-eval the browser refuses it",
    test: "the check above would see code that needs eval",
  },
];

export const MERMAID_ALLOWED: Allowed[] = [...mermaidUrls, ...MERMAID_CODE];

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
