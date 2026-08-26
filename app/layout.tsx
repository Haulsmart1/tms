import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import AppShell from "./components/AppShell";
import ThemeScope from "./components/ThemeScope";
import { TenantProvider } from "./components/TenantProvider";
import PastDueBanner from "../components/billing/PastDueBanner";
import { THEME_SCRIPT } from "../lib/theme/themeScript";
import "./globals.css";

/* DESIGN-SYSTEM SEAM, read before editing.
   The Plex variables are declared here on <html> but deliberately NOT applied
   to <body>. <body> keeps its inline Inter and #0f172a background so the ~15
   legacy inline-styled pages stay pixel-identical. Design-system pages opt in
   on their own root element with className="ds font-sans bg-canvas text-ink".

   The two halves fail differently and neither throws: omit `font-sans` and you
   silently get Inter; omit `ds` and borders vanish and containers overflow into
   horizontal scroll, because Preflight is off and CSS defaults border-style to
   none. See the comment block in app/globals.css.

   preload is false on purpose: these are called in the ROOT layout, so Next
   would eagerly preload every weight on all ~17 routes while only the landing
   and /login ever paint Plex. display:"swap" plus next/font's metric-adjusted
   fallback keeps the swap cheap on the two routes that do use them. */
const plexSans = IBM_Plex_Sans({
  // latin covers FR/DE/ES/IT/NL/Nordic glyphs. Add "latin-ext" when the design
  // system reaches data-bearing pages (Polish, Czech, Hungarian, Romanian names).
  subsets: ["latin"],
  // No 700: the type scale tops out at semibold. Re-add it if design-system copy
  // starts using <strong>/<b>, whose UA default weight resolves to 700 and would
  // otherwise be faux-bolded from 600.
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "TMS Wizzard",
  description: "Transport Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* suppressHydrationWarning is required, not cosmetic: the inline theme
       script below mutates <html>'s className during parsing, before React
       hydrates, so the server-rendered class list and the client's differ by
       design. Without this, every load with a stored light preference logs a
       hydration error. It suppresses the warning for THIS element's attributes
       only, not for its subtree, so a genuine mismatch further down still
       surfaces. */
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          /* Hardcoded, NOT var(--canvas), deliberately. This paints behind the
             ~14 legacy inline-styled pages, which cannot follow a theme, so it
             must not change when a user switches to light. Retinted from
             #0f172a to match the new dark canvas. */
          background: "#0F1626",
          color: "#0F1626",
        }}
      >
        {/* MUST stay the first child and MUST stay synchronous. See
            lib/theme/themeScript.ts for why. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TenantProvider>
          <PastDueBanner />
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <AppShell />
            <ThemeScope>{children}</ThemeScope>
          </div>
        </TenantProvider>
      </body>
    </html>
  );
}
