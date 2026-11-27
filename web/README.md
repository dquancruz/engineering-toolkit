# Developer utilities (web)

Tools that run entirely in the browser, in Spanish and English. A static site, separate from the `engkit` CLI and not included in its npm package. It has two pages: `index.html` with four utilities, and `mermaid.html` with the Mermaid tools, which has its own script, size budget and Content-Security-Policy.

| Tool | What it does |
|---|---|
| JSON | Prettify, minify, validate (with line and column), TypeScript types and Zod 4 schemas from a sample. Numbers are never altered when formatting |
| Converter | JSON, YAML, TOML, CSV and XML, in any direction. Everything that cannot be kept is listed as a warning |
| Regex | JavaScript regular expressions: highlighted matches and groups. Runs in a worker that is stopped after 1.5 s; see [Regex in Safari](#regex-in-safari) |
| JWT | Header, payload and `iat` / `nbf` / `exp`. **The signature is not verified** |

On `mermaid.html`:

| Tool | What it does |
|---|---|
| Diagram | Draws Mermaid code as you type, shows syntax errors with the line typed and the reason, and downloads SVG and PNG |
| Table → Mermaid | Flowchart, entity-relationship, Gantt and sequence diagrams from a CSV or Markdown table; see [Tables](#tables) |

Language: `?lang=es|en`, then the saved choice, then Spanish. Moving between the two pages loses what was typed: nothing is stored.

## Mermaid

Mermaid 12.3.0, pinned. Each diagram is drawn with `securityLevel: "strict"`, plain SVG text (`htmlLabels: false`), system fonts and the dagre layout. A diagram cannot change those, nor `themeCSS`, `themeVariables`, fonts or the sanitizer's settings, from its front matter or `%%{init}%%`.

Strict mode is not enough by itself, so the app also:

- refuses `img:` pictures with a web address;
- cleans the SVG: only drawing elements, no links, scripts, animations or references outside the file;
- shows it as a picture (`<img>`), so nothing in it can be clicked or run.

Errors give the line as typed (Mermaid counts lines after removing front matter, directives and comments). Some errors, such as an invalid Gantt date, come without a line, and the app says so. A very large diagram freezes the page while it is drawn: Mermaid needs the page to measure text and cannot run in a worker. Its limits apply (50 000 characters, 500 edges).

### What is left out

To keep the page under its budget, ELK and KaTeX are replaced by stubs in this build:

| Left out | What you lose | Why |
|---|---|---|
| ELK layout (`elkjs`), Mermaid 12's default | Every diagram is placed with dagre: complex flowcharts, class, state and entity-relationship diagrams can look less tidy than in other viewers. `layout: elk` is ignored, with a warning | About 450 KB gzip, and `elkjs` is licensed under EPL-2.0 or GPL-3.0 |
| KaTeX | `$$…$$` formulas are shown as text, with a warning | About 75 KB gzip, and formulas need HTML inside the SVG |

With both, the Mermaid script alone measured 1 425 KB gzip; without them, 897 KB.

### Known limits

- Event modeling writes its labels as HTML (so do text nodes of Venn diagrams and icon texts of architecture diagrams, by Mermaid's code). The app turns them into SVG text, without wrapping, and says so. Only event modeling was drawn in the tests.
- In use case diagrams Mermaid places the label off-centre inside the ellipse with plain text.
- A downloaded SVG uses the fonts of the computer that opens it.

## Tables

Comma, semicolon, tab or Markdown. Column names in English or Spanish, ignoring case and accents; `*` required.

| Diagram | Columns (English / Spanish) |
|---|---|
| Flowchart | `source`* / `origen`, `target`* / `destino`, `label` / `etiqueta` |
| Entity-relationship: entities | `entity`* / `entidad`, `attribute`* / `atributo`, `type`* / `tipo`, `key` / `clave` (PK, FK, UK), `comment` / `comentario` |
| Entity-relationship: relations (second table, optional) | `source`* / `origen`, `source_cardinality`* / `cardinalidad_origen`, `target`* / `destino`, `target_cardinality`* / `cardinalidad_destino` (`1`, `0..1`, `0..n`, `1..n`), `label` / `etiqueta` |
| Gantt | `task`* / `tarea`, `start` / `inicio` (YYYY-MM-DD) or `after` / `despues` (ids), `end` / `fin` or `duration` / `duracion` (`3d`, `2w`, `4h`), `section` / `seccion`, `id`, `status` / `estado` (done, active, crit, milestone) |
| Sequence | `from`* / `de`, `to`* / `para`, `message`* / `mensaje`, `type` / `tipo` (call, async, reply) |

```csv
source,target,label
Start,Validate,
Validate,Save,"valid, complete"
```

```csv
entity,attribute,type,key
Customer,id,int,PK
Order,customer_id,int,FK
```

```csv
section,task,id,start,duration,after
Design,Sketch,a1,2026-12-01,3d,
Design,Review,a2,,2d,a1
```

```markdown
| from | to | message |
|------|----|---------|
| Web | API | POST /orders |
```

**Escaping.** Names never become identifiers: nodes, entities and participants get generated ids. How a character can be written depends on the diagram:

- sequence diagrams use entity codes (`#35;`);
- flowcharts and entity-relationship diagrams show entity codes literally, so an invisible zero-width space (U+200B) is added after characters that would be read as syntax. **The generated code contains those invisible characters**: searching it for the exact text may not match;
- what cannot be written either way becomes a look-alike (for example `"` as `＂` in flowcharts, `:` as `꞉` in Gantt tasks) and the app lists each replacement with its line. In flowcharts this includes `>`. Attribute names and types of entities must be identifiers: other characters become `_`.

`e2e/mermaid.spec.ts` draws hostile texts with every free-text field and compares the drawing with the table.

## Development

Requires Node.js 22.12 or newer.

```bash
cd web
npm ci
npm run dev                 # no Content-Security-Policy: the dev server needs a WebSocket
npm run typecheck
npm test                    # unit tests
npm run build && npm run test:build     # network scan, policies and size budgets
npx playwright install chromium firefox webkit   # once; on Linux add --with-deps (needs sudo)
npm run test:e2e            # runs against the built site
```

```
src/core/       conversions, type generators, regex, JWT and diagram code: pure functions without DOM
src/ui/         Preact components of index.html, and what both pages share
src/mermaid/    the Mermaid page: drawing, SVG cleaning, export, its components and texts
src/i18n.ts     Spanish and English texts
csp.ts          the Content-Security-Policy of each page
scripts/network-scan.ts   what the build may not contain, and the reviewed exceptions
```

## Privacy

The requirement: nothing typed leaves the browser.

| Layer | Guarantee | Test |
|---|---|---|
| Content-Security-Policy | `connect-src 'none'`; only the site's own script and style (see below for `mermaid.html`); workers only from `blob:`, none on `mermaid.html`; no forms | `e2e/privacy.spec.ts`, `e2e/mermaid-privacy.spec.ts`: every way of connecting fails |
| Build scan | No network or `eval` code, nor external URLs, outside the reviewed list of each page | `test/build/build.test.ts` |
| Behaviour | No request after loading, whatever is typed, including diagrams that try to | the same two files |
| No traces | Input is not stored or put in the URL; only the language and theme are saved | the same two files |

Text fields have spell checking off, since some browsers send the text to an online service to check it. Each page is one script and one style sheet, so it keeps working without a connection once loaded.

### The policy of `mermaid.html`

It differs from the other page in `style-src 'self' 'unsafe-inline'` (and allows no worker). Mermaid writes `<style>` elements and style attributes while it draws, from what you type, so hashes cannot list them; a nonce in a static site is public; and neither covers style attributes well. Scripts stay `'self'`, without `unsafe-eval`: `e2e/mermaid-types.spec.ts` draws every diagram type that Mermaid registers under that policy.

**What risk is left:**

- If Mermaid's cleaning failed, CSS could be injected while a diagram is drawn and change how the page looks, for example hiding a warning. Sending data out through CSS stays blocked: no pictures or fonts from other sites are allowed.
- Some diagram types put your text into the page as HTML while drawing. The policy is what stops a script or a picture there.
- The policy does not stop navigation, which is why links are removed and the diagram is shown as a picture.
- A downloaded SVG opened elsewhere no longer has this policy: only the cleaning protects it.

**Reviewed lists.** `scripts/network-scan.ts` explains each exception: which code it is, from which library, why it cannot reach the network and which test shows it. `index.html` has five: three XML namespace names in Preact and the two ways Vite's loader can start the inline worker. `mermaid.html` has 32 web addresses (namespace names and links in error messages), each with its exact number of uses, and eleven pieces of code (parser positions, `window.open` in Mermaid's click handler, picture and link elements, `@import`, and lodash's `Function("return this")` fallback). A new finding, or any different number, fails the build tests: **updating Mermaid means reviewing the list again**.

**Dependency choice.** CSV uses `csv-parse` and `csv-stringify`, not `papaparse`: `papaparse` ships code that downloads files with `XMLHttpRequest` and code that builds functions from text, and the bundler cannot remove them. The cost is about 16 KB more (gzip). `csv-parse` also rejects unclosed quotes and uneven rows.

**Limits.** The policy does not stop navigation to another address, so only the tests cover that. The scan is a text search and cannot see disguised names. Nothing here protects against browser extensions or a compromised computer. A hosting provider logs the requests for the page itself (never what you type).

## Accessibility

Target: WCAG 2.1 AA. `e2e/accessibility.spec.ts` and `e2e/mermaid-accessibility.spec.ts` run axe on every tool in both themes and check the keyboard (ARIA tabs, no focus trap, visible focus). Matches are underlined and numbered, not only coloured.

A diagram's text alternative is its `accTitle` and `accDescr`; without them, the rows of the table it came from, or the texts drawn. The same list is under *Text description*. It does not describe the shape of a hand-written diagram: add `accDescr` for that. The diagram is always drawn on white, in both themes, like the exported file.

Automated checks do not cover everything. **Not verified with a screen reader.** Manual review before publishing:

- [ ] With a screen reader: tabs, labels, errors, warnings and the match count are announced and make sense
- [ ] At 200 % and 400 % zoom nothing is cut off or needs scrolling in two directions, except tables
- [ ] The whole app can be used with the keyboard in Safari
- [ ] A diagram's text alternative and its errors are understandable when read aloud
- [ ] Download SVG and PNG in a real Safari
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
