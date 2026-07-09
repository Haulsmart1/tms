"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "../../lib/supabase/browser";
import { SUPER_ADMIN_ROLE, extractRoleName } from "../../lib/roles";

type MenuStatus = "loading" | "signed-out" | "tenant" | "super-admin";

const linkStyle: CSSProperties = {
  color: "white",
  textDecoration: "none",
  fontWeight: 500,
  fontSize: 14,
  opacity: 0.95,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  gap: 18,
  alignItems: "center",
  flexWrap: "wrap",
};

const superAdminLinkStyle: CSSProperties = {
  color: "white",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: 14,
  padding: "4px 10px",
  borderRadius: 8,
  background: "#7c3aed",
};

export default function AppHeader() {
  const pathname = usePathname();
  const [status, setStatus] = useState<MenuStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) setStatus("signed-out");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("roles ( name )")
        .eq("id", user.id)
        .single();

      const roleName = extractRoleName(data?.roles);

      if (!cancelled) {
        setStatus(roleName === SUPER_ADMIN_ROLE ? "super-admin" : "tenant");
      }
    }

    loadRole();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (pathname === "/" || pathname.startsWith("/super-admin")) {
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

          {status === "super-admin" ? (
            <Link href="/super-admin" style={superAdminLinkStyle}>
              ⚡ Super Admin
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
