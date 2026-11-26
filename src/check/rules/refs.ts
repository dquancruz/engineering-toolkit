import { parsePendingEntries } from "../../docs/pending.js";
import { parseRegister } from "../../docs/register.js";
import type { ItemKind } from "../../legacy/model.js";
import type { Project } from "../project.js";
import { str } from "../project.js";
import { fieldLine, visibleText } from "../text.js";
import type { Report } from "../types.js";

/**
 * Kinds of references the checker knows. `ids(project)` returns the IDs that exist for that kind.
 * RN-, PA-, D- and F- only count in projects with the legacy profile.
 */
interface RefKind {
  name: string;
  pattern: RegExp;
  ids: (project: Project) => Set<string>;
  /** The profile that has to be configured for these references to count. */
  profile?: "legacy" | "sources" | "requirements" | "rebuild";
}

const registerKind = (name: "RNF" | "RES", profile: "requirements"): RefKind => ({
  name,
  pattern: new RegExp(`\\b${name}-\\d{2,}\\b`, "g"),
  ids: (p) => {
    const doc = p.docs.find((d) => d.key === "requirements");
    return new Set(doc ? parseRegister(doc.text, name).map((e) => e.id) : []);
  },
  profile,
});

const legacyKind = (name: "RN" | "PA" | "D", kind: ItemKind): RefKind => ({
  name,
  pattern: new RegExp(`\\b${name}-\\d{4}\\b`, "g"),
  ids: (p) => new Set(p.legacy?.items[kind].map((i) => i.id)),
  profile: "legacy",
});

const adrId = (n: number) => `ADR-${String(n).padStart(4, "0")}`;

const REF_KINDS: RefKind[] = [
  {
    name: "ADR",
    pattern: /\bADR-\d{4}\b/g,
    ids: (p) => {
      const ids = new Set(p.adrs.map((a) => adrId(a.number)));
      if (p.hasAdrTemplate) ids.add(adrId(0));
      return ids;
    },
  },
  {
    name: "P",
    pattern: /\bP-\d{2,}\b/g,
    ids: (p) => {
      const pending = p.docs.find((d) => d.key === "pending");
      return new Set(pending ? parsePendingEntries(visibleText(pending.text)).map((e) => e.id) : []);
    },
  },
  legacyKind("RN", "rule"),
  legacyKind("PA", "test"),
  legacyKind("D", "defect"),
  { name: "F", pattern: /\bF-\d{2,}\b/g, ids: (p) => new Set(p.sources?.entries.map((e) => e.id)), profile: "sources" },
  registerKind("RNF", "requirements"),
  registerKind("RES", "requirements"),
  { name: "K", pattern: /\bK-\d{2,}\b/g, ids: (p) => new Set(p.rebuild?.risks.map((r) => r.id)), profile: "rebuild" },
  { name: "SL", pattern: /\bSL-\d{2,}\b/g, ids: (p) => new Set(p.rebuild?.slices.map((s) => s.id)), profile: "rebuild" },
];

/** `broken-ref`: every ADR-xxxx / P-xx (and, with their profile, RN / PA / D / F / RNF / RES / K / SL) reference (body, supersedes, superseded_by) points to something that exists. */
export function checkReferences(project: Project, report: Report): void {
  const active = {
    legacy: project.legacy !== null,
    sources: project.sources !== null,
    requirements: project.docs.some((d) => d.key === "requirements"),
    rebuild: project.rebuild !== null,
  };
  const kinds = REF_KINDS.filter((kind) => !kind.profile || active[kind.profile]);
  const known = kinds.map((kind) => ({ kind, ids: kind.ids(project) }));
  const legacy = project.legacy;
  const legacyDocs = legacy ? Object.values(legacy.items).flat() : [];

  const rebuildDocs = project.rebuild ? [...project.rebuild.slices, ...project.rebuild.data] : [];

  for (const doc of [...project.docs, ...project.adrs, ...legacyDocs, ...rebuildDocs]) {
    const lines = visibleText(doc.text).split("\n");
    lines.forEach((text, i) => {
      for (const { kind, ids } of known) {
        for (const m of text.matchAll(kind.pattern)) {
          if (!ids.has(m[0])) {
            report({ rule: "broken-ref", file: doc.file, line: i + 1, message: `${m[0]} does not exist.` });
          }
        }
      }
    });
  }

  const adrIds = known[0]!.ids;
  for (const adr of project.adrs) {
    for (const key of ["supersedes", "superseded_by"]) {
      const value = str(adr.fm?.data[key]);
      if (value !== null && !adrIds.has(value)) {
        report({ rule: "broken-ref", file: adr.file, line: fieldLine(adr.text, key), message: `${key}: ${value} does not exist.` });
      }
    }
  }
}

/** `supersede-coherence`: supersedes / superseded_by / status agree with each other. */
export function checkSupersedeCoherence(project: Project, report: Report): void {
  const byId = new Map(project.adrs.map((a) => [adrId(a.number), a]));

  for (const adr of project.adrs) {
    if (!adr.fm) continue;
    const id = adrId(adr.number);
    const status = str(adr.fm.data["status"]);
    const supersedes = str(adr.fm.data["supersedes"]);
    const supersededBy = str(adr.fm.data["superseded_by"]);

    if (status === "superseded" && supersededBy === null) {
      report({ rule: "supersede-coherence", file: adr.file, line: fieldLine(adr.text, "status"), message: `${id} is superseded but has no "superseded_by".` });
    }
    if (status !== "superseded" && supersededBy !== null) {
      report({
        rule: "supersede-coherence",
        file: adr.file,
        line: fieldLine(adr.text, "superseded_by"),
        message: `${id} has "superseded_by: ${supersededBy}" but its status is "${status ?? "?"}", not "superseded".`,
      });
    }

    if (supersedes !== null) {
      const old = byId.get(supersedes);
      if (old?.fm && (str(old.fm.data["status"]) !== "superseded" || str(old.fm.data["superseded_by"]) !== id)) {
        report({
          rule: "supersede-coherence",
          file: adr.file,
          line: fieldLine(adr.text, "supersedes"),
          message: `${id} supersedes ${supersedes}, but ${supersedes} is not "superseded" with "superseded_by: ${id}".`,
        });
      }
    }
    if (supersededBy !== null) {
      const next = byId.get(supersededBy);
      if (next?.fm && str(next.fm.data["supersedes"]) !== id) {
        report({
          rule: "supersede-coherence",
          file: adr.file,
          line: fieldLine(adr.text, "superseded_by"),
          message: `${id} says it is superseded by ${supersededBy}, but ${supersededBy} does not declare "supersedes: ${id}".`,
        });
      }
    }
  }
}
