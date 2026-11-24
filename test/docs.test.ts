import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIndex } from "../src/commands/index-cmd.js";
import { runInit } from "../src/commands/init.js";
import { runNewAdr, runNewPending } from "../src/commands/new.js";
import { loadConfig } from "../src/config.js";
import { extractTitle, nextAdrNumber, slugify } from "../src/docs/adr.js";
import { DEFAULT_PATHS, TEMPLATE_DOCS } from "../src/docs/files.js";
import { parseFrontmatter, setFrontmatterField } from "../src/docs/frontmatter.js";
import { formatPendingId, nextPendingNumber } from "../src/docs/pending.js";
import { LANGS, readTemplate } from "../src/i18n/index.js";
import { render } from "../src/docs/render.js";
import { captureConsole, tmpDir } from "./helpers.js";

const TODAY = "2026-03-09";
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf-8");
// owner: undefined -> "Jane Doe"; null -> no --owner flag (falls back to git config, then TODO)
const init = (dir: string, lang: "es" | "en" = "es", owner: string | null = "Jane Doe") =>
  captureConsole(() => runInit(lang, { cwd: dir, owner: owner ?? undefined, today: TODAY })).result;

let dir: string;
beforeEach(() => {
  dir = tmpDir();
});

describe("frontmatter helpers", () => {
  it("parses and edits fields without touching the rest", () => {
    const text = "---\nid: A\nstatus: proposed\n---\n\n# Body\n";
    expect(parseFrontmatter(text)?.data).toEqual({ id: "A", status: "proposed" });
    expect(setFrontmatterField(text, "status", "accepted")).toBe("---\nid: A\nstatus: accepted\n---\n\n# Body\n");
  });

  it("adds missing fields, blanks empty ones and quotes risky values", () => {
    const text = "---\nid: A\n---\nbody\n";
    expect(setFrontmatterField(text, "owner", "Ana: Pérez")).toContain('owner: "Ana: Pérez"');
    expect(setFrontmatterField("---\nid: A\nsupersedes: ADR-0001\n---\n", "supersedes", "")).toContain("supersedes:\n");
  });

  it("returns null without frontmatter", () => {
    expect(parseFrontmatter("# no frontmatter")).toBeNull();
  });
});

describe("slugify", () => {
  it("makes kebab-case without accents or symbols", () => {
    expect(slugify("Usar Ñandú: ¡decisión rápida!")).toBe("usar-nandu-decision-rapida");
    expect(slugify("  --  ")).toBe("");
  });
  it("extracts the title without the ADR prefix", () => {
    expect(extractTitle("# ADR-0007: Use Postgres\n")).toBe("Use Postgres");
  });
});

describe("templates", () => {
  const files = [...TEMPLATE_DOCS.map((d) => d.template)];
  const vars = {
    date: TODAY, owner: "X", owner_yaml: "X", decisions_link: "d", log_link: "l",
    glossary_link: "g", pending_link: "p", design_link: "s", claude_link: "c", agents_link: "a",
  };

  it("exist in es and en and render with valid frontmatter", () => {
    for (const lang of LANGS) {
      for (const f of files) {
        const parsed = parseFrontmatter(render(readTemplate(lang, f), vars));
        expect(parsed, `${lang}/${f}`).not.toBeNull();
        expect(parsed?.data["id"], `${lang}/${f}`).toBeTruthy();
      }
    }
  });

  it("use the same frontmatter keys and values in es and en", () => {
    for (const f of files) {
      const es = parseFrontmatter(render(readTemplate("es", f), vars))!.data;
      const en = parseFrontmatter(render(readTemplate("en", f), vars))!.data;
      expect(es, f).toEqual(en);
    }
  });

  it("only use the allowed English keys", () => {
    const allowed = new Set(["id", "status", "date", "owner", "source", "supersedes", "superseded_by"]);
    for (const lang of LANGS) {
      for (const f of files) {
        for (const key of Object.keys(parseFrontmatter(render(readTemplate(lang, f), vars))!.data)) {
          expect(allowed.has(key), `${lang}/${f}: ${key}`).toBe(true);
        }
      }
    }
  });

  it("ship the log with no entries, only the title and an HTML comment", () => {
    for (const lang of LANGS) {
      const body = parseFrontmatter(render(readTemplate(lang, "log.md"), vars))!.body;
      const withoutComment = body.replace(/<!--[\s\S]*?-->/g, "").trim();
      expect(withoutComment, lang).toMatch(/^# \S+$/);
      expect(body, lang).not.toMatch(/Nada por ahora|Nothing for now|\(ninguno\)|\(none\)/);
      expect(body, lang).not.toContain(TODAY);
    }
  });

  it("keep the log free of a frontmatter date (append-only)", () => {
    for (const lang of LANGS) {
      const fm = parseFrontmatter(render(readTemplate(lang, "log.md"), vars))!.data;
      expect(Object.keys(fm).sort()).toEqual(["id", "owner"]);
    }
  });
});

describe("engkit init", () => {
  it.each(LANGS)("creates every document and stores the paths (%s)", (lang) => {
    const result = init(dir, lang);
    const paths = DEFAULT_PATHS[lang];
    expect(result.skipped).toEqual([]);
    for (const key of ["adrTemplate", "log", "claude", "agents", "glossary", "pending", "design", "decisions"] as const) {
      expect(fs.existsSync(path.join(dir, paths[key])), paths[key]).toBe(true);
    }
    const config = loadConfig(dir);
    expect(config.lang).toBe(lang);
    expect(config.paths).toEqual(paths);
  });

  it("fills in owner and date", () => {
    init(dir, "es", "Jane Doe");
    const adr = parseFrontmatter(read(dir, "docs/adr/0000-plantilla.md"))!.data;
    expect(adr).toMatchObject({ id: "ADR-0000", status: "proposed", date: TODAY, owner: "Jane Doe" });
    expect(parseFrontmatter(read(dir, "BITACORA.md"))!.data).toEqual({ id: "LOG", owner: "Jane Doe" });
    expect(read(dir, "docs/diseno-vigente.md")).toContain(`Estado al ${TODAY}`);
  });

  it("uses TODO when there is no owner", () => {
    const saved = { g: process.env["GIT_CONFIG_GLOBAL"], n: process.env["GIT_CONFIG_NOSYSTEM"] };
    process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    try {
      init(dir, "es", null);
    } finally {
      if (saved.g === undefined) delete process.env["GIT_CONFIG_GLOBAL"]; else process.env["GIT_CONFIG_GLOBAL"] = saved.g;
      if (saved.n === undefined) delete process.env["GIT_CONFIG_NOSYSTEM"]; else process.env["GIT_CONFIG_NOSYSTEM"] = saved.n;
    }
    expect(parseFrontmatter(read(dir, "docs/glosario.md"))!.data["owner"]).toBe("TODO");
  });

  it("does not overwrite existing files and reports them", () => {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "mine\n");
    const result = init(dir);
    expect(read(dir, "CLAUDE.md")).toBe("mine\n");
    expect(result.skipped).toContain("CLAUDE.md");
    expect(result.created).not.toContain("CLAUDE.md");
    // a second run skips everything
    const again = init(dir);
    expect(again.created).toEqual([]);
    expect(again.skipped.length).toBe(TEMPLATE_DOCS.length + 1);
  });

  it("keeps the stored language and unknown keys, and honors custom paths", () => {
    fs.writeFileSync(
      path.join(dir, ".engkit.json"),
      JSON.stringify({ lang: "en", custom: 1, paths: { log: "notes/JOURNAL.md" } })
    );
    init(dir, "es");
    const raw = JSON.parse(read(dir, ".engkit.json")) as Record<string, unknown>;
    expect(raw["lang"]).toBe("en");
    expect(raw["custom"]).toBe(1);
    expect(fs.existsSync(path.join(dir, "notes/JOURNAL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "BITACORA.md"))).toBe(false);
  });

  it("links documents relative to their location", () => {
    init(dir, "es");
    expect(read(dir, "CLAUDE.md")).toContain("(docs/DECISIONES.md)");
    expect(read(dir, "docs/diseno-vigente.md")).toContain("(DECISIONES.md)");
  });
});

describe("engkit new adr", () => {
  it("numbers after the template and the existing ADRs", () => {
    init(dir);
    const first = captureConsole(() => runNewAdr("Usar PostgreSQL", "es", { cwd: dir, owner: "Jane Doe", today: TODAY })).result;
    expect(first).toBe("docs/adr/0001-usar-postgresql.md");
    fs.writeFileSync(path.join(dir, "docs/adr/0006-x.md"), "---\nid: ADR-0006\n---\n");
    const next = captureConsole(() => runNewAdr("Siguiente", "es", { cwd: dir, today: TODAY })).result;
    expect(next).toBe("docs/adr/0007-siguiente.md");
    const fm = parseFrontmatter(read(dir, next))!;
    expect(fm.data).toMatchObject({ id: "ADR-0007", status: "proposed", date: TODAY });
    expect(fm.data["supersedes"]).toBeNull();
    expect(read(dir, next)).toContain("# ADR-0007: Siguiente");
  });

  it("reads the directory from .engkit.json, not from the language", () => {
    init(dir, "en");
    const cfg = JSON.parse(read(dir, ".engkit.json")) as { paths: Record<string, string> };
    cfg.paths["adrDir"] = "decisions";
    fs.writeFileSync(path.join(dir, ".engkit.json"), JSON.stringify(cfg));
    const file = captureConsole(() => runNewAdr("Other place", "es", { cwd: dir, today: TODAY })).result;
    expect(file).toBe("decisions/0001-other-place.md");
  });

  it("starts from the project's template when it exists and falls back otherwise", () => {
    init(dir, "en");
    fs.appendFileSync(path.join(dir, "docs/adr/0000-template.md"), "\n## Extra section\n");
    const withTemplate = captureConsole(() => runNewAdr("A", "en", { cwd: dir, today: TODAY })).result;
    expect(read(dir, withTemplate)).toContain("## Extra section");
    fs.rmSync(path.join(dir, "docs/adr/0000-template.md"));
    const fallback = captureConsole(() => runNewAdr("B", "en", { cwd: dir, today: TODAY })).result;
    expect(fallback).toBe("docs/adr/0002-b.md");
  });

  it("fails clearly without init or with an empty title", () => {
    expect(() => runNewAdr("x", "es", { cwd: dir })).toThrow(/engkit init/);
    init(dir);
    expect(() => runNewAdr("¡¡!!", "es", { cwd: dir })).toThrow(/letters or numbers/);
  });

  it("counts from 1 when the directory is empty", () => {
    expect(nextAdrNumber(path.join(dir, "missing"))).toBe(1);
  });
});

describe("engkit new pendiente", () => {
  it("adds P-01 and P-02 and refreshes the dates", () => {
    init(dir);
    const id1 = captureConsole(() => runNewPending("Confirmar plazo", "es", { cwd: dir, owner: "Jane Doe", today: "2026-04-01", type: "review" })).result;
    const id2 = captureConsole(() => runNewPending(undefined, "es", { cwd: dir, owner: "Jane Doe", today: "2026-04-02" })).result;
    expect([id1, id2]).toEqual(["P-01", "P-02"]);
    const text = read(dir, "docs/pendientes.md");
    expect(text).toContain("### P-01: Confirmar plazo");
    expect(text).toContain("- type: review\n- status: open\n- owner: Jane Doe\n- date: 2026-04-01");
    expect(text).toContain("### P-02: TODO");
    expect(parseFrontmatter(text)!.data["date"]).toBe("2026-04-02");
    expect(text).toContain("Estado al 2026-04-02");
  });

  it("keeps numbering after P-99 (P-100, P-101)", () => {
    init(dir);
    const file = path.join(dir, "docs/pendientes.md");
    fs.appendFileSync(file, "\n### P-99: Last two-digit item\n");
    const id = captureConsole(() => runNewPending("Hundred", "es", { cwd: dir, owner: "Jane Doe", today: TODAY })).result;
    expect(id).toBe("P-100");
    const id2 = captureConsole(() => runNewPending("Next", "es", { cwd: dir, owner: "Jane Doe", today: TODAY })).result;
    expect(id2).toBe("P-101");
    expect(read(dir, "docs/pendientes.md")).toContain("### P-100: Hundred");
  });

  it("unit: id formatting and parsing", () => {
    expect(formatPendingId(7)).toBe("P-07");
    expect(formatPendingId(100)).toBe("P-100");
    expect(nextPendingNumber("### P-99\n### P-100\n### P-7\n")).toBe(101);
    expect(nextPendingNumber("nothing")).toBe(1);
  });

  it("uses the English body in en projects", () => {
    init(dir, "en");
    captureConsole(() => runNewPending("Check", "en", { cwd: dir, owner: "Jane Doe", today: TODAY }));
    expect(read(dir, "docs/pending.md")).toContain("describe the item");
  });
});

describe("engkit index", () => {
  const writeAdr = (name: string, front: string, title: string) =>
    fs.writeFileSync(path.join(dir, "docs/adr", name), `---\n${front}\n---\n\n# ${title}\n`);

  it("lists ADRs with status, date and supersession (both directions)", () => {
    init(dir, "en");
    writeAdr("0001-old.md", "id: ADR-0001\nstatus: accepted\ndate: 2026-01-01", "ADR-0001: Old | choice");
    writeAdr("0002-new.md", "id: ADR-0002\nstatus: accepted\ndate: 2026-02-01\nsupersedes: ADR-0001", "ADR-0002: New choice");
    captureConsole(() => runIndex("en", { cwd: dir, today: TODAY }));
    const text = read(dir, "docs/DECISIONS.md");
    expect(text).toContain("| [ADR-0001](adr/0001-old.md) | Old \\| choice | accepted | 2026-01-01 |  | ADR-0002 |");
    expect(text).toContain("| [ADR-0002](adr/0002-new.md) | New choice | accepted | 2026-02-01 | ADR-0001 |  |");
    expect(text).not.toContain("ADR-0000");
  });

  it("says it is generated, in both languages", () => {
    for (const lang of LANGS) {
      const d = tmpDir();
      init(d, lang);
      captureConsole(() => runIndex(lang, { cwd: d, today: TODAY }));
      const text = read(d, DEFAULT_PATHS[lang].decisions);
      expect(parseFrontmatter(text)!.data).toMatchObject({ id: "DECISIONS", generated: true });
      expect(text).toMatch(/engkit index/);
      expect(text.split("\n").slice(0, 10).join("\n")).toMatch(/generad|generated/i);
    }
  });

  it("is deterministic and warns about ADRs without frontmatter", () => {
    init(dir);
    fs.writeFileSync(path.join(dir, "docs/adr/0003-broken.md"), "# no frontmatter\n");
    const a = captureConsole(() => runIndex("es", { cwd: dir, today: TODAY }));
    const first = read(dir, "docs/DECISIONES.md");
    captureConsole(() => runIndex("es", { cwd: dir, today: TODAY }));
    expect(read(dir, "docs/DECISIONES.md")).toBe(first);
    expect(a.stderr).toContain("0003-broken.md");
  });
});
