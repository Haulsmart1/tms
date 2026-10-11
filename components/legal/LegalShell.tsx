import type { ReactNode } from "react";
import MarketingShell from "../landing/MarketingShell";
export default function LegalShell({ children }: { children: ReactNode }) {
  return <MarketingShell><div className="brand-legal">{children}</div></MarketingShell>;
}
