# Developer utilities (web)

Four tools that run entirely in the browser, in Spanish and English. A static site, separate from the `engkit` CLI and not included in its npm package.

| Tool | What it does |
|---|---|
| JSON | Prettify, minify, validate (with line and column), TypeScript types and Zod 4 schemas from a sample. Numbers are never altered when formatting |
| Converter | JSON, YAML, TOML, CSV and XML, in any direction. Everything that cannot be kept is listed as a warning |
| Regex | JavaScript regular expressions: highlighted matches and groups. Runs in a worker that is stopped after 1.5 s; see [Regex in Safari](#regex-in-safari) |
| JWT | Header, payload and `iat` / `nbf` / `exp`. **The signature is not verified** |

Language: `?lang=es|en`, then the saved choice, then Spanish.

## Development

Requires Node.js 22.12 or newer.

```bash
cd web
npm ci
npm run dev                 # no Content-Security-Policy: the dev server needs a WebSocket
npm run typecheck
npm test                    # unit tests
npm run build && npm run test:build     # network scan, policy and size budget
npx playwright install chromium firefox webkit   # once; on Linux add --with-deps (needs sudo)
npm run test:e2e            # runs against the built site
```

```
src/core/       conversions, type generators, regex and JWT: pure functions without DOM
src/ui/         Preact components
src/i18n.ts     Spanish and English texts
csp.ts          the Content-Security-Policy added to the build
scripts/network-scan.ts   what the build may not contain, and the reviewed exceptions
```

## Privacy

The requirement: nothing typed leaves the browser.

| Layer | Guarantee | Test |
|---|---|---|
| Content-Security-Policy | `connect-src 'none'`; only the site's own script and style; workers only from `blob:`; no forms | `e2e/privacy.spec.ts`: every way of connecting fails, from the page and from the worker |
| Build scan | No network or `eval` code, nor external URLs, outside the reviewed list | `test/build/build.test.ts` |
| Behaviour | No request after loading, whatever is typed | `e2e/privacy.spec.ts` |
| No traces | Input is not stored or put in the URL; only the language and theme are saved | `e2e/privacy.spec.ts` |

Text fields have spell checking off, since some browsers send the text to an online service to check it. The site is one script and one style sheet, so it keeps working without a connection once loaded.

**Reviewed list.** `scripts/network-scan.ts` explains each exception: which code it is, from which library, why it cannot reach the network and which test shows it. Today there are five: three XML namespace names in Preact and the two ways Vite's loader can start the inline worker. A new finding, or a different number of uses, fails the build tests.

**Dependency choice.** CSV uses `csv-parse` and `csv-stringify`, not `papaparse`: `papaparse` ships code that downloads files with `XMLHttpRequest` and code that builds functions from text, and the bundler cannot remove them. The cost is about 16 KB more (gzip). `csv-parse` also rejects unclosed quotes and uneven rows.

**Limits.** The policy does not stop navigation to another address, so only the tests cover that. The scan is a text search and cannot see disguised names. Nothing here protects against browser extensions or a compromised computer. A hosting provider logs the requests for the page itself (never what you type).

## Accessibility

Target: WCAG 2.1 AA. `e2e/accessibility.spec.ts` runs axe on every tool in both themes and checks the keyboard (ARIA tabs, no focus trap, visible focus). Matches are underlined and numbered, not only coloured.

Automated checks do not cover everything. **Not verified with a screen reader.** Manual review before publishing:

- [ ] With a screen reader: tabs, labels, errors, warnings and the match count are announced and make sense
- [ ] At 200 % and 400 % zoom nothing is cut off or needs scrolling in two directions, except tables
- [ ] The whole app can be used with the keyboard in Safari
- [ ] With forced colours (Windows high contrast) matches and the selected tab can be told apart

## Conversion limits

- Regex syntax is JavaScript's; other engines differ.
- CSV: nested objects become `parent.child` columns and lists are JSON inside a cell. Reading CSV does not rebuild them: every value is text.
- XML: attributes are `@_name` and text is `#text`. Values are text; document types (`DOCTYPE`) are rejected.
- Comments, anchors and formatting are not kept between formats.
- TOML needs a table at the root: lists go under `items`.

## Regex in Safari

Chromium and Firefox keep trying a catastrophic pattern until the worker is stopped, and the app explains why. **WebKit (Safari) gives up on its own after a fraction of a second and reports no match**, even losing matches that exist further on in the text, with no error. The engine offers no way to know that this happened, so the app warns about any evaluation slower than 100 ms that results may be missing. It is a heuristic: on a very fast machine the engine could give up below that threshold.

## Publishing

Nothing is deployed automatically. `npm run build` writes a static site to `web/dist` with relative paths, so the same files work at a domain root or in a subfolder.

### Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `web`. `vercel.json` sets the build command (`npm run build`), the output (`dist`) and the security headers, including the policy with `frame-ancestors 'none'`.
3. Deploy. Check in the browser's network panel that the `Content-Security-Policy` header arrives.

Leave Vercel's analytics, speed insights and toolbar **off**: they inject scripts, which the policy blocks, and they would break the privacy promise. Once connected, Vercel deploys on every push.

### GitHub Pages

Pages cannot send custom headers: the policy travels only in the HTML, so framing by another site cannot be forbidden there.

1. In the repository, *Settings → Pages → Source: GitHub Actions*.
2. Create `.github/workflows/pages.yml` with this content (it is not in the repository on purpose):

```yaml
name: Pages

on:
  workflow_dispatch: # manual; add a push trigger only if you want every change published

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci && npm run build && npm run test:build
        working-directory: web
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: web/dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

3. Run it from the *Actions* tab. The versions of the `pages` actions above were not verified: check the latest ones.
