export const SLICE_STATUSES = ["planned", "in-progress", "done", "dropped"] as const;
export const WRITERS = ["legacy", "new"] as const;
export const HANDOVER_STATUSES = ["planned", "done"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const formatSliceId = (n: number) => `SL-${String(n).padStart(2, "0")}`;
export const SLICE_FILE = /^(SL-\d{2,})-.+\.md$/;

/** The same table written in different ways: `"Billing"."Invoices"`, `[billing].[invoices]`, `billing.invoices`. */
export const normalizeTable = (name: string) =>
  name.replace(/["`\[\]]/g, "").split(".").map((p) => p.trim()).join(".").toLowerCase();

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Non-empty text of a YAML value (numbers count), or null. */
export const text = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "TODO" ? null : s;
};
