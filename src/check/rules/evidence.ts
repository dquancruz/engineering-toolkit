import { evidenceOf, type Legacy, type LegacyItem } from "../../legacy/load.js";
import { EvidenceRefError, formatRef, parseRef, verify, type EvidenceReader, type EvidenceRef } from "../../legacy/evidence.js";
import { str } from "../project.js";
import type { Report, Severity } from "../types.js";

/** 1-based line of the file where `needle` is written, or 1. */
function lineOf(item: LegacyItem, needle: string): number {
  const at = item.text.split("\n").findIndex((l) => l.includes(needle));
  return at === -1 ? 1 : at + 1;
}

/** Compares every code evidence with the files of its root. Returns how many could not be verified. */
export function checkEvidence(legacy: Legacy, reader: EvidenceReader, report: Report): number {
  const unavailable = new Map<string, { configured: string; count: number }>();

  for (const item of [...legacy.items.rule, ...legacy.items.defect]) {
    const status = str(item.fm?.data["status"]);
    // Broken evidence of something in force is an error; of a draft or a dropped item, a warning.
    const broken: Severity = status === "confirmed" || status === "modified" ? "error" : "warning";

    for (const entry of evidenceOf(item) ?? []) {
      if (entry.ref === undefined) continue;
      const line = lineOf(item, entry.ref);
      const add = (rule: string, severity: Severity, message: string) =>
        report({ rule, severity, file: item.file, line, message: `${item.id}: ${message}` });
      try {
        const ref: EvidenceRef = parseRef(entry.ref);
        const root = reader.root(ref.root);
        if (entry.hash !== undefined && entry.hash !== null && typeof entry.hash !== "string") {
          add("evidence-invalid", "error", `the hash of ${entry.ref} must be written in quotes.`);
          continue;
        }
        if (!root.available) {
          const current = unavailable.get(ref.root) ?? { configured: root.configured, count: 0 };
          unavailable.set(ref.root, { ...current, count: current.count + 1 });
          continue;
        }
        const verdict = verify(ref, str(entry.hash), reader.lines(ref));
        switch (verdict.state) {
          case "ok":
            if (verdict.weak) add("evidence-weak", "warning", `${entry.ref} is too short to be told apart from other lines; cite more context.`);
            break;
          case "unrecorded":
            add("evidence-unrecorded", "warning", `${entry.ref} has no hash. Record it with "engkit evidence add ${item.id} ${entry.ref}".`);
            break;
          case "moved":
            add("evidence-moved", "warning", `${entry.ref} moved to ${formatRef(verdict.to)}. Run "engkit evidence update ${item.id}".`);
            break;
          case "ambiguous":
            add("evidence-ambiguous", "warning", `${entry.ref}: the recorded content is not there and appears in ${verdict.matches} other places; review it.`);
            break;
          case "weak":
            add("evidence-weak", "warning", `${entry.ref}: the lines changed and the recorded content is too short to locate; review it.`);
            break;
          case "changed":
            add(
              "evidence-changed",
              broken,
              `${entry.ref} ${verdict.outOfRange ? "is past the end of the file" : "changed"}. Read it again, then "engkit evidence update --accept ${item.id}" or replace the reference.`
            );
            break;
          case "missing-file":
            add("evidence-missing", broken, `${entry.ref}: the file does not exist in its root.`);
            break;
        }
      } catch (e) {
        if (!(e instanceof EvidenceRefError)) throw e;
        add("evidence-invalid", "error", e.message);
      }
    }
  }

  let total = 0;
  for (const [name, { configured, count }] of [...unavailable].sort()) {
    total += count;
    report({
      rule: "evidence-unavailable",
      severity: "warning",
      file: ".engkit.json",
      line: null,
      message: `Evidence root "${name}" (${configured}) is not available: ${count} evidence reference(s) NOT verified. Set its path in .engkit.local.json.`,
    });
  }
  return total;
}
