/** The only things the app stores: the language and the theme. Never what the user types. */
export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const STORAGE_KEYS = { lang: "engkit-web.lang", theme: "engkit-web.theme" } as const;

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage can be disabled
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // the preference just does not persist
  }
}

export const isTheme = (v: unknown): v is Theme => (THEMES as readonly unknown[]).includes(v);
