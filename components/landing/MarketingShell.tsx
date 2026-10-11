import type { ReactNode } from "react";
import LandingNav from "./LandingNav";
import Footer from "./Footer";
import "./brand.css";

export default function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="ds light tms-brand min-h-screen w-full bg-canvas font-sans text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-md focus:bg-surface focus:p-3 focus:text-ink">
        Skip to main content
      </a>
      <LandingNav />
      <main id="main" tabIndex={-1} className="outline-none">{children}</main>
      <Footer />
    </div>
  );
}
