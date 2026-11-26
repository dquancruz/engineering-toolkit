import { formatGuardsReport, testGuards } from "../agent/guards.js";

/** `engkit agent test-guards`. Returns the exit code (0 ok, 1 a check failed, 2 guards not installed). */
export function runAgentTestGuards(options: { json?: boolean; cwd?: string } = {}): number {
  const report = testGuards(options.cwd ?? process.cwd());
  if (options.json) {
    const failed = report.items.filter((i) => i.status === "fail").length;
    console.log(JSON.stringify({ ok: report.code === 0, code: report.code, failed, items: report.items }, null, 2));
  } else {
    console.log(formatGuardsReport(report));
  }
  return report.code;
}
