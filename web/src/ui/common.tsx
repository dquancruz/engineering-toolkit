import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import { CoreError, type Notice } from "../core/notice.js";
import { translator, type MessageKey, type Translate } from "../i18n.js";

export const I18n = createContext<Translate>(translator("es"));
export const useT = () => useContext(I18n);

interface FieldProps {
  id: string;
  label: string;
  value: string;
  rows?: number;
  readOnly?: boolean;
  onInput?: (value: string) => void;
}

/** A text area. Spell checking is off: some browsers send the text to an online service to do it. */
export function Field({ id, label, value, rows = 12, readOnly, onInput }: FieldProps) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        readOnly={readOnly ?? false}
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        data-gramm="false"
        onInput={(e) => onInput?.(e.currentTarget.value)}
      />
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [state, setState] = useState<MessageKey>("common.copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("common.copied");
    } catch {
      setState("common.copyFailed");
    }
    setTimeout(() => setState("common.copy"), 2000);
  };
  return (
    <button type="button" onClick={copy} disabled={text === ""}>
      <span aria-live="polite">{t(state)}</span>
    </button>
  );
}

export interface Failure {
  code: MessageKey;
  line?: number | undefined;
  column?: number | undefined;
  detail?: string | undefined;
}

export function toFailure(error: unknown): Failure {
  if (error instanceof CoreError) {
    return { code: `error.${error.code}`, line: error.line, column: error.column, detail: error.detail };
  }
  return { code: "error.unexpected", detail: error instanceof Error ? error.message : String(error) };
}

export function ErrorBox({ failure }: { failure: Failure | null }) {
  const t = useT();
  if (!failure) return <div role="alert" />;
  const where = [
    failure.line === undefined ? null : t("common.line", { line: failure.line }),
    failure.column === undefined ? null : t("common.column", { column: failure.column }),
  ].filter(Boolean);
  return (
    <div role="alert" class="box error">
      <p>
        <strong>{t(failure.code)}</strong>
        {where.length > 0 && ` (${where.join(", ")})`}
      </p>
      {failure.detail && (
        <p class="detail" lang="en">
          <span>{t("common.technical")}: </span>
          {failure.detail}
        </p>
      )}
    </div>
  );
}

export function NoticeList({ notices }: { notices: Notice[] }) {
  const t = useT();
  return (
    <div aria-live="polite">
      {notices.length > 0 && (
        <div class="box warning">
          <h3>
            {t("common.notices")} ({notices.length})
          </h3>
          <ul>
            {notices.slice(0, 50).map((n) => (
              <li key={`${n.code} ${n.path ?? ""}`}>
                {t(`notice.${n.code}`)}
                {n.path !== undefined && <code> {t("common.at", { path: n.path })}</code>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
