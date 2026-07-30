"use client";

import { useTenant } from "./TenantProvider";

const selectStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)",
  background: "#1e293b", color: "white", fontSize: 14,
};

export default function TenantSelector() {
  const { role, tenants, activeTenantId, setActiveTenantId } = useTenant();

  if (role === "staff") return null;

  return (
    <select
      aria-label="Active tenant"
      style={selectStyle}
      value={activeTenantId ?? ""}
      onChange={(e) => setActiveTenantId(e.target.value === "" ? null : e.target.value)}
    >
      <option value="">All tenants</option>
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}
