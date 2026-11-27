import { useState } from "preact/hooks";
import { translator } from "../i18n.js";
import { I18n } from "../ui/common.js";
import { Header, Tabs, usePreferences, useTool } from "../ui/shell.js";
import { DiagramTool } from "./DiagramTool.js";
import { TableTool } from "./TableTool.js";
import { Mermaid, type Editor } from "./context.js";
import { mermaidTranslator } from "./i18n.js";

const TOOLS = ["diagram", "table"] as const;

export function App() {
  const preferences = usePreferences(null, (lang) => mermaidTranslator(lang)("page.title"));
  const [tool, open] = useTool(TOOLS);
  // passed between the tools in memory only: never in the address or in storage
  const [editor, setEditor] = useState<Editor>({ code: "" });
  const m = mermaidTranslator(preferences.lang);

  return (
    <I18n.Provider value={translator(preferences.lang)}>
      <Mermaid.Provider value={m}>
        <Header title={m("page.title")} {...preferences}>
          <p class="nav">
            <a href={`./${location.search}`}>{m("page.back")}</a> <span>{m("page.leave")}</span>
          </p>
        </Header>
        <main>
          <Tabs tools={TOOLS} tool={tool} open={open} label={m("tabs.label")} name={(id) => m(`tab.${id}`)}>
            {(id) =>
              id === "diagram" ? (
                <DiagramTool editor={editor} onCode={(code) => setEditor((e) => ({ ...e, code }))} lang={preferences.lang} />
              ) : (
                <TableTool
                  lang={preferences.lang}
                  hasCode={editor.code.trim() !== ""}
                  onOpen={(code, outline) => {
                    setEditor({ code, described: { code, outline } });
                    open("diagram");
                    document.getElementById("tab-diagram")?.focus();
                  }}
                />
              )
            }
          </Tabs>
        </main>
      </Mermaid.Provider>
    </I18n.Provider>
  );
}
