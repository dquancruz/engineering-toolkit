import { useEffect, useRef, useState } from "preact/hooks";
import { translator } from "../i18n.js";
import { I18n } from "./common.js";
import { ConvertTool } from "./ConvertTool.js";
import { JsonTool } from "./JsonTool.js";
import { JwtTool } from "./JwtTool.js";
import { RegexTool } from "./RegexTool.js";
import { Header, Tabs, usePreferences, useTool } from "./shell.js";

export const TOOLS = ["json", "convert", "regex", "jwt"] as const;
type Tool = (typeof TOOLS)[number];

export function App() {
  const preferences = usePreferences("app.title");
  const [tool, open] = useTool(TOOLS);
  const t = translator(preferences.lang);

  return (
    <I18n.Provider value={t}>
      <Header title={t("app.title")} {...preferences}>
        <p class="nav">
          {/* ?lang= goes with the link; nothing else is ever in the address */}
          <a href={`./mermaid.html${location.search}`}>{t("app.mermaid")}</a> <span>{t("app.leave")}</span>
        </p>
      </Header>
      <main>
        <Tabs tools={TOOLS} tool={tool} open={open} label={t("app.tools")} name={(id) => t(`tab.${id}`)}>
          {(id) => (
            <>
              {id === "json" && <JsonTool />}
              {id === "convert" && <ConvertTool />}
              {id === "regex" && <RegexTool />}
              {id === "jwt" && <JwtTool lang={preferences.lang} />}
            </>
          )}
        </Tabs>
      </main>
    </I18n.Provider>
  );
}
