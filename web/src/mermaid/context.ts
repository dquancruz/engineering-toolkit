import { createContext } from "preact";
import { mermaidTranslator, type MermaidTranslate } from "./i18n.js";

export const Mermaid = createContext<MermaidTranslate>(mermaidTranslator("es"));

/** The code of the editor, and the description in words that came with it from a table. */
export interface Editor {
  code: string;
  described?: { code: string; outline: string[] };
}
