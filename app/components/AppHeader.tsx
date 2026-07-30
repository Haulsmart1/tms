"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant } from "./TenantProvider";
import TenantSelector from "./TenantSelector";

const linkStyle: CSSProperties = {
  color: "white", textDecoration: "none", fontWeight: 500, fontSize: 14, opacity: 0.95,
};

const sectionStyle: CSSProperties = {
  display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap",
};

const superAdminLinkStyle: CSSProperties = {
  color: "white", textDecoration: "none", fontWeight: 600, fontSize: 14,
  padding: "4px 10px", borderRadius: 8, background: "#7c3aed",
};

export default function AppHeader() {
  const pathname = usePathname();
  const { status, role } = useTenant();

  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return null;
  }
  if (status === "loading" || status === "signed-out") {
    return null;
  }

  return (
    <header
      style={{
        padding: 18,
        background: "#0f172a",
        color: "white",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 18 }}>TMS Wizzard</strong>

        <div style={sectionStyle}>
          <Link href="/dashboard" style={linkStyle}>Dashboard</Link>
          <Link href="/stats" style={linkStyle}>Stats</Link>
          <Link href="/jobs" style={linkStyle}>Jobs</Link>
          <Link href="/pod" style={linkStyle}>POD</Link>
          <Link href="/invoices" style={linkStyle}>Invoices</Link>
          <Link href="/customers" style={linkStyle}>Customers</Link>
          <Link href="/subcontractors" style={linkStyle}>Subcontractors</Link>
          <Link href="/vehicles" style={linkStyle}>Vehicles</Link>
          <Link href="/drivers" style={linkStyle}>Drivers</Link>
          <Link href="/tracking" style={linkStyle}>Tracking</Link>
          <Link href="/assets" style={linkStyle}>Assets</Link>
          <Link href="/tachograph" style={linkStyle}>Tachograph</Link>
          <Link href="/telematics" style={linkStyle}>Telematics</Link>
          <Link href="/maintenance" style={linkStyle}>Maintenance</Link>
          <Link href="/settings" style={linkStyle}>Settings</Link>

          <TenantSelector />
          {role === "super_admin" ? (
            <Link href="/super-admin" style={superAdminLinkStyle}>
              ⚡ Super Admin
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
