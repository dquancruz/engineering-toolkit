import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PromptCancelled } from "../../src/prompt/asker.js";
import { FakeAsker, projectCopy, run } from "./helpers.js";

const fakeToken = "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5";

const goodAnswers = (extra: Record<string, string> = {}) => (o: { message: string; initialValue?: string }) => {
  const by: Record<string, string> = {
    Objetivo: "Agregar paginación a GET /orders",
    Contexto: "Los clientes v1 esperan un arreglo plano.",
    "Autonomía": "Detenerse y preguntar si cambia la API pública.",
    "Criterio de terminado": "GET /orders?page=2 devuelve 20 elementos",
    "Forma de la respuesta": "Un resumen corto",
    ...extra,
  };
  if (o.message in by) return by[o.message];
  if (o.message.startsWith("Límites")) return `${o.initialValue ?? ""}\nNo agregar dependencias`.trim();
  if (o.message.startsWith("Verificación")) return `${o.initialValue ?? ""}\n\`npm test\``.trim();
  if (o.message.startsWith("Other files")) return "src/orders/handler.ts";
  return undefined;
};

describe("engkit prompt (guided mode, fake terminal)", () => {
  it("walks through every element, offers project documents as paths and prints the prompt", async () => {
    const dir = projectCopy();
    const asker = new FakeAsker({
      select: () => "feature",
      multiselect: (o) => (o.message.startsWith("Project documents") ? ["@adr:ADR-0001", "@pending:P-01"] : undefined),
      confirm: (o) => (o.message.startsWith("Add \"follow") ? true : false),
      text: goodAnswers(),
    });
    const r = await run(dir, {}, { asker, isTTY: true });
    expect(r.code).toBe(0);

    // the project's accepted ADRs and open pending items were offered (and nothing else)
    const offered = asker.calls.find((c) => c.kind === "multiselect")!.options!;
    expect(offered.map((o) => o.value)).toEqual(["@adr:ADR-0001", "@pending:P-01"]);

    expect(r.out).toContain("- docs/adr/0001-usar-postgresql.md (ADR-0001: Usar PostgreSQL)");
    expect(r.out).toContain("- docs/pendientes.md:19 (P-01: Confirmar plazo de retención)");
    expect(r.out).toContain("- src/orders/handler.ts");
    expect(r.out).toContain("- Respeta las reglas y restricciones de CLAUDE.md.");
    expect(r.out).toContain("- No agregar dependencias");
    expect(r.out).toContain("- No cambiar la API pública sin preguntar"); // preset limit, pre-filled and kept
    expect(r.out).toContain("- `npm test`");
    expect(r.err).toBe(""); // nothing to warn about
  });

  it("shows each element's question, example and checks", async () => {
    const asker = new FakeAsker({ select: () => "none", text: goodAnswers() });
    await run(projectCopy(), {}, { asker, isTTY: true });
    const goalNote = asker.notes.find((n) => n.startsWith("Objetivo"))!;
    expect(goalNote).toContain("¿Qué quieres lograr, en una frase?");
    expect(goalNote).toContain("Example: Agregar paginación al endpoint");
    expect(goalNote).toContain("[ ] Es una sola frase y empieza con un verbo");
  });

  it("pre-fills the preset's limits and verification so they can be edited", async () => {
    const asker = new FakeAsker({ select: () => "bugfix", text: goodAnswers() });
    await run(projectCopy(), {}, { asker, isTTY: true });
    const limits = asker.calls.find((c) => c.kind === "text" && c.message.startsWith("Límites"))!;
    expect(String(limits.initialValue)).toContain("Cambiar lo mínimo necesario");
  });

  it("warns about CLAUDE.md having no rules yet and does not pre-select it", async () => {
    const asker = new FakeAsker({ select: () => "none", text: goodAnswers() });
    await run(projectCopy(), {}, { asker, isTTY: true });
    expect(asker.notes.some((n) => n.includes("has no rules yet"))).toBe(true);
    const claude = asker.calls.find((c) => c.kind === "confirm" && c.message.includes("CLAUDE.md"))!;
    expect(claude.initialValue).toBe(false);
  });

  it("asks to fix weak elements and applies the new answer", async () => {
    let goalAsks = 0;
    const asker = new FakeAsker({
      select: () => "none",
      text: (o) => {
        if (o.message === "Objetivo") return ++goalAsks === 1 ? "mejorar todo" : "Agregar paginación a GET /orders";
        return goodAnswers()(o);
      },
      confirm: (o) => o.message.startsWith("Edit the elements with warnings"),
      multiselect: (o) => (o.message === "Which ones?" ? ["goal"] : undefined),
    });
    const r = await run(projectCopy(), {}, { asker, isTTY: true });
    expect(goalAsks).toBe(2);
    expect(r.out).toContain("Agregar paginación a GET /orders");
    expect(r.out).not.toContain("mejorar todo");
    expect(asker.notes.some((n) => n.startsWith("Warnings") && n.includes("goal looks vague"))).toBe(true);
  });

  it("can be left with warnings (they never block)", async () => {
    const asker = new FakeAsker({ select: () => "none", text: (o) => (o.message === "Objetivo" ? "mejorar" : undefined), confirm: () => false });
    const r = await run(projectCopy(), {}, { asker, isTTY: true });
    expect(r.code).toBe(0);
    expect(r.out).toContain("mejorar");
    expect(r.err).toMatch(/warning/);
  });

  it("blocks a secret: shows it masked, lets the user fix it, never prints the secret", async () => {
    const asked: string[] = [];
    const asker = new FakeAsker({
      select: () => "none",
      text: (o) => {
        if (o.message === "Contexto") {
          asked.push(o.message);
          return asked.length === 1 ? `Token: ${fakeToken}` : "Sin secretos aquí";
        }
        return goodAnswers()(o);
      },
      confirm: (o) => o.message === "Edit the flagged elements?",
      multiselect: (o) => (o.message === "Which ones?" ? ["context"] : undefined),
    });
    const r = await run(projectCopy(), {}, { asker, isTTY: true });
    expect(r.code).toBe(0);
    const note = asker.notes.find((n) => n.startsWith("Possible secrets"))!;
    expect(note).toContain("ghp_***");
    expect(note).not.toContain(fakeToken);
    expect(r.out).not.toContain(fakeToken);
    expect(r.out).toContain("Sin secretos aquí");
  });

  it("exits 1 with nothing printed when the user does not remove the secret", async () => {
    const asker = new FakeAsker({
      select: () => "none",
      text: (o) => (o.message === "Contexto" ? `Token: ${fakeToken}` : goodAnswers()(o)),
      confirm: () => false,
    });
    const r = await run(projectCopy(), {}, { asker, isTTY: true });
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/Blocked/);
    expect(r.err).not.toContain(fakeToken);
  });

  it("asks whether to save, and saves answers that --from can reuse", async () => {
    const dir = projectCopy();
    const asker = new FakeAsker({
      select: () => "none",
      text: goodAnswers(),
      confirm: (o) => o.message.startsWith("Save the prompt"),
    });
    const r = await run(dir, {}, { asker, isTTY: true, today: "2026-03-09" });
    expect(r.err).toMatch(/saved {4}prompts\/2026-03-09-agregar-paginacion-a-get-orders\.md/);
    const again = await run(dir, { from: path.join(dir, "prompts/2026-03-09-agregar-paginacion-a-get-orders.yaml") });
    expect(again.out).toBe(r.out);
  });

  it("does not ask to save when --save was given", async () => {
    const dir = projectCopy();
    const asker = new FakeAsker({ select: () => "none", text: goodAnswers() });
    await run(dir, { save: "x" }, { asker, isTTY: true, today: "2026-03-09" });
    expect(asker.calls.some((c) => c.message.startsWith("Save the prompt"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "prompts/2026-03-09-x.md"))).toBe(true);
  });

  it("exits 130 when the user cancels", async () => {
    const asker = new FakeAsker({
      select: () => {
        throw new PromptCancelled();
      },
    });
    const r = await run(projectCopy(), {}, { asker, isTTY: true });
    expect(r.code).toBe(130);
    expect(r.err).toMatch(/Cancelled/);
    expect(r.out).toBe("");
  });

  it("works outside a project: no project documents are offered", async () => {
    const { tmpDir } = await import("../helpers.js");
    const asker = new FakeAsker({ select: () => "none", text: goodAnswers() });
    const r = await run(tmpDir(), {}, { asker, isTTY: true }, "en");
    expect(asker.calls.some((c) => c.kind === "multiselect")).toBe(false);
    expect(r.code).toBe(0);
  });

  it("always ends: a user who keeps choosing to edit gets at most a fixed number of review rounds", async () => {
    const asker = new FakeAsker({
      select: () => "none",
      text: (o) => (o.message === "Objetivo" ? "mejorar" : goodAnswers()(o)),
      confirm: (o) => o.message.startsWith("Edit the elements with warnings"),
      multiselect: (o) => (o.message === "Which ones?" ? ["goal"] : undefined),
    });
    const r = await run(projectCopy(), {}, { asker, isTTY: true });
    expect(r.code).toBe(0);
    expect(asker.calls.filter((c) => c.kind === "text" && c.message === "Objetivo").length).toBeLessThanOrEqual(12);
  });
});
