import { createHash } from "node:crypto";
import YAML, { isMap, isScalar } from "yaml";
import type { ParsedDoc } from "../docs/frontmatter.js";
import { isRecord } from "./model.js";

/** Parts of a data plan that define what the counts mean. Editing any of them makes old results stale. */
const DEFINITION_KEYS = ["target", "sources", "fields", "cleaning", "transformations", "totals", "counts"] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value ?? null;
}

/** 12 hex characters identifying the definition of a data plan (key order and YAML style do not matter). */
export function definitionHash(fm: ParsedDoc): string {
  const definition = Object.fromEntries(DEFINITION_KEYS.map((k) => [k, canonical(fm.data[k])]));
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex").slice(0, 12);
}

export interface Results {
  definition: string;
  taken_at: string;
  source: number;
  target: number;
  excluded: Record<string, number>;
  adjustments: Record<string, number>;
  /** Control totals as exact decimal text, so large amounts are not rounded. */
  totals: Record<string, { source: string; target: string }>;
}

const RESULT_KEYS = ["definition", "taken_at", "source", "target", "excluded", "adjustments", "totals"];

/** `1200.50` -> `1200.5`, `-0.0` -> `0`. Null for exponents and anything that is not a plain decimal. */
export function canonicalDecimal(raw: string): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) return null;
  const int = m[2]!.replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const body = frac === "" ? int : `${int}.${frac}`;
  return body === "0" ? body : `${m[1]}${body}`;
}

/**
 * Reads a results file. Only the known fields with numbers are accepted, so rows or personal data cannot end
 * up in it. Error messages never repeat a value of the file.
 */
export function parseResults(content: string): { results: Results } | { errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    return { errors: ["it is not valid JSON."] };
  }
  if (!isRecord(data)) return { errors: ["it must be a JSON object."] };
  const errors: string[] = [];
  if (Object.keys(data).some((k) => !RESULT_KEYS.includes(k))) {
    errors.push(`it may only have the fields ${RESULT_KEYS.join(", ")}.`);
  }
  const definition = data["definition"];
  if (typeof definition !== "string" || !/^[0-9a-f]{12}$/.test(definition)) errors.push('"definition" must be the 12 hex characters of "engkit data hash".');
  const takenAt = data["taken_at"];
  if (typeof takenAt !== "string" || !/^\d{4}-\d{2}-\d{2}([T ][\d:.+Z-]+)?$/.test(takenAt)) errors.push('"taken_at" must be a date (YYYY-MM-DD).');

  const count = (v: unknown, signed = false) => Number.isSafeInteger(v) && (signed || (v as number) >= 0);
  for (const key of ["source", "target"]) if (!count(data[key])) errors.push(`"${key}" must be a whole number, 0 or more.`);
  for (const key of ["excluded", "adjustments"] as const) {
    const map = data[key] ?? {};
    const signed = key === "adjustments";
    if (!isRecord(map) || !Object.values(map).every((v) => count(v, signed))) {
      errors.push(`"${key}" must map rule IDs to whole numbers${signed ? "" : ", 0 or more"}.`);
    }
  }

  // The raw text of each total, so that 12345678901234567.89 and ...88 are not read as the same number.
  const totals: Results["totals"] = {};
  const raw = data["totals"] ?? {};
  const doc = YAML.parseDocument(content.replace(/^\uFEFF/, ""), { uniqueKeys: false });
  const nodes = doc.get("totals");
  if (!isRecord(raw)) errors.push('"totals" must be an object.');
  else {
    for (const name of Object.keys(raw)) {
      const entry = raw[name];
      const node = isMap(nodes) ? nodes.get(name, true) : undefined;
      const side = (key: "source" | "target"): string | null => {
        const value = isMap(node) ? node.get(key, true) : undefined;
        return isScalar(value) && typeof value.value === "number" && typeof value.source === "string" ? canonicalDecimal(value.source) : null;
      };
      const [source, target] = [side("source"), side("target")];
      if (!isRecord(entry) || Object.keys(entry).length !== 2 || source === null || target === null) {
        errors.push('every total must be { "source": number, "target": number }, written without exponents.');
        break;
      }
      totals[name] = { source, target };
    }
  }
  if (errors.length > 0) return { errors };
  return {
    results: {
      definition: definition as string,
      taken_at: takenAt as string,
      source: data["source"] as number,
      target: data["target"] as number,
      excluded: (data["excluded"] ?? {}) as Record<string, number>,
      adjustments: (data["adjustments"] ?? {}) as Record<string, number>,
      totals,
    },
  };
}

const sum = (map: Record<string, number>) => Object.values(map).reduce((a, b) => a + BigInt(b), 0n);

/** `source + adjustments - excluded`, computed exactly. */
export const expectedTarget = (r: Results): bigint => BigInt(r.source) + sum(r.adjustments) - sum(r.excluded);
