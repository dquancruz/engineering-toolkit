/** The three kinds of legacy documents: business rules, acceptance tests and defects. */
export const ITEM_KINDS = ["rule", "test", "defect"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const PREFIX: Record<ItemKind, "RN" | "PA" | "D"> = { rule: "RN", test: "PA", defect: "D" };
export const DIR_KEY = { rule: "rulesDir", test: "testsDir", defect: "defectsDir" } as const;

export const RULE_STATUSES = ["draft", "confirmed", "modified", "discarded", "disputed"] as const;
export const TEST_STATUSES = ["draft", "ready"] as const;
export const DEFECT_STATUSES = ["suspected", "confirmed", "discarded"] as const;
export const DEFECT_DECISIONS = ["preserve", "fix", "undecided"] as const;
export const STATUSES: Record<ItemKind, readonly string[]> = {
  rule: RULE_STATUSES,
  test: TEST_STATUSES,
  defect: DEFECT_STATUSES,
};

/** `RN-0001`, `PA-0001`, `D-0001`. */
export const formatItemId = (kind: ItemKind, n: number) => `${PREFIX[kind]}-${String(n).padStart(4, "0")}`;
export const itemFilePattern = (kind: ItemKind) => new RegExp(`^(${PREFIX[kind]}-\\d{4})-.+\\.md$`);
