import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import AppHeader from "./components/AppHeader";
import { TenantProvider } from "./components/TenantProvider";
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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0f172a",
          color: "#0f172a",
        }}
      >
        <TenantProvider>
          <AppHeader />
          {children}
        </TenantProvider>
      </body>
    </html>
  );
}
