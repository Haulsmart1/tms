import type { Config } from "tailwindcss";

/* Classes map to the CSS variables in tokens.css, so a dark theme is a
   variable swap, no class changes. Note: text-base is 14px by design, and
   text-md (16px) is LARGER than text-base, so `text-md` is not a synonym for
   the default. The scale is capped at 2xl; use arbitrary values above that.
   Preflight is OFF so the global reset does not touch the ~15 existing
   inline-styled pages. Re-enable it during the future app-wide restyle.

   CONSTRAINT: the token colours are plain var() strings, so Tailwind cannot
   synthesise alpha from them. Opacity modifiers like bg-primary/10 or
   text-ink/60 compile to NOTHING, silently. Use a *-tint token instead. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  corePlugins: { preflight: false },
  theme: {
    fontFamily: {
      // Fallback INSIDE var(): if --font-sans is ever undefined, the whole
      // declaration is invalid at computed-value time and the listed
      // fallbacks never run (the property inherits instead).
      sans: ["var(--font-sans, system-ui)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono, ui-monospace)", "ui-monospace", "SFMono-Regular", "monospace"],
    },
    fontSize: {
      overline: ["11px", { lineHeight: "16px", letterSpacing: "0.06em", fontWeight: "600" }],
      xs: ["12px", "16px"],
      sm: ["13px", "18px"],
      base: ["14px", "20px"],
      md: ["16px", "24px"],
      lg: ["18px", "26px"],
      xl: ["24px", "32px"],
      "2xl": ["30px", "36px"],
    },
    boxShadow: {
      // DEFAULT is required: this object REPLACES Tailwind's shadow scale
      // rather than extending it, so without it a bare `shadow` (one of the
      // most-typed classes) emits nothing at all, silently.
      DEFAULT: "var(--shadow-sm)",
      xs: "var(--shadow-xs)", sm: "var(--shadow-sm)",
      md: "var(--shadow-md)", lg: "var(--shadow-lg)", none: "none",
    },
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)", 4: "var(--ink-4)" },
        primary: {
          DEFAULT: "var(--primary)", hover: "var(--primary-hover)",
          active: "var(--primary-active)", tint: "var(--primary-tint)",
          "tint-border": "var(--primary-tint-border)", deep: "var(--primary-deep)",
          // Literal hex ramp from the handoff. WARNING: these are NOT themed.
          // They will not change when the CSS variables swap for dark mode,
          // and 50/200/600/700/800 duplicate token values above. Prefer the
          // var()-backed keys (primary, primary-tint, primary-hover, ...).
          50: "#EEF4FF", 100: "#DFE9FE", 200: "#C5D6FD", 300: "#9DB8FB", 400: "#6C92F6",
          500: "#4470F0", 600: "#2D54DE", 700: "#2444BE", 800: "#21399A", 900: "#20337A", 950: "#16204A",
        },
        accent: { DEFAULT: "var(--accent)", text: "var(--accent-text)", tint: "var(--accent-tint)", border: "var(--accent-border)" },
        success: { DEFAULT: "var(--success)", strong: "var(--success-strong)", tint: "var(--success-tint)", border: "var(--success-border)" },
        warning: { DEFAULT: "var(--warning)", strong: "var(--warning-strong)", tint: "var(--warning-tint)", border: "var(--warning-border)" },
        danger: { DEFAULT: "var(--danger)", hover: "var(--danger-hover)", strong: "var(--danger-strong)", tint: "var(--danger-tint)", border: "var(--danger-border)" },
        focus: "var(--focus)",
      },
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "8px", lg: "12px", xl: "16px" },
      spacing: { 4.5: "18px", 13: "52px", 15: "60px" },
    },
  },
  plugins: [],
};
export default config;
