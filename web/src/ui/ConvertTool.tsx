import { useState } from "preact/hooks";
import { FORMATS, convert, type Format } from "../core/convert.js";
import { DELIMITERS, type Delimiter } from "../core/formats/csv.js";
import type { Notice } from "../core/notice.js";
import { CopyButton, ErrorBox, Field, NoticeList, toFailure, useT, type Failure } from "./common.js";

const DELIMITER_NAMES = { ",": "convert.comma", ";": "convert.semicolon", "\t": "convert.tab" } as const;

export function ConvertTool() {
  const t = useT();
  const [from, setFrom] = useState<Format>("json");
  const [to, setTo] = useState<Format>("yaml");
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState(false);

  const run = () => {
    setFailure(null);
    try {
      const result = convert(from, to, input, { delimiter });
      setOutput(result.text);
      setNotices(result.notices);
      setDone(true);
    } catch (e) {
      setOutput("");
      setNotices([]);
      setDone(false);
      setFailure(toFailure(e));
    }
  };

  const select = (id: string, label: string, value: Format, change: (f: Format) => void) => (
    <div class="field inline">
      <label for={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => change(e.currentTarget.value as Format)}>
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {f.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div class="tool">
      <div class="actions">
        {select("convert-from", t("convert.from"), from, setFrom)}
        {select("convert-to", t("convert.to"), to, setTo)}
        <button
          type="button"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          {t("convert.swap")}
        </button>
        {(from === "csv" || to === "csv") && (
          <div class="field inline">
            <label for="convert-delimiter">{t("convert.delimiter")}</label>
            <select id="convert-delimiter" value={delimiter} onChange={(e) => setDelimiter(e.currentTarget.value as Delimiter)}>
              {DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {t(DELIMITER_NAMES[d])}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <Field id="convert-input" label={t("common.input")} value={input} onInput={setInput} />
      <div class="actions">
        <button type="button" class="primary" onClick={run}>
          {t("convert.run")}
        </button>
      </div>
      <ErrorBox failure={failure} />
      <p role="status" class="ok">
        {done ? t("convert.done") : ""}
      </p>
      <NoticeList notices={notices} />
      <Field id="convert-output" label={t("common.output")} value={output} readOnly />
      <div class="actions">
        <CopyButton text={output} />
      </div>
    </div>
  );
}
