/**
 * The Content-Security-Policy of the built site: it can load its own script and style and nothing else.
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
