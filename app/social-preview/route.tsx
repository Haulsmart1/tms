import { ImageResponse } from "next/og";
export const dynamic = "force-static";

// Code-native artwork: no remote image, font, customer data or invented rating.
export function GET() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#14292e", color: "#f6f5ef", padding: 64 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", alignItems: "center", gap: 18 }}><svg width="52" height="52" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#2953e3"/><circle cx="13" cy="35" r="5" fill="#fff"/><path d="M13 35 C13 21.5 21 13.5 31 13.5" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"/><polygon points="29,6.5 41,13.5 29,20.5" fill="#fff"/></svg><span style={{ fontSize: 34 }}>TMS Wizard</span></div><span style={{ fontSize: 17, color: "#b6ceff", letterSpacing: 2 }}>BUILT FOR UK HAULAGE</span></div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3 }}><span>Every job. Every handover.</span><span style={{ color: "#d6e7a5" }}>One connected operation.</span></div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #526368", paddingTop: 24, fontSize: 21, color: "#ccd7d8" }}><span>Jobs → Proof of delivery → Invoicing</span><span>tmswizard.cloud</span></div>
    </div>,
    { width: 1200, height: 630 },
  );
}
