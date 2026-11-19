import { useTheme } from "../lib/theme";
import { IconMoon, IconSun } from "./icons";

/** Light / dark switch, remembered per profile. Used in the header and in Settings. */
export function ThemeToggle({ user, withLabel }: { user: string; withLabel?: boolean }) {
  const [theme, setTheme] = useTheme(user);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={`btn ${withLabel ? "" : "w-11 px-0"}`}
    >
      {dark ? <IconMoon /> : <IconSun />}
      {withLabel && <span>{dark ? "Dark" : "Light"}</span>}
    </button>
  );
}
