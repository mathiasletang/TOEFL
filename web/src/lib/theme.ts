import { useEffect, useState } from "react";

/** Light or dark, remembered per profile in localStorage. web/index.html applies it before the first render. */
export type Theme = "light" | "dark";

const key = (user: string) => `toefl.theme.${user}`;
const LAST = "toefl.theme.last";
const EVENT = "toefl-theme";

export function readTheme(user: string | null): Theme {
  try {
    const v = localStorage.getItem(user ? key(user) : LAST);
    return v === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(LAST, theme);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

export function saveTheme(user: string, theme: Theme) {
  try {
    localStorage.setItem(key(user), theme);
  } catch {
    /* storage unavailable: the choice lasts until the page is reloaded */
  }
  applyTheme(theme);
}

/** Current theme, kept in sync between the header switch and the Settings switch. */
export function useTheme(user: string): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [theme, (t) => saveTheme(user, t)];
}
