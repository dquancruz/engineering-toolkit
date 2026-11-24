import type { Checklist } from "./checklist.js";
import { ELEMENT_IDS, isListElement, isEmpty, type PromptAnswers } from "./model.js";

/** Markdown of the prompt. Empty elements are left out; headings come from the checklist's language. */
export function renderPrompt(answers: PromptAnswers, checklist: Checklist): string {
  const lines = [`# ${checklist.strings.promptTitle}`, ""];
  for (const id of ELEMENT_IDS) {
    if (isEmpty(answers, id)) continue;
    lines.push(`## ${checklist.elements[id].title}`, "");
    const value = answers[id]!;
    if (isListElement(id)) {
      for (const item of value as string[]) lines.push(`- ${item}`);
    } else {
      lines.push(value as string);
    }
    lines.push("");
  }
  return lines.join("\n");
}
