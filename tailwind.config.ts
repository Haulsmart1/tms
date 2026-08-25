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
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  /* The .ds reset in globals.css sits in @layer base, which Tailwind
     tree-shakes against the content scan like any other layer. With no page
     carrying class="ds" the ENTIRE reset is stripped from the compiled output,
     and it would vanish again if the class were ever applied dynamically or
     composed at runtime. That reset is load-bearing (borders, box-sizing,
     control font inheritance), so it must not depend on incidental string
     detection. Safelisting guarantees it is always emitted.

     This literal must track the wrapper class name in app/globals.css. Rename
     one without the other and the reset silently disappears again.

     From Task 9 this becomes belt-and-braces, because the landing and /login
     will carry class="ds" and the content scan will find it. Do not delete it
     then: it is the insurance for the case where the class is composed at
     runtime, which the scanner cannot see. */
  safelist: ["ds"],
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
      kicker: ["11px", { lineHeight: "16px", letterSpacing: "0.08em", fontWeight: "600" }],
      data: ["13px", { lineHeight: "18px", fontWeight: "500" }],
      "data-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
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
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)", hover: "var(--surface-hover)" },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        skeleton: "var(--skeleton)",
        chrome: {
          DEFAULT: "var(--chrome)",
          raised: "var(--chrome-raised)",
          border: "var(--chrome-border)",
          text: "var(--chrome-text)",
          "text-strong": "var(--chrome-text-strong)",
          link: "var(--chrome-link)",
        },
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)", 4: "var(--ink-4)" },
        primary: {
          DEFAULT: "var(--primary)", hover: "var(--primary-hover)",
          active: "var(--primary-active)", tint: "var(--primary-tint)",
          "tint-border": "var(--primary-tint-border)", deep: "var(--primary-deep)",
          // A literal hex ramp (primary-50..950) lived here and was removed on
          // 2026-08-13: unused by any component, and raw hex cannot follow a
          // theme swap, so anything reaching for it would have silently broken
          // under the dark default. Colours belong in app/tokens.css as
          // var()-backed keys. Do not reintroduce a hex ramp here.
        },
        // Text/icon colour for a solid fill of the matching background. White
        // in light, dark ink in dark, so a button is legible in both themes
        // without a per-theme class. See --on-primary in app/tokens.css.
        "on-primary": "var(--on-primary)",
        "on-danger": "var(--on-danger)",
        accent: { DEFAULT: "var(--accent)", text: "var(--accent-text)", tint: "var(--accent-tint)", border: "var(--accent-border)" },
        success: { DEFAULT: "var(--success)", strong: "var(--success-strong)", tint: "var(--success-tint)", border: "var(--success-border)" },
        warning: { DEFAULT: "var(--warning)", strong: "var(--warning-strong)", tint: "var(--warning-tint)", border: "var(--warning-border)" },
        danger: { DEFAULT: "var(--danger)", hover: "var(--danger-hover)", strong: "var(--danger-strong)", tint: "var(--danger-tint)", border: "var(--danger-border)" },
        focus: "var(--focus)",
      },
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "10px", lg: "14px", xl: "16px" },
      spacing: { 4.5: "18px", 13: "52px", 15: "60px" },
    },
  },
  plugins: [],
};
export default config;
