"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { buttonClasses } from "../Button";
import Container from "../Container";
import Logo from "../Logo";

const anchors = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#request-access", label: "Contact" },
];

export default function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <Container className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo variant="tile" size={24} decorative />
          <span className="text-base font-semibold text-ink">TMS Wizzard</span>
        </div>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          {anchors.map((a) => (
            <a key={a.href} href={a.href} className="text-sm text-ink-2 hover:text-ink">
              {a.label}
            </a>
          ))}
          <Link href="/login" className="text-sm font-semibold text-ink hover:text-primary">
            Sign in
          </Link>
          {/* buttonClasses on the anchor itself. Nesting a real <button> inside
              an <a> is invalid HTML and double-stops in the accessibility tree. */}
          <a href="#request-access" className={buttonClasses("primary", "md")}>
            Get started
          </a>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <a href="#request-access" className={buttonClasses("primary", "md")}>
            Get started
          </a>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-md border border-line-strong text-ink"
          >
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </Container>

      {open ? (
        <div id="mobile-nav" className="border-t border-line bg-surface md:hidden">
          <Container className="flex flex-col gap-1 py-2">
            {anchors.map((a) => (
              <a
                key={a.href}
                href={a.href}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center text-base text-ink-2"
              >
                {a.label}
              </a>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center text-base font-semibold text-ink"
            >
              Sign in
            </Link>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
