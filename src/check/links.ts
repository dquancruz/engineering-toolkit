import { parsePendingEntries } from "../docs/pending.js";
import type { Project } from "./project.js";
import { str } from "./project.js";
import { visibleText } from "./text.js";

/** ADR id -> status. */
export const adrStatuses = (project: Project): Map<string, string | null> =>
  new Map(project.adrs.map((a) => [`ADR-${String(a.number).padStart(4, "0")}`, str(a.fm?.data["status"])]));

/** IDs of the sources register, or null in a project without one (no legacy profile). */
export const sourceIds = (project: Project): Set<string> | null =>
  project.legacy ? new Set(project.legacy.sources?.entries.map((e) => e.id)) : null;

function pendingEntries(project: Project) {
  const pending = project.docs.find((d) => d.key === "pending");
  return pending ? parsePendingEntries(visibleText(pending.text)) : [];
}

export const allQuestions = (project: Project): Set<string> => new Set(pendingEntries(project).map((e) => e.id));

export const openQuestions = (project: Project): Set<string> =>
  new Set(pendingEntries(project).filter((e) => e.fields["status"]?.value === "open").map((e) => e.id));
