import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/commands/check.js";
import { runInit } from "../../src/commands/init.js";
import { captureConsole, tmpDir } from "../helpers.js";
import { accept, commit, edit, git, gitProject, newAdr, read, TODAY, write } from "./helpers.js";

const errorsOf = (dir: string, strict = false) => runCheck("es", { cwd: dir, strict }).errors.map((f) => `${f.file}:${f.line} [${f.rule}]`);
const warningsOf = (dir: string) => runCheck("es", { cwd: dir }).warnings.map((f) => f.rule);
const find = (dir: string, rule: string) => runCheck("es", { cwd: dir }).errors.find((f) => f.rule === rule);

/** A project with ADR-0001 accepted and committed. */
function withAcceptedAdr(): { dir: string; adr: string } {
  const dir = gitProject();
  const adr = newAdr(dir, "Usar PostgreSQL");
  commit(dir, "add adr");
  accept(dir, "ADR-0001");
  commit(dir, "accept adr");
  return { dir, adr };
}

describe("a fresh project", () => {
  it("passes check right after init (owner set), committed or not", () => {
    const dir = gitProject();
    const result = runCheck("es", { cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("adr-immutable", () => {
  it("accepts a clean accepted ADR", () => {
    const { dir } = withAcceptedAdr();
    expect(errorsOf(dir)).toEqual([]);
  });

  it("rejects editing the body after acceptance, with file, line and commits", () => {
    const { dir, adr } = withAcceptedAdr();
    edit(dir, adr, "## Decisión\n", "## Decisión\n\nCambié de opinión.\n");
    commit(dir, "edit accepted adr");
    const f = find(dir, "adr-immutable")!;
    expect(f.file).toBe(adr);
    expect(f.line).toBe(read(dir, adr).split("\n").findIndex((l) => l.includes("Cambié de opinión")) + 1);
    expect(f.message).toMatch(/body changed/);
    expect(f.message).toMatch(/accepted in [0-9a-f]{7}, changed in [0-9a-f]{7}/);
  });

  it("rejects changing date, owner or id after acceptance", () => {
    for (const [from, to, label] of [
      [/date: .*/, "date: 2030-01-01", "date"],
      [/owner: .*/, "owner: Someone Else", "owner"],
    ] as const) {
      const { dir, adr } = withAcceptedAdr();
      edit(dir, adr, from, to);
      commit(dir, `change ${label}`);
      expect(find(dir, "adr-immutable")?.message, label).toContain(`"${label}" changed`);
    }
  });

  it("rejects reverting an accepted ADR to proposed", () => {
    const { dir, adr } = withAcceptedAdr();
    edit(dir, adr, "status: accepted", "status: proposed");
    commit(dir, "reopen");
    expect(find(dir, "adr-immutable")?.message).toMatch(/can only become superseded/);
  });

  it("allows only status -> superseded and superseded_by (new ADR with --supersedes)", () => {
    const { dir, adr } = withAcceptedAdr();
    newAdr(dir, "Usar MySQL", { supersedes: "ADR-0001" });
    commit(dir, "supersede");
    expect(errorsOf(dir)).toEqual([]);
    const old = read(dir, adr);
    expect(old).toContain("status: superseded");
    expect(old).toContain("superseded_by: ADR-0002");
    expect(old).toContain(`date: ${TODAY}`);
    expect(read(dir, "docs/adr/0002-usar-mysql.md")).toContain("supersedes: ADR-0001");
  });

  it("catches an edit that is reverted in a later commit", () => {
    const { dir, adr } = withAcceptedAdr();
    const original = read(dir, adr);
    write(dir, adr, original + "\nExtra.\n");
    commit(dir, "edit");
    write(dir, adr, original);
    commit(dir, "revert");
    expect(errorsOf(dir)).toEqual([expect.stringContaining("[adr-immutable]")]);
  });

  it("checks the working tree before committing", () => {
    const { dir, adr } = withAcceptedAdr();
    write(dir, adr, read(dir, adr) + "\nUncommitted edit.\n");
    expect(find(dir, "adr-immutable")?.message).toMatch(/changed in working tree/);
  });

  it("warns (does not fail) when the acceptance is not committed yet, and fails with --strict", () => {
    const dir = gitProject();
    newAdr(dir, "Usar PostgreSQL");
    commit(dir, "add adr");
    accept(dir, "ADR-0001");
    expect(errorsOf(dir)).toEqual([]);
    expect(warningsOf(dir)).toContain("adr-immutable");
    expect(errorsOf(dir, true)).toEqual([expect.stringContaining("[adr-immutable]")]);
  });

  it("treats an ADR committed as accepted from the start as the reference", () => {
    const dir = gitProject();
    const adr = newAdr(dir, "Heredada");
    edit(dir, adr, "status: proposed", "status: accepted");
    commit(dir, "import accepted");
    expect(errorsOf(dir)).toEqual([]);
    edit(dir, adr, "## Contexto", "## Contexto\n\nNuevo.");
    commit(dir, "edit");
    expect(find(dir, "adr-immutable")).toBeDefined();
  });

  it("follows a rename of the ADR file", () => {
    const { dir, adr } = withAcceptedAdr();
    git(dir, "mv", adr, "docs/adr/0001-postgres.md");
    commit(dir, "rename");
    expect(errorsOf(dir).filter((e) => e.includes("adr-immutable"))).toEqual([]);
    write(dir, "docs/adr/0001-postgres.md", read(dir, "docs/adr/0001-postgres.md") + "\nExtra.\n");
    commit(dir, "edit after rename");
    expect(find(dir, "adr-immutable")?.file).toBe("docs/adr/0001-postgres.md");
  });

  it("does not restrict a proposed ADR", () => {
    const dir = gitProject();
    const adr = newAdr(dir, "Borrador");
    commit(dir, "add");
    edit(dir, adr, "## Contexto", "## Contexto\n\nEditado libremente.");
    commit(dir, "edit");
    expect(errorsOf(dir)).toEqual([]);
  });
});

describe("log-append-only", () => {
  const entry = "\n## 2026-03-09\n\n### Verificado\n- Uno.\n\n### No verificado\n- Dos.\n";

  it("accepts appended entries (also uncommitted)", () => {
    const dir = gitProject();
    write(dir, "BITACORA.md", read(dir, "BITACORA.md") + entry);
    commit(dir, "entry 1");
    write(dir, "BITACORA.md", read(dir, "BITACORA.md") + entry.replace("2026-03-09", "2026-03-10"));
    expect(errorsOf(dir)).toEqual([]);
  });

  it("rejects an edited line, reporting its line number and commits", () => {
    const dir = gitProject();
    write(dir, "BITACORA.md", read(dir, "BITACORA.md") + entry);
    commit(dir, "entry");
    const before = read(dir, "BITACORA.md");
    edit(dir, "BITACORA.md", "- Uno.", "- Uno, corregido.");
    const line = before.split("\n").findIndex((l) => l === "- Uno.") + 1;
    const f = find(dir, "log-append-only")!;
    expect(f.line).toBe(line);
    expect(f.message).toMatch(/was edited/);
    commit(dir, "edit");
    expect(find(dir, "log-append-only")?.line).toBe(line);
  });

  it("rejects removed lines", () => {
    const dir = gitProject();
    write(dir, "BITACORA.md", read(dir, "BITACORA.md") + entry);
    commit(dir, "entry");
    write(dir, "BITACORA.md", read(dir, "BITACORA.md").replace("\n### No verificado\n- Dos.\n", ""));
    commit(dir, "delete lines");
    expect(find(dir, "log-append-only")?.message).toMatch(/removed|edited/);
  });

  it("does not complain about a log that was never committed", () => {
    const dir = tmpDir();
    git(dir, "init", "-q", "-b", "main");
    captureConsole(() => runInit("es", { cwd: dir, owner: "Jane Doe", today: TODAY }));
    write(dir, "BITACORA.md", read(dir, "BITACORA.md") + "\n## 2026-03-09\n\n### Verificado\n- Algo.\n");
    expect(errorsOf(dir)).toEqual([]);
  });
});

describe("adr-deleted", () => {
  it("warns about an ADR file deleted from the ADR folder", () => {
    const { dir, adr } = withAcceptedAdr();
    git(dir, "rm", "-q", adr);
    commit(dir, "delete adr");
    const result = runCheck("es", { cwd: dir });
    const w = result.warnings.find((x) => x.rule === "adr-deleted")!;
    expect(w.file).toBe(adr);
    expect(w.message).toMatch(/deleted in commit [0-9a-f]{7}/);
    expect(w.message).toContain("accepted");
    expect(result.ok).toBe(true);
  });

  it("does not warn about a rename inside the folder or a deleted template", () => {
    const { dir, adr } = withAcceptedAdr();
    git(dir, "mv", adr, "docs/adr/0001-otro-nombre.md");
    commit(dir, "rename");
    expect(warningsOf(dir)).not.toContain("adr-deleted");
  });

  it("becomes an error with --strict", () => {
    const { dir, adr } = withAcceptedAdr();
    git(dir, "rm", "-q", adr);
    commit(dir, "delete adr");
    expect(errorsOf(dir, true).some((e) => e.includes("[adr-deleted]"))).toBe(true);
  });
});

describe("no usable history", () => {
  it("warns when the folder is not a git repository, and --strict fails", () => {
    const dir = tmpDir();
    fs.cpSync(path.join(import.meta.dirname, "..", "fixtures", "check", "base"), dir, { recursive: true });
    expect(warningsOf(dir)).toEqual(["git-history"]);
    expect(errorsOf(dir, true)).toEqual([expect.stringContaining("[git-history]")]);
  });

  it("warns on a shallow clone", () => {
    const { dir } = withAcceptedAdr();
    write(dir, "docs/glosario.md", read(dir, "docs/glosario.md") + "\n");
    commit(dir, "another commit so that depth 1 is shallow");
    const clone = tmpDir();
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${dir}`, clone], { stdio: "ignore" });
    const result = runCheck("es", { cwd: clone });
    const w = result.warnings.find((x) => x.rule === "git-history");
    expect(w?.message).toMatch(/Shallow clone/);
    expect(w?.message).toMatch(/fetch-depth: 0/);
  });

  it("warns for an uncommitted repository without failing", () => {
    const dir = tmpDir();
    git(dir, "init", "-q", "-b", "main");
    fs.cpSync(path.join(import.meta.dirname, "..", "fixtures", "check", "base"), dir, { recursive: true });
    const result = runCheck("es", { cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toContain("adr-immutable");
  });
});

describe("index-stale", () => {
  it("warns when an ADR is added without regenerating the index", () => {
    const dir = gitProject();
    newAdr(dir, "Uno"); // regenerates the index automatically
    expect(warningsOf(dir)).not.toContain("index-stale");
    write(dir, "docs/adr/0002-dos.md", read(dir, "docs/adr/0001-uno.md").replace("ADR-0001", "ADR-0002"));
    expect(warningsOf(dir)).toContain("index-stale");
  });
});
