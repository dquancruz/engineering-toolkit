import { useState } from "preact/hooks";
import { parseJson, printJson, type JsonNode } from "../core/json.js";
import { Notices, type Notice } from "../core/notice.js";
import { toTypeScript, toZod } from "../core/typegen.js";
import { CopyButton, ErrorBox, Field, NoticeList, toFailure, useT, type Failure } from "./common.js";

const ACTIONS = ["prettify", "minify", "validate", "types", "zod"] as const;
type Action = (typeof ACTIONS)[number];

export function JsonTool() {
  const t = useT();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [valid, setValid] = useState(false);

  const run = (action: Action) => {
    setFailure(null);
    setValid(false);
    try {
      const { node, duplicates } = parseJson(input);
      const found = new Notices();
      for (const path of duplicates) found.add("duplicate-key", path);
      const print: Record<Action, (n: JsonNode) => string> = {
        prettify: (n) => printJson(n, 2),
        minify: (n) => printJson(n, 0),
        validate: () => "",
        types: (n) => toTypeScript(n, found),
        zod: (n) => toZod(n, found),
      };
      setOutput(print[action](node));
      setNotices(found.list());
      setValid(action === "validate");
    } catch (e) {
      setOutput("");
      setNotices([]);
      setFailure(toFailure(e));
    }
  };

  return (
    <div class="tool">
      <Field id="json-input" label={t("common.input")} value={input} onInput={setInput} />
      <div class="actions" role="group" aria-label={t("json.actions")}>
        {ACTIONS.map((action) => (
          <button type="button" key={action} onClick={() => run(action)}>
            {t(`json.${action}`)}
          </button>
        ))}
      </div>
      <ErrorBox failure={failure} />
      <p role="status" class="ok">
        {valid ? t("json.valid") : ""}
      </p>
      <NoticeList notices={notices} />
      <Field id="json-output" label={t("common.output")} value={output} readOnly />
      <div class="actions">
        <CopyButton text={output} />
      </div>
    </div>
  );
}
