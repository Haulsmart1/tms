/* Dark is the default and the fallback, deliberately. This app is used in dim
   control rooms, so an unreadable storage value must degrade to dark, never to
   a bright screen. See docs/superpowers/specs/2026-08-13-dark-default-theme-design.md */

export type Theme = "dark" | "light";

/** The localStorage key. Must stay in sync with THEME_SCRIPT in ./themeScript.ts. */
export const STORAGE_KEY = "tms-theme";

export function normalizeTheme(value: string | null): Theme {
  return value === "light" ? "light" : "dark";
}
