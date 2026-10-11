import type { ReactNode } from "react";
import MarketingShell from "./MarketingShell";

// Presentation only. Authentication handlers, gates and redirects stay with callers.
export default function AuthSurface({ children }: { children: ReactNode }) {
  return <MarketingShell><div className="brand-auth-grid"><aside className="brand-auth-story"><p className="brand-eyebrow">TMS WIZARD / YOUR TRANSPORT OFFICE</p><h2>The work behind<br/>every delivery.</h2><p>Jobs, planning, proof of delivery and invoicing in one cloud platform. Pick up where your operation left off.</p></aside><div className="brand-auth-form">{children}</div></div></MarketingShell>;
}
