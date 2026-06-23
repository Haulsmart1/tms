import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";

export default function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
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

  return (
    <>
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
          </div>
        </div>
      </header>

      <main>{children}</main>
    </>
  );
}
