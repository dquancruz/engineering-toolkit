import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAdrAccept } from "../../src/commands/adr.js";
import { runInit } from "../../src/commands/init.js";
import { runNewAdr } from "../../src/commands/new.js";
import { parseFrontmatter } from "../../src/docs/frontmatter.js";
import { captureConsole, tmpDir } from "../helpers.js";
import { accept, edit, newAdr, read, TODAY } from "./helpers.js";

const project = () => {
  const dir = tmpDir();
  captureConsole(() => runInit("es", { cwd: dir, owner: "Jane Doe", today: TODAY }));
  return dir;
};

describe("engkit adr accept", () => {
  it("moves proposed -> accepted, sets the date and refreshes the index", () => {
    const dir = project();
    const adr = newAdr(dir, "Usar PostgreSQL");
    accept(dir, "ADR-0001", "2026-04-02");
    const fm = parseFrontmatter(read(dir, adr))!.data;
    expect(fm).toMatchObject({ id: "ADR-0001", status: "accepted", date: "2026-04-02", owner: "Jane Doe" });
    expect(read(dir, "docs/DECISIONES.md")).toMatch(/\| accepted \| 2026-04-02 \|/);
  });

  it.each(["ADR-0001", "0001", "1", "adr-1"])("accepts the reference %s", (ref) => {
    const dir = project();
    newAdr(dir, "Uno");
    expect(() => accept(dir, ref)).not.toThrow();
  });

  it("changes only status and date", () => {
    const dir = project();
    const adr = newAdr(dir, "Uno");
    const before = read(dir, adr);
    accept(dir, "1", "2026-04-02");
    const diff = read(dir, adr).split("\n").filter((l, i) => l !== before.split("\n")[i]);
    expect(diff).toEqual(["status: accepted", "date: 2026-04-02"]);
  });

  it("rejects an owner that is TODO", () => {
    const dir = project();
    const adr = newAdr(dir, "Uno");
    edit(dir, adr, "owner: Jane Doe", "owner: TODO");
    expect(() => accept(dir, "1")).toThrow(/no owner/);
    expect(read(dir, adr)).toContain("status: proposed");
  });

  it("rejects an ADR that is not proposed, unknown IDs, the template and bad references", () => {
    const dir = project();
    newAdr(dir, "Uno");
    accept(dir, "1");
    expect(() => accept(dir, "1")).toThrow(/only a "proposed" ADR/);
    expect(() => accept(dir, "7")).toThrow(/ADR-0007 not found/);
    expect(() => accept(dir, "0")).toThrow(/template/);
    expect(() => accept(dir, "foo")).toThrow(/not an ADR ID/);
  });
});

describe("engkit new adr --supersedes", () => {
  const supersede = (dir: string, ref: string) =>
    captureConsole(() => runNewAdr("Nuevo", "es", { cwd: dir, owner: "Jane Doe", today: "2026-05-01", supersedes: ref }));

  it("creates the new ADR and marks the old one without touching its date or body", () => {
    const dir = project();
    const old = newAdr(dir, "Viejo");
    accept(dir, "1");
    const before = read(dir, old).split("\n");
    const created = supersede(dir, "ADR-0001").result;
    const after = read(dir, old).split("\n");
    expect(after.filter((l, i) => l !== before[i])).toEqual(["status: superseded", "superseded_by: ADR-0002"]);
    expect(parseFrontmatter(read(dir, old))!.data["date"]).toBe(TODAY);
    expect(parseFrontmatter(read(dir, created))!.data).toMatchObject({ id: "ADR-0002", status: "proposed", supersedes: "ADR-0001" });
    expect(read(dir, "docs/DECISIONES.md")).toMatch(/ADR-0002/);
  });

  it("only supersedes accepted ADRs and writes nothing otherwise", () => {
    const dir = project();
    newAdr(dir, "Borrador");
    expect(() => supersede(dir, "1")).toThrow(/only an "accepted" ADR/);
    expect(fs.readdirSync(path.join(dir, "docs/adr")).filter((f) => /^\d{4}-/.test(f) && !f.startsWith("0000"))).toHaveLength(1);
    expect(() => supersede(dir, "9")).toThrow(/not found/);
  });

  it("cannot supersede an ADR that is already superseded", () => {
    const dir = project();
    newAdr(dir, "Viejo");
    accept(dir, "1");
    supersede(dir, "1");
    expect(() => supersede(dir, "1")).toThrow(/"superseded"/);
  });
});
