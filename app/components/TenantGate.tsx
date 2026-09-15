"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTenant, useTenantRecovery } from "./TenantProvider";
import { isSkeletonReadyRoute } from "../../lib/nav/skeletonReadyRoutes";

/* Hardcoded rather than tokenised, deliberately. This panel renders on every
   route including the legacy ones, before tenant status resolves, so it must
   not follow the light toggle: a bright full-screen flash on every load is the
   exact thing the dark default exists to prevent. Values track :root's --canvas
   and --ink in app/tokens.css; update them together. */
const panelStyle: React.CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center",
  background: "#0F1626", color: "#D6DEEC", padding: 30, textAlign: "center",
};

const actionsStyle: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 20,
};

const buttonStyle: React.CSSProperties = {
  background: "transparent", color: "#D6DEEC", border: "1px solid #3A4A66",
  borderRadius: 6, padding: "8px 16px", font: "inherit", cursor: "pointer",
};

const linkStyle: React.CSSProperties = { ...buttonStyle, textDecoration: "none", display: "inline-block" };

/* Sign out, and where relevant retry, so nobody is stranded (AUTH-17). */
function RecoveryActions({ showRetry, showRequestAccess }: { showRetry: boolean; showRequestAccess: boolean }) {
  const { retry, signOut } = useTenantRecovery();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div style={actionsStyle}>
      {showRetry ? (
        <button type="button" style={buttonStyle} onClick={retry}>
          Try again
        </button>
      ) : null}
      {showRequestAccess ? (
        <a href="/#request-access" style={linkStyle}>
          Request access
        </a>
      ) : null}
      <button
        type="button"
        style={buttonStyle}
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
        }}
      >
        {signingOut ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}

export default function TenantGate({ children }: { children: ReactNode }) {
  const { status } = useTenant();
  const { failed, userEmail } = useTenantRecovery();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "signed-out") return;
    /* Carry the page they were on, so signing in returns them to it (AUTH-12).
       The login route re-validates next against its own origin. */
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }, [status, router]);

  /* Checked before loading: a failed first resolve used to leave the page on
     "Loading..." (or an endless skeleton) with no way to recover. */
  if (failed && (status === "loading" || status === "no-tenant")) {
    return (
      <div style={panelStyle}>
        <div>
          <h1>We could not load your account</h1>
          <p style={{ opacity: 0.8 }}>
            This is usually a connection problem, not a problem with your account.
          </p>
          <RecoveryActions showRetry showRequestAccess={false} />
        </div>
      </div>
    );
  }

  if (status === "loading") {
    /* A converted route draws its own skeleton, so blocking it here would
       replace a recognisable page with a bare panel for the two serial
       Supabase round trips TenantProvider.resolve() makes. Everything else
       still blocks, which is the safe default.

       The page behind this is responsible for not querying until status is
       "ready". See the checklist in lib/nav/skeletonReadyRoutes.ts. */
    if (isSkeletonReadyRoute(pathname)) return <>{children}</>;
    return <div style={panelStyle}>Loading...</div>;
  }
  /* Unchanged below, on every route. Only the loading case above is relaxed:
     an unauthenticated or tenant-less visitor is still blocked outright. */
  if (status === "signed-out") {
    return <div style={panelStyle}>Redirecting to sign in...</div>;
  }
  if (status === "no-tenant") {
    return (
      <div style={panelStyle}>
        <div>
          <h1>Account not linked to a company</h1>
          <p style={{ opacity: 0.8 }}>
            {userEmail ? `You are signed in as ${userEmail}. ` : ""}
            Ask an administrator at your company to add you, or request access if your company
            is not on TMS Wizzard yet.
          </p>
          <RecoveryActions showRetry showRequestAccess />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
