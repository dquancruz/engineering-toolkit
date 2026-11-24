import type { Checklist } from "./checklist.js";
import { ELEMENT_IDS, elementLines, isEmpty, type ElementId, type PromptAnswers } from "./model.js";

export interface PromptWarning {
  element: ElementId;
  code: "empty" | "weak" | "not-checkable" | "no-command";
  message: string;
}

const hasCodeSpan = (text: string) => /`[^`\n]+`/.test(text);
const hasNumber = (text: string) => /\d/.test(text);

function matches(text: string, signals: string[]): string[] {
  const lower = text.toLowerCase();
  return signals.filter((s) => lower.includes(s));
}

const EMPTY: Record<ElementId, string> = {
  goal: "goal is empty: say what you want to achieve in one sentence.",
  context: "context is empty: add what cannot be derived from the code, or confirm there is none.",
  material: "material is empty: list the files or documents to read first.",
  limits: "no limits set: say what must not be done or touched.",
  autonomy: "autonomy is empty: say when to stop and ask instead of deciding.",
  done: "definition of done is empty: say how you will know it is finished.",
  verify: "verification is empty: say which commands or steps will check the result.",
  response: "shape of the response is empty: say the format you want.",
};

/** Warnings about empty or weak elements. They never block anything. */
export function evaluate(answers: PromptAnswers, checklist: Checklist): PromptWarning[] {
  const out: PromptWarning[] = [];

  for (const id of ELEMENT_IDS) {
    const el = checklist.elements[id];
    if (isEmpty(answers, id)) {
      out.push({ element: id, code: "empty", message: EMPTY[id] });
      continue;
    }

    const text = elementLines(answers, id).join("\n");
    const weak = matches(text, el.weak);
    if (weak.length > 0) {
      out.push({ element: id, code: "weak", message: `${id} looks vague (${weak.map((w) => `"${w}"`).join(", ")}): ${el.question}` });
    }

    if (id === "goal" && text.length < 15 && weak.length === 0) {
      out.push({ element: id, code: "weak", message: `goal is very short: ${el.question}` });
    }

    if (id === "done") {
      const concrete = hasCodeSpan(text) || hasNumber(text) || matches(text, el.checkable).length > 0;
      if (!concrete) {
        out.push({
          element: id,
          code: "not-checkable",
          message: "the definition of done does not look checkable: add a command, a test or an exact result.",
        });
      }
    }

    if (id === "verify" && !elementLines(answers, id).some((l) => hasCodeSpan(l) || /^\s*\$\s/.test(l))) {
      out.push({ element: id, code: "no-command", message: "verification has no command: add what to run, in `backticks`." });
    }
  }
  return out;
}
