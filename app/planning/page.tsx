"use client";

import TenantGate from "../components/TenantGate";

export default function PlanningPage() {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <div className="p-6">
          <h1 className="text-xl font-semibold">Planning</h1>
          <p className="mt-2 text-sm text-ink-3">Route planning is being built.</p>
        </div>
      </div>
    </TenantGate>
  );
}
