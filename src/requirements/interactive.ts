import type { Asker } from "../prompt/asker.js";
import { oneLine, type NewEntry } from "./entries.js";
import { CATEGORIES, CONSTRAINT_KINDS, type Category } from "./model.js";

const QUESTIONS: Record<Category, { topic: string; measure: string; target: string }> = {
  users: { topic: "Users: who uses it and how many", measure: "concurrent users at peak", target: "200" },
  "sensitive-data": { topic: "Sensitive data: what it holds and under which rules", measure: "personal fields encrypted at rest", target: "all of them" },
  performance: { topic: "Performance", measure: "p95 latency of the invoice search", target: "<= 300 ms" },
  availability: { topic: "Availability and recovery", measure: "monthly availability", target: ">= 99.5 %" },
  integrations: { topic: "Integrations: systems it talks to", measure: "payment gateway", target: "REST API, retried 3 times" },
  maintenance: { topic: "Maintenance: who will maintain it", measure: "team that owns the system", target: "billing team" },
};

export interface Collected {
  entries: NewEntry[];
  /** Titles of questions to open for what nobody knows yet, with the index of the entry they belong to. */
  questions: string[];
}

/** The guided walk through the six categories and the fixed constraints. Writes nothing. */
export async function collectRequirements(asker: Asker, owner: string): Promise<Collected> {
  const entries: NewEntry[] = [];
  const questions: string[] = [];
  const ask = async (message: string, placeholder?: string) =>
    oneLine(await asker.text({ message, ...(placeholder !== undefined ? { placeholder } : {}) }));
  const set = (fields: Record<string, string>, values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) if (value !== "") fields[key] = value;
  };

  asker.intro("engkit requirements");
  asker.note("For each category you can add requirements, say it does not apply, or skip it.\nWhat you do not know stays as a draft. Nothing is written until the end.", "How it works");

  for (const category of CATEGORIES) {
    const q = QUESTIONS[category];
    for (let first = true; ; first = false) {
      const action = await asker.select<"add" | "na" | "next">({
        message: first ? q.topic : `Another requirement for "${category}"?`,
        options: [
          { value: "add", label: "Add a requirement" },
          ...(first ? [{ value: "na" as const, label: "It does not apply" }] : []),
          { value: "next", label: first ? "Skip for now" : "No, continue" },
        ],
        initialValue: first ? "add" : "next",
      });
      if (action === "next") break;
      const title = await ask(action === "na" ? "Title (what does not apply)" : "Title");
      if (title === "") break;
      const fields: Record<string, string> = { category };
      if (action === "na") {
        set(fields, { status: "not-applicable", reason: await ask("Why does it not apply?") });
        entries.push({ kind: "requirement", title, fields });
        break;
      }
      const measure = await ask("What is measured?", q.measure);
      const target = await ask("Target value (a number when possible; empty if unknown)", q.target);
      const verify = await ask("How is it verified? A PA-xxxx or a `command` (empty if not yet)");
      const source = await ask("Source: F-xx or ADR-xxxx (empty if unknown)");
      const who = await ask(category === "maintenance" ? "Who will maintain it?" : "Owner", owner);
      set(fields, { measure, target, verify, source, owner: who || owner });
      const complete = measure !== "" && target !== "";
      fields["status"] = complete && (await asker.confirm({ message: "Is it confirmed (not a guess)?", initialValue: false })) ? "confirmed" : "draft";
      if (!complete && (await asker.confirm({ message: "Open a pending question for what is unknown?", initialValue: true }))) {
        questions.push(`Define the ${category} requirement: ${title}`);
      }
      entries.push({ kind: "requirement", title, fields });
    }
  }

  while (await asker.confirm({ message: "Add a fixed constraint (cloud, region, identity, database...)?", initialValue: false })) {
    const kind = await asker.select<(typeof CONSTRAINT_KINDS)[number]>({
      message: "Kind",
      options: CONSTRAINT_KINDS.map((value) => ({ value, label: value })),
    });
    const title = await ask("Title");
    if (title === "") break;
    const fields: Record<string, string> = { kind };
    set(fields, {
      value: await ask("What is fixed?"),
      decided_by: await ask("Who decided it?"),
      origin: await ask("Origin: F-xx or ADR-xxxx (check requires it)"),
    });
    entries.push({ kind: "constraint", title, fields });
  }
  return { entries, questions };
}
