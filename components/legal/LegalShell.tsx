import type { ReactNode } from "react";
import Link from "next/link";
import { buttonClasses } from "../Button";
import Container from "../Container";
import Logo from "../Logo";
import Footer from "../landing/Footer";
import { LEGAL_INDEX_PATH } from "../../lib/legal/routes";

/* The frame around every policy page and the /legal index: a slim header, a
   <main> landmark and the landing footer. A server component with no client
   JavaScript of its own, so a legal document is plain HTML.

   `light` pins the public palette exactly as app/page.tsx does, and for the
   same reason: these are read by prospects, customers' drivers and delivery
   recipients, not by an operator in a dim control room. `ds` and `font-sans`
   are both load-bearing (Preflight is off; see app/layout.tsx).

   LandingNav is not reused because its links are in-page anchors (#features,
   #pricing) that only exist on the landing page.

   The skip link and the <main id> exist because the Accessibility Statement
   published through this shell lists "no skip to main content link" as a known
   gap elsewhere. The statement's own page should not share it. */
export default function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="ds light min-h-screen w-full bg-canvas font-sans text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-md"
      >
        Skip to main content
      </a>

      <header className="border-b border-line bg-surface print:hidden">
        <Container className="flex h-14 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2" aria-label="TMS Wizzard home">
            <Logo variant="tile" size={24} decorative />
            <span className="text-base font-semibold text-ink">TMS Wizzard</span>
          </Link>
          <nav className="flex items-center gap-4 sm:gap-6" aria-label="Main">
            <Link href={LEGAL_INDEX_PATH} className="hidden text-sm text-ink-2 hover:text-ink sm:inline">
              All policies
            </Link>
            <Link href="/login" className="text-sm font-semibold text-ink hover:text-primary">
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses("primary", "md")}>
              Get started
            </Link>
          </nav>
        </Container>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>

      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}
