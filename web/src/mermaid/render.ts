import mermaid from "mermaid";
import { check, toProblem, unsupported, type DiagramNotice, type Problem } from "../core/diagram/source.js";
import { ALLOWED_TYPES, REFUSED_TYPES } from "../core/diagram/types.js";
import { CONFIG } from "./config.js";
import { sanitize, type Clean } from "./sanitize.js";

export type Diagram = Omit<Clean, "notices"> & { type: string; code: string; notices: DiagramNotice[] };
export type Outcome = { ok: true; diagram: Diagram } | { ok: false; problem: Problem };

let initialized = false;
let count = 0;
/** Mermaid keeps global state while it draws: one diagram at a time. */
let queue: Promise<unknown> = Promise.resolve();

const refusedType = (type: string): Outcome => ({ ok: false, problem: { code: "refused-type", detail: type } });

function typeOf(code: string): string | undefined {
  try {
    return mermaid.detectType(code);
  } catch {
    return undefined;
  }
}

async function draw(code: string): Promise<Outcome> {
  const refused = check(code);
  if (refused) return { ok: false, problem: refused };
  if (!initialized) {
    mermaid.initialize(CONFIG);
    initialized = true;
  }
  const id = `diagram-${++count}`;
  try {
    // parse first: its errors carry the position, and it names the type without drawing anything
    const { diagramType: type } = await mermaid.parse(code);
    if (!ALLOWED_TYPES.includes(type)) return refusedType(type);
    const { svg, diagramType } = await mermaid.render(id, code);
    const clean = sanitize(svg);
    return { ok: true, diagram: { ...clean, type: diagramType, code, notices: [...unsupported(code), ...clean.notices] } };
  } catch (error) {
    // a refused type with a mistake in it is refused all the same
    const type = typeOf(code);
    if (type !== undefined && REFUSED_TYPES.includes(type)) return refusedType(type);
    return { ok: false, problem: toProblem(error, code) };
  } finally {
    // what a failed drawing can leave in the page
    for (const leftover of document.querySelectorAll(`#${id}, #d${id}, #i${id}`)) leftover.remove();
  }
}

export function render(code: string): Promise<Outcome> {
  const next = queue.then(() => draw(code));
  queue = next.catch(() => undefined);
  return next;
}
