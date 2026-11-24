const fs = require("fs");
const path = require("path");

// ─── Priority ordering (highest → lowest) ────────────────────────────────────
const PRIORITY_ORDER: Record<string, number> = {
  blocker: 0,
  highest: 1,
  high:    2,
  medium:  3,
  low:     4,
};

function priorityRank(priority: string | null): number {
  if (!priority) return 99;
  return PRIORITY_ORDER[priority.toLowerCase()] ?? 50;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface DateEntry {
  iso: string;
  readable: string;
}

interface Defect {
  key:          string | null;
  url:          string | null;
  summary:      string | null;
  type:         string | null;
  status:       string | null;
  priority:     string | null;
  assignee:     string | null;
  reporter:     string | null;
  created:      DateEntry | { raw: string } | null;
  last_updated: DateEntry | { raw: string } | null;
}

interface Report {
  generated_at:    string;
  source_file:     string;
  filter_person:   string | null;
  total_processed: number;
  summary: {
    byStatus:   Record<string, number>;
    byPriority: Record<string, number>;
    byAssignee: Record<string, number>;
    byReporter: Record<string, number>;
  };
  defects: Defect[];
}

// ─── Arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const reportPath   = args[0];
const oncallPerson = args[1] ? args[1].trim() : "Oncall Engineer";
const sprintName   = args[2] ? args[2].trim() : "Current Sprint";

if (!reportPath) {
  console.error("\n❌  Please provide the path to the jira-defects-report JSON file.");
  console.error("   Usage: node index.js path/to/report.json [\"Oncall Name\"] [\"Sprint Name\"]\n");
  console.error("   Examples:");
  console.error("     node index.js ../jira-defects-report/reports/report_Jira_2026-05-13.json");
  console.error("     node index.js ../jira-defects-report/reports/report_Jira_2026-05-13.json \"Daniel Quan\" \"Sprint 42\"\n");
  process.exit(1);
}

if (!fs.existsSync(reportPath)) {
  console.error(`\n❌  File not found: ${reportPath}\n`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readableDate(entry: DateEntry | { raw: string } | null): string {
  if (!entry) return "—";
  if ("readable" in entry) return entry.readable;
  if ("raw" in entry) return entry.raw;
  return "—";
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log("\n" + "━".repeat(55));
  console.log("  🎫  Oncall Ticket Creator");
  console.log("━".repeat(55));
  console.log(`\n📂  Reading report : ${reportPath}`);
  console.log(`👤  Oncall person  : ${oncallPerson}`);
  console.log(`🗓️   Sprint         : ${sprintName}\n`);

  // ─── Load report ────────────────────────────────────────────────────────────
  let report: Report;
  try {
    const raw = fs.readFileSync(reportPath, "utf-8");
    report = JSON.parse(raw) as Report;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`\n❌  Failed to read/parse JSON: ${message}\n`);
    process.exit(1);
  }

  if (!report.defects || report.defects.length === 0) {
    console.error("\n⚠️   No defects found in the report.\n");
    process.exit(0);
  }

  // ─── Sort defects by priority ────────────────────────────────────────────────
  const sorted = [...report.defects].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority)
  );

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year:    "numeric",
    month:   "long",
    day:     "numeric",
  });

  const md: string[] = [];

  // ── Header ───────────────────────────────────────────────────────────────────
  md.push("# Oncall Story — Active Defects Tracker");
  md.push("");
  md.push(`| | |`);
  md.push(`|---|---|`);
  md.push(`| **Date** | ${today} |`);
  md.push(`| **Oncall** | ${oncallPerson} |`);
  md.push(`| **Sprint** | ${sprintName} |`);
  md.push(`| **Source report** | ${report.source_file} |`);
  md.push(`| **Total defects** | ${sorted.length} |`);
  md.push("");

  // ── Priority breakdown ───────────────────────────────────────────────────────
  md.push("## Priority Breakdown");
  md.push("");
  md.push("| Priority | Count |");
  md.push("|---|---|");
  const priorityEntries = Object.entries(report.summary.byPriority)
    .sort((a, b) => priorityRank(a[0]) - priorityRank(b[0]));
  for (const [priority, count] of priorityEntries) {
    md.push(`| ${priority} | ${count} |`);
  }
  md.push("");

  // ── Status breakdown ─────────────────────────────────────────────────────────
  md.push("## Status Breakdown");
  md.push("");
  md.push("| Status | Count |");
  md.push("|---|---|");
  const statusEntries = Object.entries(report.summary.byStatus)
    .sort((a, b) => b[1] - a[1]);
  for (const [status, count] of statusEntries) {
    md.push(`| ${status} | ${count} |`);
  }
  md.push("");

  // ── Defects list ─────────────────────────────────────────────────────────────
  md.push("## Defects — Ordered by Priority");
  md.push("");
  md.push("| # | Key | Priority | Status | Summary | Assignee | Reporter | Last Updated |");
  md.push("|---|---|---|---|---|---|---|---|");

  sorted.forEach((defect, index) => {
    const num      = index + 1;
    const key      = defect.key      ?? "N/A";
    const keyLink  = defect.url ? `[${key}](${defect.url})` : key;
    const summary  = (defect.summary ?? "No summary").replace(/\|/g, "\\|");
    const priority = defect.priority ?? "No priority";
    const status   = defect.status   ?? "No status";
    const assignee = defect.assignee ?? "Unassigned";
    const reporter = defect.reporter ?? "Unknown";
    const updated  = readableDate(defect.last_updated);

    md.push(`| ${num} | ${keyLink} | ${priority} | ${status} | ${summary} | ${assignee} | ${reporter} | ${updated} |`);
  });

  md.push("");

  // ── Oncall actions checklist ──────────────────────────────────────────────────
  md.push("## Oncall Actions");
  md.push("");
  md.push("- [ ] Review all Blocker / Highest defects");
  md.push("- [ ] Confirm assignees are actively working on blockers");
  md.push("- [ ] Update statuses in Jira");
  md.push("- [ ] Escalate any unassigned high-priority defects");
  md.push("- [ ] Add notes / comments to blocked items");
  md.push("");
  md.push("---");
  md.push("");
  md.push(`*Generated by oncall-ticket-creator on ${new Date().toISOString()}*`);
  md.push("");

  const content = md.join("\n");

  // ─── Save output ─────────────────────────────────────────────────────────────
  const outputDir = "./tickets";
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp  = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safePerson = oncallPerson.replace(/\s+/g, "_");
  const ticketFile = path.join(outputDir, `oncall_${safePerson}_${timestamp}.md`);

  fs.writeFileSync(ticketFile, content, "utf-8");

  // ─── Console output ───────────────────────────────────────────────────────────
  console.log(content);
  console.log(`✅  Ticket saved to: ${ticketFile}\n`);
}

main();
