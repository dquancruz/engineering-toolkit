import { useEffect, useState } from "preact/hooks";
import { decodeJwt, type DecodedJwt } from "../core/jwt.js";
import { ErrorBox, Field, NoticeList, toFailure, useT, type Failure } from "./common.js";
import type { Lang } from "../i18n.js";

function relative(seconds: number, lang: Lang): string {
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
}

export function JwtTool({ lang }: { lang: Lang }) {
  const t = useT();
  const [token, setToken] = useState("");
  const [now, setNow] = useState(() => Date.now() / 1000);

  // keeps "expires in" current while the page is open
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 15_000);
    return () => clearInterval(timer);
  }, []);

  let decoded: DecodedJwt | null = null;
  let failure: Failure | null = null;
  if (token.trim() !== "") {
    try {
      decoded = decodeJwt(token, now);
    } catch (e) {
      failure = toFailure(e);
    }
  }

  return (
    <div class="tool">
      <p class="box warning">
        <strong>{t("jwt.unverified")}</strong>
      </p>
      <Field
        id="jwt-token"
        label={t("jwt.token")}
        value={token}
        rows={5}
        onInput={(value) => {
          setNow(Date.now() / 1000);
          setToken(value);
        }}
      />
      <ErrorBox failure={failure} />
      <p role="status" class={decoded?.time === "within-time" ? "ok" : "strong"}>
        {decoded ? t(`jwt.${decoded.time}`) : ""}
      </p>
      <NoticeList notices={decoded?.notices ?? []} />
      {decoded && (
        <>
          <Field id="jwt-header" label={t("jwt.header")} value={decoded.header} rows={5} readOnly />
          <Field id="jwt-payload" label={t("jwt.payload")} value={decoded.payload} rows={10} readOnly />
          {decoded.claims.length > 0 && (
            <div class="scroll" tabIndex={0} role="region" aria-label={t("jwt.times")}>
              <table>
                <caption>{t("jwt.times")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("jwt.claim")}</th>
                    <th scope="col">{t("jwt.date")}</th>
                    <th scope="col">{t("jwt.relative")}</th>
                  </tr>
                </thead>
                <tbody>
                  {decoded.claims.map((c) => (
                    <tr key={c.claim}>
                      <th scope="row">{t(`claim.${c.claim}`)}</th>
                      <td>{c.iso ?? t("jwt.invalidDate")}</td>
                      <td>{c.iso === null ? "" : relative(c.fromNow, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
