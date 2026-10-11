import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "../Logo";

export function Wordmark() {
  return <Link href="/" className="brand-wordmark" aria-label="TMS Wizard home"><Logo size={34} decorative /><span>TMS Wizard<small>TRANSPORT MANAGEMENT</small></span></Link>;
}
export function SectionHeading({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return <div className="brand-section-heading"><p className="brand-eyebrow">{label}</p><h2>{title}</h2>{children ? <div className="brand-lead">{children}</div> : null}</div>;
}
export function PageIntro({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return <header className="brand-page-intro"><p className="brand-eyebrow">{label}</p><h1>{title}</h1><div className="brand-lead">{children}</div></header>;
}
