import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { SUPER_ADMIN_ROLE, extractRoleName } from "../../lib/roles";

export default async function SuperAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles ( name )")
    .eq("id", user.id)
    .single();

  if (extractRoleName(profile?.roles) !== SUPER_ADMIN_ROLE) {
    redirect("/dashboard");
  }

  const linkStyle: CSSProperties = {
    color: "white",
    textDecoration: "none",
    fontWeight: 500,
    fontSize: 14,
    opacity: 0.95,
  };

  return (
    <>
      <header
        style={{
          padding: 18,
          background: "#1e1b4b",
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
          <strong style={{ fontSize: 18 }}>⚡ Super Admin</strong>

          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Link href="/super-admin" style={linkStyle}>Overview</Link>
            <Link href="/super-admin/companies" style={linkStyle}>Companies</Link>
            <Link href="/super-admin/users" style={linkStyle}>Users</Link>
            <Link href="/super-admin/billing" style={linkStyle}>Billing</Link>
            <Link href="/super-admin/invoices" style={linkStyle}>Invoices</Link>
            <Link href="/dashboard" style={{ ...linkStyle, opacity: 0.75 }}>
              ← Back to app
            </Link>
          </div>
        </div>
      </header>

      <div>{children}</div>
    </>
  );
}
