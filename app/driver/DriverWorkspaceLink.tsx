"use client";

import { buttonClasses } from "../../components/Button";
import { useTenant } from "../components/TenantProvider";

export default function DriverWorkspaceLink() {
  const tenant = useTenant();
  if (tenant.status === "loading") return null;
  const hasWorkspace = tenant.status === "ready";
  return <div className="ds bg-surface px-4 py-3 font-sans text-sm text-ink">
    {tenant.userEmail && <p className="mb-2 break-words">Signed in as {tenant.userEmail}</p>}
    {/* Leave the driver tab open: its unsent evidence may be held in memory. */}
    <a href={hasWorkspace ? "/warehouse" : "/login?next=%2Fwarehouse"}
      target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "sm")}>
      {hasWorkspace ? "Open Warehouse dashboard" : "Sign in to Warehouse"}
    </a>
    <p className="mt-2 text-ink-2">{hasWorkspace
      ? "Opens in a new tab. Your driver work stays open."
      : "Use your office account for Warehouse. Opens in a new tab."}</p>
  </div>;
}
