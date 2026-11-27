/** What the two pages share: the language and theme preferences, the header and the tabs. */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { LANGS, resolveLang, translator, type Lang } from "../i18n.js";
import { STORAGE_KEYS, THEMES, isTheme, load, save, type Theme } from "../preferences.js";

export function usePreferences(titleKey: "app.title" | null, title?: (lang: Lang) => string) {
  const [lang, setLang] = useState<Lang>(() => resolveLang(location.search, load(STORAGE_KEYS.lang)));
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = load(STORAGE_KEYS.theme);
    return isTheme(saved) ? saved : "auto";
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = titleKey ? translator(lang)(titleKey) : title!(lang);
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  return {
    lang,
    theme,
    changeLang(value: Lang) {
      save(STORAGE_KEYS.lang, value);
      setLang(value);
      // an old ?lang= would win over the new choice on reload
      history.replaceState(null, "", `${location.pathname}${location.hash}`);
    },
    changeTheme(value: Theme) {
      save(STORAGE_KEYS.theme, value);
      setTheme(value);
    },
  };
}

type HeaderProps = ReturnType<typeof usePreferences> & { title: string; children?: ComponentChildren };

export function Header({ title, lang, theme, changeLang, changeTheme, children }: HeaderProps) {
  const t = translator(lang);
  return (
    <header>
      <div>
        <h1>{title}</h1>
        <p>{t("app.privacy")}</p>
        {children}
      </div>
      <div class="actions">
        <div class="field inline">
          <label for="lang">{t("app.language")}</label>
          <select id="lang" value={lang} onChange={(e) => changeLang(e.currentTarget.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l} lang={l}>
                {l === "es" ? "Español" : "English"}
              </option>
            ))}
          </select>
        </div>
        <div class="field inline">
          <label for="theme">{t("app.theme")}</label>
          <select id="theme" value={theme} onChange={(e) => changeTheme(e.currentTarget.value as Theme)}>
            {THEMES.map((v) => (
              <option key={v} value={v}>
                {t(`theme.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}

/** The open tool. The URL only ever carries its name (and ?lang=), never what is typed. */
export function useTool<T extends string>(tools: readonly T[]) {
  const fromHash = (): T => tools.find((id) => `#${id}` === location.hash) ?? tools[0]!;
  const [tool, setTool] = useState<T>(fromHash);
  useEffect(() => {
    const follow = () => setTool(fromHash());
    addEventListener("hashchange", follow);
    return () => removeEventListener("hashchange", follow);
  }, []);
  const open = (id: T) => {
    setTool(() => id);
    history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
  };
  return [tool, open] as const;
}

interface TabsProps<T extends string> {
  tools: readonly T[];
  tool: T;
  open: (id: T) => void;
  label: string;
  name: (id: T) => string;
  children: (id: T) => ComponentChildren;
}

export function Tabs<T extends string>({ tools, tool, open, label, name, children }: TabsProps<T>) {
  const tabs = useRef(new Map<T, HTMLButtonElement>());

  /** Keyboard pattern of the ARIA tabs: arrows, Home and End move and select. */
  const onKeyDown = (event: KeyboardEvent) => {
    const at = tools.indexOf(tool);
    const next = {
      ArrowRight: (at + 1) % tools.length,
      ArrowLeft: (at + tools.length - 1) % tools.length,
      Home: 0,
      End: tools.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    open(tools[next]!);
    tabs.current.get(tools[next]!)?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tools.map((id) => (
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
            {name(id)}
          </button>
        ))}
      </div>
      {/* every panel stays mounted, so switching tabs keeps what was typed (only in memory) */}
      {tools.map((id) => (
        <section role="tabpanel" key={id} id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tool !== id}>
          {children(id)}
        </section>
      ))}
    </>
  );
}
