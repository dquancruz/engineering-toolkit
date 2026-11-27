import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type { Lang } from "../i18n.js";
import type { DiagramNotice, Problem } from "../core/diagram/source.js";
import { CopyButton, Field, useT } from "../ui/common.js";
import { Mermaid, type Editor } from "./context.js";
import { download, svgUrl, toPng } from "./export.js";
import { render, type Diagram } from "./render.js";

const DELAY_MS = 400;
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const EXAMPLE = {
  es: "flowchart LR\n  A[Pedido] --> B{¿Pagado?}\n  B -->|sí| C[Enviar]\n  B -->|no| D[Recordar]",
  en: "flowchart LR\n  A[Order] --> B{Paid?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Remind]",
} satisfies Record<Lang, string>;

interface Props {
  editor: Editor;
  onCode: (code: string) => void;
  lang: Lang;
}

export function DiagramTool({ editor, onCode, lang }: Props) {
  const t = useT();
  const m = useContext(Mermaid);
  const { code } = editor;
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** The code whose drawing or error is shown. */
  const [settled, setSettled] = useState("");
  /** A percentage of the real size, or the width of the view. */
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [scale, setScale] = useState(2);
  const [white, setWhite] = useState(true);
  const [exported, setExported] = useState<"export.done" | "export.failed" | null>(null);
  const [scaled, setScaled] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const turn = ++latest.current;
    setExported(null);
    setScaled(false);
    if (code.trim() === "") {
      setDiagram(null);
      setProblem(null);
      setSettled(code);
      return;
    }
    const timer = setTimeout(async () => {
      const outcome = await render(code);
      // the code changed while this was drawn
      if (turn !== latest.current) return;
      setSettled(code);
      if (outcome.ok) {
        setDiagram(outcome.diagram);
        setProblem(null);
      } else setProblem(outcome.problem);
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [code]);

  const outline = diagram && editor.described?.code === diagram.code ? editor.described.outline : null;
  // the diagram's own description, else what the table said, else the texts drawn
  const own = diagram ? [diagram.title, diagram.description].filter(Boolean).join(". ") : "";
  const lines = diagram ? (outline ?? diagram.texts) : [];
  const alternative = !diagram ? "" : own || (lines.length > 0 ? m("diagram.alt", { type: diagram.type, texts: lines.join("; ").slice(0, 900) }) : m("diagram.altEmpty", { type: diagram.type }));
  const busy = settled !== code && code.trim() !== "";
  const stale = diagram !== null && diagram.code !== code;

  const save = async (kind: "svg" | "png") => {
    if (!diagram) return;
    setExported(null);
    try {
      if (kind === "svg") download(new Blob([diagram.svg], { type: "image/svg+xml" }), "diagram.svg");
      else {
        const png = await toPng(diagram.svg, diagram.width, diagram.height, scale, white);
        setScaled(png.scaled);
        download(png.blob, "diagram.png");
      }
      setExported("export.done");
    } catch {
      setExported("export.failed");
    }
  };

  const step = (direction: 1 | -1) => {
    const now = zoom === "fit" ? 1 : zoom;
    const next = direction === 1 ? ZOOMS.find((z) => z > now) : [...ZOOMS].reverse().find((z) => z < now);
    setZoom(next ?? now);
  };

  const notices: DiagramNotice[] = diagram && !stale ? [...diagram.notices, ...(scaled ? (["png-scaled"] as const) : [])] : [];

  return (
    <div class="tool" data-busy={String(busy)}>
      <Field id="diagram-code" label={m("diagram.code")} value={code} onInput={onCode} />
      <div class="actions">
        <button type="button" onClick={() => onCode(EXAMPLE[lang])} disabled={code.trim() !== ""}>
          {m("diagram.example")}
        </button>
        <CopyButton text={code} />
        <span class="hint">{m("diagram.limits")}</span>
      </div>

      <div role="alert">
        {problem && (
          <div class="box error">
            <p>
              <strong>{m(`problem.${problem.code}`)}</strong>
              {problem.line !== undefined && ` (${t("common.line", { line: problem.line })})`}
            </p>
            {problem.source !== undefined && <pre class="source">{problem.source}</pre>}
            {problem.line === undefined && (problem.code === "syntax" || problem.code === "invalid-date") && <p>{m("problem.noLine")}</p>}
            {problem.detail && (
              <p class="detail" lang="en">
                <span>{t("common.technical")}: </span>
                {problem.detail}
              </p>
            )}
          </div>
        )}
      </div>
      <p role="status" class="ok">
        {busy ? m("diagram.drawing") : diagram && !problem ? m("diagram.ready") : ""}
      </p>
      <div aria-live="polite">
        {stale && problem && <p class="box warning">{m("diagram.stale")}</p>}
        {notices.length > 0 && (
          <div class="box warning">
            <ul>
              {notices.map((n) => (
                <li key={n}>{m(`notice.${n}`)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {diagram && (
        <>
          <div class="actions">
            <button type="button" onClick={() => step(-1)}>
              {m("diagram.zoomOut")}
            </button>
            <button type="button" onClick={() => step(1)}>
              {m("diagram.zoomIn")}
            </button>
            <button type="button" onClick={() => setZoom(1)}>
              {m("diagram.zoomReset")}
            </button>
            <button type="button" onClick={() => setZoom("fit")}>
              {m("diagram.zoomFit")}
            </button>
            <span aria-live="polite">{zoom === "fit" ? "" : `${zoom * 100} %`}</span>
          </div>
          {/* focusable, so the keyboard can scroll it */}
          <div class="canvas" role="group" aria-label={m("diagram.preview")} tabIndex={0}>
            {/* shown as a picture: nothing inside the diagram can be clicked or run */}
            <img src={svgUrl(diagram.svg)} alt={alternative} width={zoom === "fit" ? diagram.width : Math.round(diagram.width * zoom)} class={zoom === "fit" ? "fit" : ""} />
          </div>
          <details>
            <summary>{m("diagram.text")}</summary>
            {own && <p>{own}</p>}
            <ul class="outline">
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
          <fieldset>
            <legend>{m("export.title")}</legend>
            <div class="actions">
              <button type="button" onClick={() => save("svg")} disabled={stale}>
                {m("export.svg")}
              </button>
              <div class="field inline">
                <label for="png-scale">{m("export.scale")}</label>
                <select id="png-scale" value={String(scale)} onChange={(e) => setScale(Number(e.currentTarget.value))}>
                  {[1, 2, 3].map((s) => (
                    <option key={s} value={String(s)}>
                      {s}x
                    </option>
                  ))}
                </select>
              </div>
              <div class="field inline">
                <label for="png-background">{m("export.background")}</label>
                <select id="png-background" value={white ? "white" : "transparent"} onChange={(e) => setWhite(e.currentTarget.value === "white")}>
                  <option value="white">{m("export.white")}</option>
                  <option value="transparent">{m("export.transparent")}</option>
                </select>
              </div>
              <button type="button" onClick={() => save("png")} disabled={stale}>
                {m("export.png")}
              </button>
              <span role="status">{exported ? m(exported) : ""}</span>
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}
