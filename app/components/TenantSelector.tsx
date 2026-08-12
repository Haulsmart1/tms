"use client";

import { useTenant } from "./TenantProvider";

export default function TenantSelector() {
  const { role, tenants, activeTenantId, setActiveTenantId } = useTenant();

  if (role === "staff") return null;

  return (
    <select
      aria-label="Active tenant"
      className="h-9 w-full rounded-md border border-chrome-border bg-chrome-raised px-2.5 text-sm font-medium text-chrome-text-strong shadow-xs outline-none transition-colors hover:border-line-strong focus-visible:border-primary"
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
