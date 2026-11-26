import type { Project } from "../check/project.js";
import { relativeLink } from "../docs/files.js";
import { parseRegister } from "../docs/register.js";
import type { Lang } from "../i18n/index.js";
import { listField, type LegacyItem } from "../legacy/load.js";
import type { Slice } from "./load.js";
import { isRecord, text } from "./model.js";

export class TestPlanError extends Error {}

export interface PlanCase {
  id: string;
  file: string;
  title: string;
  status: string;
  rules: string[];
  expectedSource: string[];
}

export interface Criterion {
  text: string;
  verify: string | null;
}

export interface PlanSlice {
  id: string;
  file: string;
  title: string;
  status: string;
  order: number | null;
  cases: PlanCase[];
  done: Criterion[];
}

export interface TestPlan {
  slices: PlanSlice[];
  globalDone: Criterion[];
  requirements: { id: string; file: string; title: string; category: string; verify: string | null }[];
  counts: { file: string; target: string; command: string | null; results: string | null }[];
  handovers: { table: string; writer: string; slice: string | null; verify: string | null }[];
  gaps: {
    rulesWithoutTest: string[];
    rulesUnplanned: string[];
    slicesWithoutTest: string[];
    requirementsWithoutVerify: string[];
    criteriaWithoutVerify: string[];
  };
}

const criteria = (value: unknown): Criterion[] =>
  Array.isArray(value)
    ? value.filter(isRecord).map((c) => ({ text: text(c["text"]) ?? "TODO", verify: text(c["verify"]) }))
    : [];

/** The cases of the project: tests and done criteria by slice, requirements, counts, handovers and gaps. */
export function buildTestPlan(project: Project, only?: string): TestPlan {
  const { legacy, rebuild } = project;
  if (!legacy || !rebuild) throw new TestPlanError('The project has no "rebuild" section. Run "engkit init --profile rebuild" first.');
  if (only && !rebuild.slices.some((s) => s.id === only)) throw new TestPlanError(`Slice ${only} does not exist.`);

  const tests = new Map(legacy.items.test.map((t) => [t.id, t]));
  const planCase = (t: LegacyItem): PlanCase => ({
    id: t.id,
    file: t.file,
    title: t.title,
    status: String(t.fm?.data["status"] ?? "?"),
    rules: listField(t, "rules") ?? [],
    expectedSource: listField(t, "expected_source") ?? [],
  });
  const planSlice = (s: Slice): PlanSlice => ({
    id: s.id,
    file: s.file,
    title: s.title,
    status: String(s.fm?.data["status"] ?? "?"),
    order: typeof s.fm?.data["order"] === "number" ? s.fm.data["order"] : null,
    cases: (listField(s, "tests") ?? []).flatMap((id) => (tests.has(id) ? [planCase(tests.get(id)!)] : [])),
    done: criteria(s.fm?.data["done"]),
  });
  const slices = rebuild.slices
    .map(planSlice)
    .filter((s) => (only ? s.id === only : s.status !== "dropped"))
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.id < b.id ? -1 : 1));

  const doc = project.docs.find((d) => d.key === "requirements");
  const inScope = new Set(only ? rebuild.slices.filter((s) => s.id === only).flatMap((s) => listField(s, "requirements") ?? []) : []);
  const requirements = (doc ? parseRegister(doc.text, "RNF") : [])
    .filter((e) => e.fields["status"]?.value !== "not-applicable" && (!only || inScope.has(e.id)))
    .map((e) => ({ id: e.id, file: doc!.file, title: e.title, category: e.fields["category"]?.value ?? "?", verify: text(e.fields["verify"]?.value) }));

  const counts = only
    ? []
    : rebuild.data.map((d) => {
        const c = isRecord(d.fm?.data["counts"]) ? (d.fm!.data["counts"] as Record<string, unknown>) : {};
        return { file: d.file, target: text(d.fm?.data["target"]) ?? "?", command: text(c["command"]), results: text(c["results"]) };
      });

  const tables = rebuild.strangler?.fm?.data["tables"];
  const handovers = (Array.isArray(tables) ? tables.filter(isRecord) : [])
    .map((t) => ({
      table: text(t["table"]) ?? "?",
      writer: text(t["writer"]) ?? "?",
      slice: isRecord(t["handover"]) ? text(t["handover"]["slice"]) : null,
      verify: text(t["verify"]),
      order: typeof t["order"] === "number" ? t["order"] : Infinity,
    }))
    .filter((t) => !only || t.slice === only)
    .sort((a, b) => a.order - b.order || (a.table < b.table ? -1 : 1))
    .map(({ order: _order, ...t }) => t);

  const covered = new Set(legacy.items.test.flatMap((t) => listField(t, "rules") ?? []));
  const planned = new Set(rebuild.slices.filter((s) => s.fm?.data["status"] !== "dropped").flatMap((s) => listField(s, "rules") ?? []));
  const excluded = rebuild.plan?.fm?.data["excluded"];
  for (const e of Array.isArray(excluded) ? excluded.filter(isRecord) : []) if (text(e["reason"])) planned.add(text(e["rule"]) ?? "");
  const inForce = legacy.items.rule.filter((r) => ["confirmed", "modified"].includes(String(r.fm?.data["status"]))).map((r) => r.id);
  const globalDone = only ? [] : criteria(rebuild.plan?.fm?.data["done"]);

  return {
    slices,
    globalDone,
    requirements,
    counts,
    handovers,
    gaps: {
      rulesWithoutTest: only ? [] : inForce.filter((id) => !covered.has(id)),
      rulesUnplanned: only ? [] : inForce.filter((id) => !planned.has(id)),
      slicesWithoutTest: slices.filter((s) => s.cases.length === 0).map((s) => s.id),
      requirementsWithoutVerify: requirements.filter((r) => r.verify === null).map((r) => r.id),
      criteriaWithoutVerify: [
        ...slices.flatMap((s) => s.done.flatMap((c, i) => (c.verify ? [] : [`${s.id} #${i + 1}`]))),
        ...globalDone.flatMap((c, i) => (c.verify ? [] : [`plan #${i + 1}`])),
      ],
    },
  };
}

const TEXT = {
  es: {
    title: "Plan de pruebas",
    generated: "Archivo generado por `engkit testplan`. No lo edites: se sobrescribe. Enlaza las pruebas; su contenido vive en cada PA.",
    slices: "Rebanadas",
    noSlices: "Todavía no hay rebanadas.",
    cases: ["PA", "Título", "Reglas", "Origen del esperado", "Estado"],
    noCases: "Sin pruebas de aceptación.",
    done: "Criterios de terminado",
    doneCols: ["Criterio", "Verificación"],
    global: "Criterios de terminado del plan",
    requirements: "Requisitos no funcionales",
    reqCols: ["ID", "Título", "Categoría", "Verificación"],
    counts: "Conteos de datos",
    countCols: ["Tabla destino", "Comando", "Resultados"],
    handovers: "Traspasos de escritura",
    handoverCols: ["Tabla", "Escritor actual", "Rebanada", "Verificación"],
    gaps: "Huecos",
    noGaps: "Ninguno detectado.",
    gapNames: {
      rulesWithoutTest: "Reglas sin prueba",
      rulesUnplanned: "Reglas sin rebanada",
      slicesWithoutTest: "Rebanadas sin prueba",
      requirementsWithoutVerify: "Requisitos sin verificación",
      criteriaWithoutVerify: "Criterios sin verificación",
    },
    missing: "**falta**",
  },
  en: {
    title: "Test plan",
    generated: "File generated by `engkit testplan`. Do not edit it: it is overwritten. It links the tests; their content lives in each PA.",
    slices: "Slices",
    noSlices: "There are no slices yet.",
    cases: ["PA", "Title", "Rules", "Expected source", "Status"],
    noCases: "No acceptance tests.",
    done: "Done criteria",
    doneCols: ["Criterion", "Verification"],
    global: "Done criteria of the plan",
    requirements: "Non-functional requirements",
    reqCols: ["ID", "Title", "Category", "Verification"],
    counts: "Data counts",
    countCols: ["Target table", "Command", "Results"],
    handovers: "Write handovers",
    handoverCols: ["Table", "Current writer", "Slice", "Verification"],
    gaps: "Gaps",
    noGaps: "None found.",
    gapNames: {
      rulesWithoutTest: "Rules without a test",
      rulesUnplanned: "Rules in no slice",
      slicesWithoutTest: "Slices without a test",
      requirementsWithoutVerify: "Requirements without verification",
      criteriaWithoutVerify: "Criteria without verification",
    },
    missing: "**missing**",
  },
} as const;

const cell = (v: string) => v.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").replace(/<!--/g, "&lt;!--");

/** Markdown of the test plan. The same documents always give the same text (except the date). */
export function generateTestPlan(project: Project, lang: Lang, date: string, only?: string): string {
  const plan = buildTestPlan(project, only);
  const t = TEXT[lang];
  const file = project.rebuild!.paths.testplan;
  const link = (label: string, target: string) => `[${label}](${relativeLink(file, target)})`;
  const lines = ["---", "id: TESTPLAN", "generated: true", `date: ${date}`, "---", "", `<!-- ${t.generated} -->`, "", `# ${t.title}`, "", `> ${t.generated}`, ""];
  const table = (header: readonly string[], rows: string[][]) => {
    lines.push(`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`), "");
  };
  const verify = (v: string | null) => (v === null ? t.missing : cell(v));
  const done = (items: Criterion[]) => table(t.doneCols, items.map((c) => [cell(c.text), verify(c.verify)]));

  lines.push(`## ${t.slices}`, "");
  if (plan.slices.length === 0) lines.push(t.noSlices, "");
  for (const s of plan.slices) {
    lines.push(`### ${link(s.id, s.file)}: ${cell(s.title)} (${s.status})`, "");
    if (s.cases.length === 0) lines.push(t.noCases, "");
    else table(t.cases, s.cases.map((c) => [link(c.id, c.file), cell(c.title), c.rules.join(", "), c.expectedSource.join(", "), c.status]));
    if (s.done.length > 0) {
      lines.push(`**${t.done}**`, "");
      done(s.done);
    }
  }
  if (plan.globalDone.length > 0) {
    lines.push(`## ${t.global}`, "");
    done(plan.globalDone);
  }
  if (plan.requirements.length > 0) {
    lines.push(`## ${t.requirements}`, "");
    table(t.reqCols, plan.requirements.map((r) => [link(r.id, r.file), cell(r.title), cell(r.category), verify(r.verify)]));
  }
  if (plan.counts.length > 0) {
    lines.push(`## ${t.counts}`, "");
    table(t.countCols, plan.counts.map((c) => [link(cell(c.target), c.file), verify(c.command), cell(c.results ?? "")]));
  }
  if (plan.handovers.length > 0) {
    lines.push(`## ${t.handovers}`, "");
    table(t.handoverCols, plan.handovers.map((h) => [cell(h.table), cell(h.writer), cell(h.slice ?? ""), verify(h.verify)]));
  }
  lines.push(`## ${t.gaps}`, "");
  const gaps = Object.entries(plan.gaps).filter(([, ids]) => ids.length > 0);
  if (gaps.length === 0) lines.push(t.noGaps);
  else for (const [key, ids] of gaps) lines.push(`- ${t.gapNames[key as keyof TestPlan["gaps"]]}: ${ids.join(", ")}`);
  lines.push("");
  return lines.join("\n");
}
