import type { Config } from "tailwindcss";

/* Classes map to the CSS variables in tokens.css, so a dark theme is a
   variable swap, no class changes. Note: text-base is 14px by design.
   Preflight is OFF so the global reset does not touch the ~15 existing
   inline-styled pages. Re-enable it during the future app-wide restyle. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  corePlugins: { preflight: false },
  theme: {
    fontFamily: {
      sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
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
