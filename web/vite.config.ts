import { defineConfig, type Plugin } from "vite";
import { CSP } from "./csp.js";

/** Adds the policy as the first element of <head>. Only in the build: the dev server needs a WebSocket. */
const contentSecurityPolicy = (): Plugin => ({
  name: "engkit-csp",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (html) => html.replace(/<meta charset="utf-8"\s*\/?>/, (charset) => `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  },
});

export default defineConfig({
  // relative paths: the same build works at a domain root (Vercel) or under /<repo>/ (GitHub Pages)
  base: "./",
  plugins: [contentSecurityPolicy()],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    target: "es2023",
    // the preload polyfill calls fetch()
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
    sourcemap: false,
  },
});
