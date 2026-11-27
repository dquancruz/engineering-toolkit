import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type { Lang } from "../i18n.js";
import { DIRECTIONS, EXAMPLES, KINDS, generate, type Direction, type Generated, type Kind } from "../core/diagram/generate.js";
import { TABLE_DELIMITERS, TableError, type TableDelimiter } from "../core/diagram/table.js";
import { CopyButton, Field, useT } from "../ui/common.js";
import { Mermaid } from "./context.js";

const DELIMITER_NAMES = { auto: "table.auto", ",": "convert.comma", ";": "convert.semicolon", "\t": "convert.tab" } as const;

interface Props {
  lang: Lang;
  hasCode: boolean;
  onOpen: (code: string, outline: string[]) => void;
}

export function TableTool({ lang, hasCode, onOpen }: Props) {
  const t = useT();
  const m = useContext(Mermaid);
  const [kind, setKind] = useState<Kind>("flowchart");
  const [delimiter, setDelimiter] = useState<TableDelimiter>("auto");
  const [direction, setDirection] = useState<Direction>("LR");
  // one text per kind: changing the kind loses nothing
  const [texts, setTexts] = useState<Record<Kind, string>>({ flowchart: "", er: "", gantt: "", sequence: "" });
  const [relations, setRelations] = useState("");
  const [result, setResult] = useState<Generated | null>(null);
  const [failure, setFailure] = useState<TableError | Error | null>(null);
  const [asking, setAsking] = useState(false);
  const text = texts[kind];
  const openButton = useRef<HTMLButtonElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  // the question takes the focus once, when it appears
  useEffect(() => {
    if (asking) replaceButton.current?.focus();
  }, [asking]);

  // a result belongs to the input that produced it
  useEffect(() => {
    setResult(null);
    setFailure(null);
    setAsking(false);
  }, [kind, delimiter, direction, text, relations]);

  const run = () => {
    setFailure(null);
    try {
      setResult(generate({ kind, text, relations, delimiter, direction }));
    } catch (e) {
      setResult(null);
      setFailure(e instanceof Error ? e : new Error(String(e)));
    }
  };
  const send = () => {
    if (!result) return;
    setAsking(false);
    onOpen(result.code, result.outline);
  };

  return (
    <div class="tool">
      <div class="actions">
        <div class="field inline">
          <label for="table-kind">{m("table.kind")}</label>
          <select id="table-kind" value={kind} onChange={(e) => setKind(e.currentTarget.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {m(`table.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div class="field inline">
          <label for="table-delimiter">{m("table.delimiter")}</label>
          <select id="table-delimiter" value={delimiter} onChange={(e) => setDelimiter(e.currentTarget.value as TableDelimiter)}>
            {TABLE_DELIMITERS.map((d) => (
              <option key={d} value={d}>
                {d === "auto" ? m("table.auto") : t(DELIMITER_NAMES[d] as "convert.comma")}
              </option>
            ))}
          </select>
        </div>
        {kind === "flowchart" && (
          <div class="field inline">
            <label for="table-direction">{m("table.direction")}</label>
            <select id="table-direction" value={direction} onChange={(e) => setDirection(e.currentTarget.value as Direction)}>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {m(`table.dir.${d}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p id="table-help">
        <strong>{m("table.help")}:</strong> {m(`table.help.${kind}`)} {m("table.helpRequired")}
      </p>
      <Field id="table-input" label={m(kind === "er" ? "table.inputEntities" : "table.input")} rows={8} value={text} onInput={(value) => setTexts({ ...texts, [kind]: value })} />
      {kind === "er" && <Field id="table-relations" label={m("table.relations")} rows={5} value={relations} onInput={setRelations} />}
      <div class="actions">
        <button type="button" class="primary" onClick={run}>
          {m("table.generate")}
        </button>
        <button
          type="button"
          disabled={text.trim() !== "" || (kind === "er" && relations.trim() !== "")}
          onClick={() => {
            const example = EXAMPLES[lang][kind];
            setTexts({ ...texts, [kind]: example.text });
            if (kind === "er") setRelations(example.relations ?? "");
          }}
        >
          {m("table.example")}
        </button>
      </div>
      <div role="alert">
        {failure && (
          <div class="box error">
            {failure instanceof TableError ? (
              <p>
                <strong>
                  {failure.table === "relations" && `${m("table.inRelations")}: `}
                  {m(`table.error.${failure.code}`, { column: failure.column ?? "", value: failure.value ?? "" })}
                </strong>
                {failure.line !== undefined && ` (${t("common.line", { line: failure.line })})`}
              </p>
            ) : (
              <p>
                <strong>{t("error.unexpected")}</strong> <span lang="en">{failure.message}</span>
              </p>
            )}
          </div>
        )}
      </div>
      <p role="status" class="ok">
        {result ? m("table.done") : ""}
      </p>
      <div aria-live="polite">
        {result && result.replaced.length > 0 && (
          <div class="box warning">
            <h2>{m("table.replaced", { count: result.replaced.length })}</h2>
            <ul>
              {result.replaced.slice(0, 50).map((r, i) => (
                <li key={i}>{m("table.replacedItem", { line: r.line, from: r.from, to: r.to })}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <Field id="table-output" label={m("table.output")} value={result?.code ?? ""} readOnly />
      <div class="actions">
        <button type="button" ref={openButton} onClick={() => (hasCode ? setAsking(true) : send())} disabled={!result}>
          {m("table.open")}
        </button>
        <CopyButton text={result?.code ?? ""} />
      </div>
      {asking && (
        <div class="box warning" role="group" aria-labelledby="table-confirm">
          <p id="table-confirm">{m("table.replace")}</p>
          <div class="actions">
            <button type="button" ref={replaceButton} onClick={send}>
              {m("table.replaceYes")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                openButton.current?.focus();
              }}
            >
              {m("table.replaceNo")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
