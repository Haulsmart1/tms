"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "./TenantProvider";

/* Hardcoded rather than tokenised, deliberately. This panel renders on every
   route including the legacy ones, before tenant status resolves, so it must
   not follow the light toggle: a bright full-screen flash on every load is the
   exact thing the dark default exists to prevent. Values track :root's --canvas
   and --ink in app/tokens.css; update them together. */
const panelStyle: React.CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center",
  background: "#0F1626", color: "#D6DEEC", padding: 30, textAlign: "center",
};

export default function TenantGate({ children }: { children: ReactNode }) {
  const { status } = useTenant();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/login");
  }, [status, router]);

  if (status === "loading") {
    return <div style={panelStyle}>Loading...</div>;
  }
  if (status === "signed-out") {
    return <div style={panelStyle}>Redirecting to sign in...</div>;
  }
  if (status === "no-tenant") {
    return (
      <div style={panelStyle}>
        <div>
          <h1>Account not linked to a company</h1>
          <p style={{ opacity: 0.8 }}>Ask an administrator to assign your profile to a tenant.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
