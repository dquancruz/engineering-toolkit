import { useEffect, useRef, useState } from "preact/hooks";
import { LANGS, resolveLang, translator, type Lang } from "../i18n.js";
import { STORAGE_KEYS, THEMES, isTheme, load, save, type Theme } from "../preferences.js";
import { I18n } from "./common.js";
import { ConvertTool } from "./ConvertTool.js";
import { JsonTool } from "./JsonTool.js";
import { JwtTool } from "./JwtTool.js";
import { RegexTool } from "./RegexTool.js";

export const TOOLS = ["json", "convert", "regex", "jwt"] as const;
type Tool = (typeof TOOLS)[number];

/** The URL only ever carries the tool's name (and ?lang=), never what is typed. */
const toolFromHash = (): Tool => TOOLS.find((id) => `#${id}` === location.hash) ?? "json";

export function App() {
  const [lang, setLang] = useState<Lang>(() => resolveLang(location.search, load(STORAGE_KEYS.lang)));
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = load(STORAGE_KEYS.theme);
    return isTheme(saved) ? saved : "auto";
  });
  const [tool, setTool] = useState<Tool>(toolFromHash);
  const tabs = useRef(new Map<Tool, HTMLButtonElement>());
  const t = translator(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("app.title");
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);
  useEffect(() => {
    const follow = () => setTool(toolFromHash());
    addEventListener("hashchange", follow);
    return () => removeEventListener("hashchange", follow);
  }, []);

  const open = (id: Tool) => {
    setTool(id);
    history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
  };

  /** Keyboard pattern of the ARIA tabs: arrows, Home and End move and select. */
  const onKeyDown = (event: KeyboardEvent) => {
    const at = TOOLS.indexOf(tool);
    const next = {
      ArrowRight: (at + 1) % TOOLS.length,
      ArrowLeft: (at + TOOLS.length - 1) % TOOLS.length,
      Home: 0,
      End: TOOLS.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    open(TOOLS[next]!);
    tabs.current.get(TOOLS[next]!)?.focus();
  };

  return (
    <I18n.Provider value={t}>
      <header>
        <div>
          <h1>{t("app.title")}</h1>
          <p>{t("app.privacy")}</p>
        </div>
        <div class="actions">
          <div class="field inline">
            <label for="lang">{t("app.language")}</label>
            <select
              id="lang"
              value={lang}
              onChange={(e) => {
                const value = e.currentTarget.value as Lang;
                save(STORAGE_KEYS.lang, value);
                setLang(value);
                // an old ?lang= would win over the new choice on reload
                history.replaceState(null, "", `${location.pathname}${location.hash}`);
              }}
            >
              {LANGS.map((l) => (
                <option key={l} value={l} lang={l}>
                  {l === "es" ? "Español" : "English"}
                </option>
              ))}
            </select>
          </div>
          <div class="field inline">
            <label for="theme">{t("app.theme")}</label>
            <select
              id="theme"
              value={theme}
              onChange={(e) => {
                const value = e.currentTarget.value as Theme;
                save(STORAGE_KEYS.theme, value);
                setTheme(value);
              }}
            >
              {THEMES.map((v) => (
                <option key={v} value={v}>
                  {t(`theme.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main>
        <div role="tablist" aria-label={t("app.tools")} onKeyDown={onKeyDown}>
          {TOOLS.map((id) => (
            <button
              type="button"
              role="tab"
              key={id}
              id={`tab-${id}`}
              aria-selected={tool === id}
              aria-controls={`panel-${id}`}
              tabIndex={tool === id ? 0 : -1}
              ref={(el) => {
                if (el) tabs.current.set(id, el);
              }}
              onClick={() => open(id)}
            >
              {t(`tab.${id}`)}
            </button>
          ))}
        </div>
        {/* every panel stays mounted, so switching tabs keeps what was typed (only in memory) */}
        {TOOLS.map((id) => (
          <section role="tabpanel" key={id} id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tool !== id}>
            {id === "json" && <JsonTool />}
            {id === "convert" && <ConvertTool />}
            {id === "regex" && <RegexTool />}
            {id === "jwt" && <JwtTool lang={lang} />}
          </section>
        ))}
      </main>
    </I18n.Provider>
  );
}
