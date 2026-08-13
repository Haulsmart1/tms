"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { normalizeTheme, STORAGE_KEY, type Theme } from "../../lib/theme/theme";

/* Per device, not per user, and deliberately so: a control-room machine is
   shared across shifts, and the right theme is a property of the room's
   lighting rather than of whoever is signed in. It is also the only store
   readable before first paint (see lib/theme/themeScript.ts); a value in the
   Supabase profile would need a round trip and would flash on every load. */
export default function ThemeToggle() {
  // Always "dark" on the server and on first client render, matching what
  // :root produces, so hydration cannot mismatch. The effect then corrects the
  // icon for a user who has chosen light. Only the ICON settles a frame late;
  // the theme itself was already correct before paint, via the inline script.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    // Read the same store the inline script read, through the same normalizer,
    // so there is one canonical interpretation of what is in storage.
    try {
      setTheme(normalizeTheme(localStorage.getItem(STORAGE_KEY)));
    } catch {
      setTheme("dark");
    }
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("light", next === "light");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode can refuse writes. The theme still changes for this
      // session; it just will not be remembered. Not worth surfacing.
    }
    setTheme(next);
  }

  const goingTo = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${goingTo} theme`}
      title={`Switch to ${goingTo} theme`}
      className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-chrome-border bg-chrome-raised text-chrome-text shadow-xs transition-colors hover:border-line-strong hover:text-chrome-text-strong"
    >
      {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}
