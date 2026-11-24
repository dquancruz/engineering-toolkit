import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";

export interface JiraReportOptions {
  /** Directory the report files are written to (default: `reports`, relative to cwd). */
  out?: string;
  /** Base URL of the Jira instance. Defaults to the JIRA_BASE_URL env var. */
  baseUrl?: string;
}

// ─── Column mapping (supports English and Spanish Jira exports) ───────────────
const COLUMN_MAP: Record<string, string[]> = {
  key:      ["Issue key", "Clave", "Key"],
  summary:  ["Summary", "Resumen"],
  type:     ["Issue Type", "Tipo de incidencia", "Issue type"],
  status:   ["Status", "Estado"],
  priority: ["Priority", "Prioridad"],
  assignee: ["Assignee", "Asignado"],
  reporter: ["Reporter", "Informador", "Reportado por"],
  created:  ["Created", "Creado"],
  updated:  ["Updated", "Actualizado", "Última modificación"],
};

// ─── Find column flexibly ─────────────────────────────────────────────────────
function findColumn(headers: string[], candidates: string[]): string | null {
  for (const name of candidates) {
    const found = headers.find(
      (h) => h.trim().toLowerCase() === name.toLowerCase()
    );
    if (found) return found;
  }
  return null;
}

// ─── Format date ──────────────────────────────────────────────────────────────
function formatDate(value: string): { iso: string; readable: string } | { raw: string } | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(value.trim());
  if (isNaN(d.getTime())) return { raw: value.trim() };
  return {
    iso: d.toISOString(),
    readable: d.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

/** Runs the report. Returns the process exit code. */
export function runJiraReport(
  csvPath: string,
  person: string | undefined,
  options: JiraReportOptions = {}
): number {
  const personArg = person ?? "";
  const filterPerson = person ? person.trim().toLowerCase() : null;

  // When unset, the "url" field of each defect is null.
  const jiraBaseUrl = (options.baseUrl ?? process.env["JIRA_BASE_URL"] ?? "")
    .trim()
    .replace(/\/+$/, "");

  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌  File not found: ${csvPath}\n`);
    return 1;
  }

  console.log("\n" + "━".repeat(50));
  console.log("  📋  Jira CSV → JSON Reporter");
  console.log("━".repeat(50));
  console.log(`\n📂  Reading: ${csvPath}`);
  if (filterPerson) {
    console.log(`👤  Filtering by person: "${personArg}"`);
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  let records: Record<string, string>[] = [];
  try {
    records = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`\n❌  Failed to parse CSV: ${message}\n`);
    return 1;
  }

  if (records.length === 0) {
    console.error("\n❌  The CSV is empty or has no data rows.\n");
    return 1;
  }

  const headers = Object.keys(records[0]!);
  console.log(`✅  ${records.length} rows found`);
  console.log(`📑  Columns detected: ${headers.length}\n`);

  // Resolve columns
  const cols: Record<string, string | null> = {};
  for (const [field, candidates] of Object.entries(COLUMN_MAP)) {
    cols[field] = findColumn(headers, candidates);
  }

  // Show column mapping
  console.log("🗺️   Column mapping:");
  for (const [field, col] of Object.entries(cols)) {
    const status = col ? `✓  ${col}` : "–  not found";
    console.log(`   ${field.padEnd(12)} ${status}`);
  }
  console.log();

  // Filter bugs/defects if type column exists
  let rows = records;
  if (cols["type"]) {
    const typeCol = cols["type"];
    const bugs = records.filter((r) => {
      const type = (r[typeCol!] || "").toLowerCase();
      return type.includes("bug") || type.includes("defect") || type.includes("error");
    });
    if (bugs.length > 0) {
      console.log(`🐛  Filtering defects/bugs only: ${bugs.length} of ${records.length} rows`);
      rows = bugs;
    } else {
      console.log(`ℹ️   No Bug/Defect rows found, processing all rows.`);
    }
  }

  // Filter by person (assignee OR reporter)
  if (filterPerson) {
    const beforeCount = rows.length;
    const assigneeCol = cols["assignee"];
    const reporterCol = cols["reporter"];
    rows = rows.filter((r) => {
      const assignee = (assigneeCol ? r[assigneeCol] || "" : "").toLowerCase();
      const reporter = (reporterCol ? r[reporterCol] || "" : "").toLowerCase();
      return assignee.includes(filterPerson) || reporter.includes(filterPerson);
    });
    console.log(`👤  Matched person filter: ${rows.length} of ${beforeCount} defects\n`);

    if (rows.length === 0) {
      console.error(`\n⚠️   No defects found for "${personArg}".`);
      console.error(`   Tip: check the exact name spelling in your CSV.\n`);
      return 0;
    }
  } else {
    console.log();
  }

  // Transform rows
  const get = (row: Record<string, string>, field: string): string => {
    const col = cols[field];
    return col ? row[col] || "" : "";
  };

  const defects = rows.map((row) => ({
    key:          get(row, "key") || null,
    url:          jiraBaseUrl && get(row, "key") ? `${jiraBaseUrl}/browse/${get(row, "key")}` : null,
    summary:      get(row, "summary") || null,
    type:         get(row, "type") || null,
    status:       get(row, "status") || null,
    priority:     get(row, "priority") || null,
    assignee:     get(row, "assignee") || null,
    reporter:     get(row, "reporter") || null,
    created:      formatDate(get(row, "created")),
    last_updated: formatDate(get(row, "updated")),
  }));

  // ─── Summary ──────────────────────────────────────────────────────────────
  const summary: {
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byAssignee: Record<string, number>;
    byReporter: Record<string, number>;
  } = { byStatus: {}, byPriority: {}, byAssignee: {}, byReporter: {} };

  defects.forEach((d) => {
    const status   = d.status   || "No status";
    const priority = d.priority || "No priority";
    const assignee = d.assignee || "Unassigned";
    const reporter = d.reporter || "Unknown";

    summary.byStatus[status]     = (summary.byStatus[status]     ?? 0) + 1;
    summary.byPriority[priority] = (summary.byPriority[priority] ?? 0) + 1;
    summary.byAssignee[assignee] = (summary.byAssignee[assignee] ?? 0) + 1;
    summary.byReporter[reporter] = (summary.byReporter[reporter] ?? 0) + 1;
  });

  // ─── Save files ───────────────────────────────────────────────────────────
  const outputDir = options.out ?? "reports";
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName  = path.basename(csvPath, path.extname(csvPath));
  const personTag = filterPerson ? `_${personArg.replace(/\s+/g, "_")}` : "";

  const fullReport = {
    generated_at:    new Date().toISOString(),
    source_file:     path.basename(csvPath),
    filter_person:   person || null,
    total_processed: defects.length,
    summary,
    defects,
  };

  const reportFile  = path.join(outputDir, `report_${baseName}${personTag}_${timestamp}.json`);
  const summaryFile = path.join(outputDir, `summary_${baseName}${personTag}_${timestamp}.json`);

  fs.writeFileSync(reportFile, JSON.stringify(fullReport, null, 2), "utf-8");
  fs.writeFileSync(
    summaryFile,
    JSON.stringify({ generated_at: fullReport.generated_at, filter_person: fullReport.filter_person, total_processed: defects.length, summary }, null, 2),
    "utf-8"
  );

  // ─── Console output ───────────────────────────────────────────────────────
  console.log("✅  Report generated!\n");
  console.log(`📁  Full report : ${reportFile}`);
  console.log(`📁  Summary     : ${summaryFile}`);

  console.log("\n📊  Quick summary:");

  console.log("   By status:");
  (Object.entries(summary.byStatus) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`     ${k.padEnd(25)} ${v}`));

  console.log("   By priority:");
  (Object.entries(summary.byPriority) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`     ${k.padEnd(25)} ${v}`));

  if (!filterPerson) {
    console.log("   Top assignees:");
    (Object.entries(summary.byAssignee) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([k, v]) => console.log(`     ${k.padEnd(25)} ${v}`));
  }

  console.log("\n" + "━".repeat(50) + "\n");
  return 0;
}
