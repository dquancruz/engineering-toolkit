export const CATEGORIES = ["users", "sensitive-data", "performance", "availability", "integrations", "maintenance"] as const;
export type Category = (typeof CATEGORIES)[number];

export const REQUIREMENT_STATUSES = ["draft", "confirmed", "not-applicable"] as const;
export const CONSTRAINT_KINDS = ["cloud", "region", "identity", "database", "other"] as const;

/** Categories whose target is expected to be a number. */
export const NUMERIC_CATEGORIES: readonly string[] = ["users", "performance", "availability"];
/** Categories that, once confirmed, are expected to say how they are verified. */
export const VERIFIED_CATEGORIES: readonly string[] = ["performance", "availability"];

/** Fields of an entry, in the order they are written. */
export const REQUIREMENT_FIELDS = ["category", "status", "measure", "target", "verify", "source", "reason", "owner", "date"] as const;
export const CONSTRAINT_FIELDS = ["kind", "value", "decided_by", "origin", "owner", "date"] as const;

export const formatRegisterId = (prefix: "RNF" | "RES", n: number) => `${prefix}-${String(n).padStart(2, "0")}`;

/** `F-02, ADR-0001` -> ["F-02", "ADR-0001"]. */
export const splitIds = (value: string | undefined): string[] =>
  (value ?? "").split(",").map((v) => v.trim()).filter((v) => v !== "");

/** A backtick command, the way `engkit prompt` writes verifications. */
export const isCommand = (value: string) => /`[^`\n]+`/.test(value);
