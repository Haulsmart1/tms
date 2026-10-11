"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { buttonClasses } from "../Button";
import Container from "../Container";
import { Wordmark } from "./Brand";

const links = [{ href: "/features", label: "Features" }, { href: "/#pricing", label: "Pricing" }, { href: "/guides/choosing-transport-management-software", label: "Guide" }, { href: "/contact", label: "Contact" }];
export default function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  return <header className="brand-nav sticky top-0 z-20" onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); toggleRef.current?.focus(); } }}>
    <Container className="flex items-center justify-between gap-3">
      <Wordmark />
      <nav className="hidden items-center gap-5 lg:flex" aria-label="Main">{links.map(link => <Link href={link.href} key={link.href} className="text-sm text-ink-2 hover:text-ink">{link.label}</Link>)}<Link href="/login" prefetch={false} className="text-sm font-semibold">Sign in</Link><Link href="/contact" className={buttonClasses("primary", "md")}>Talk to the team</Link></nav>
      <button ref={toggleRef} type="button" className="grid h-11 w-11 place-items-center rounded-md border border-line-strong lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(value => !value)}>{open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}</button>
    </Container>
    {open ? <nav id="mobile-nav" className="border-t border-line bg-surface lg:hidden" aria-label="Mobile main"><Container className="flex flex-col gap-1 py-3">{links.map(link => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center text-base">{link.label}</Link>)}<Link href="/login" prefetch={false} onClick={() => setOpen(false)} className="flex min-h-11 items-center font-semibold">Sign in</Link><Link href="/contact" onClick={() => setOpen(false)} className={buttonClasses("primary", "lg", "mt-2")}>Talk to the team</Link></Container></nav> : null}
  </header>;
}
