import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { CSP, MERMAID_CSP } from "./csp.js";

/** Adds the policy as the first element of <head>. Only in the build: the dev server needs a WebSocket. */
const contentSecurityPolicy = (policy: string): Plugin => ({
  name: "engkit-csp",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (html) => html.replace(/<meta charset="utf-8"\s*\/?>/, (charset) => `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  },
});

const local = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/**
 * Two builds into the same folder, so that each page has its own script and style sheet and the first one
 * carries nothing of Mermaid: `vite build` for index.html, then `vite build --mode mermaid` for mermaid.html.
 */
export default defineConfig(({ mode, command }) => {
  const mermaid = mode === "mermaid";
  return {
    // relative paths: the same build works at a domain root (Vercel) or under /<repo>/ (GitHub Pages)
    base: "./",
    plugins: [contentSecurityPolicy(mermaid ? MERMAID_CSP : CSP)],
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    resolve: {
      // left out of the Mermaid page for their size (and, for elkjs, its licence): see README.md
      alias:
        mermaid || command === "serve"
          ? [
              { find: /^elkjs(\/.*)?$/, replacement: local("./src/mermaid/stubs/elk.ts") },
              { find: /^katex(\/.*)?$/, replacement: local("./src/mermaid/stubs/katex.ts") },
            ]
          : [],
    },
    build: {
      target: "es2023",
      // the preload polyfill calls fetch()
      modulePreload: { polyfill: false },
      cssCodeSplit: false,
      sourcemap: false,
      emptyOutDir: !mermaid,
      ...(mermaid
        ? {
            // one script: nothing is requested after the page has loaded
            chunkSizeWarningLimit: 4000,
            rolldownOptions: {
              input: local("./mermaid.html"),
              output: {
                codeSplitting: false,
                entryFileNames: "assets/mermaid-[hash].js",
                assetFileNames: "assets/mermaid-[hash][extname]",
              },
            },
          }
        : {}),
    },
  };
});
