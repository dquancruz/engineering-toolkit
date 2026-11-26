import { useEffect, useMemo, useState } from "preact/hooks";
import { segments, type Match } from "../core/regex.js";
import { TIMEOUT_MS, createRunner, type Outcome, type RegexWorker } from "../core/regex-runner.js";
// Inlined so it runs from a blob: URL and inherits the page's Content-Security-Policy.
import Worker from "../regex.worker.ts?worker&inline";
import { Field, useT } from "./common.js";

const FLAGS = ["g", "i", "m", "s", "u", "y"] as const;

export function RegexTool() {
  const t = useT();
  const runner = useMemo(() => createRunner(() => new Worker() as unknown as RegexWorker), []);
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ outcome: Outcome; text: string } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (pattern === "") {
      setResult(null);
      setRunning(false);
      return;
    }
    const wait = setTimeout(() => {
      setRunning(true);
      void runner.run({ pattern, flags, text }).then((outcome) => {
        if (!outcome.ok && "superseded" in outcome) return;
        setResult({ outcome, text });
        setRunning(false);
      });
    }, 200);
    return () => clearTimeout(wait);
  }, [pattern, flags, text, runner]);

  const outcome = result?.outcome;
  const matches: Match[] = outcome?.ok ? outcome.matches : [];

  return (
    <div class="tool">
      <div class="field">
        <label for="regex-pattern">{t("regex.pattern")}</label>
        <input
          id="regex-pattern"
          type="text"
          value={pattern}
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          onInput={(e) => setPattern(e.currentTarget.value)}
        />
      </div>
      <fieldset class="actions">
        <legend>{t("regex.flags")}</legend>
        {FLAGS.map((flag) => (
          <label key={flag} class="check">
            <input
              type="checkbox"
              checked={flags.includes(flag)}
              onChange={(e) => setFlags(FLAGS.filter((f) => (f === flag ? e.currentTarget.checked : flags.includes(f))).join(""))}
            />
            {t(`flag.${flag}`)}
          </label>
        ))}
      </fieldset>
      <Field id="regex-text" label={t("regex.text")} value={text} rows={8} onInput={setText} />

      <p role="status" class="ok">
        {running ? t("regex.running") : outcome?.ok ? t("regex.matches", { count: matches.length }) : ""}
      </p>
      <div role="alert">
        {outcome && !outcome.ok && "timeout" in outcome && <p class="box error">{t("regex.timeout", { seconds: TIMEOUT_MS / 1000 })}</p>}
        {outcome && !outcome.ok && "error" in outcome && (
          <div class="box error">
            <p>
              <strong>{t("regex.invalid")}</strong>
            </p>
            <p class="detail" lang="en">
              {outcome.error}
            </p>
          </div>
        )}
      </div>
      {outcome?.ok && outcome.truncated && <p class="box warning">{t("regex.truncated", { count: matches.length })}</p>}

      {matches.length > 0 && (
        <>
          <h3 id="regex-highlight-title">{t("regex.highlight")}</h3>
          {/* each match is underlined and numbered, so it does not depend on colour */}
          <pre class="highlight" tabIndex={0} aria-labelledby="regex-highlight-title" role="region">
            {segments(result!.text, matches).map((s, i) =>
              s.match === undefined ? (
                <span key={i}>{s.text}</span>
              ) : (
                <mark key={i} class={s.match % 2 ? "odd" : "even"}>
                  {s.text === "" ? <span class="empty-match" title={t("regex.emptyMatch")}>∅</span> : s.text}
                  <sup>{s.match + 1}</sup>
                </mark>
              )
            )}
          </pre>
          <div class="scroll" tabIndex={0} role="region" aria-label={t("regex.table")}>
            <table>
              <caption>{t("regex.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("regex.number")}</th>
                  <th scope="col">{t("regex.position")}</th>
                  <th scope="col">{t("regex.value")}</th>
                  <th scope="col">{t("regex.groups")}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => (
                  <tr key={i}>
                    <th scope="row">{i + 1}</th>
                    <td>
                      {m.start}–{m.end}
                    </td>
                    <td>
                      <code>{m.value}</code>
                    </td>
                    <td>
                      {m.groups.map((g) => (
                        <div key={g.number}>
                          {g.number}
                          {g.name !== undefined && ` (${g.name})`}: {g.value === undefined ? t("regex.noGroup") : <code>{g.value}</code>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
