/**
 * The Content-Security-Policy of each page: it can load its own script and style and nothing else.
 * `connect-src 'none'` blocks fetch, XMLHttpRequest, WebSocket, EventSource and beacons.
 * The regex worker is created from a blob: URL, so it inherits this policy.
 */
export const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src data:",
  "connect-src 'none'",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
] as const;

export const CSP = CSP_DIRECTIVES.join("; ");

/**
 * mermaid.html differs in one directive: Mermaid writes <style> elements and style attributes while it draws,
 * from what the user types, so they cannot be listed by hash, and a nonce in a static site is public.
 * Scripts and connections are as strict as in the other page. What is left open is documented in README.md.
 * The page uses no worker, so none is allowed.
 */
export const MERMAID_CSP = CSP_DIRECTIVES.map((d) => (d.startsWith("style-src") ? "style-src 'self' 'unsafe-inline'" : d.startsWith("worker-src") ? "worker-src 'none'" : d)).join("; ");
