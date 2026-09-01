// Display helpers for the billing page. No money maths lives here; that is
// lib/billing/money.ts. Kept in lib/ so vitest reaches it.

export type BillingStatus = "active" | "past_due" | "canceled";

/* A subset of components/Badge's Tone. Declared here rather than imported so
   this module stays free of component imports; the subset is assignable to
   Badge's `tone` prop at the call site. */
export type BadgeTone = "success" | "danger" | "warning" | "neutral";

/* Parses a YYYY-MM-DD cycle date as LOCAL midnight before formatting. A bare
   `new Date("2026-10-01")` parses as UTC midnight, which in a negative-offset
   timezone (anywhere west of Greenwich) formats as the previous day. The
   T00:00:00 suffix is the /drivers page's existing pattern for the same
   problem. Not covered by a unit test: vitest pins TZ=Europe/London, where
   the bug cannot reproduce. Do not remove the suffix on the strength of the
   tests passing. */
export function formatCycleDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-GB");
}

export function billingStatusBadge(
  status: BillingStatus | null | undefined
): { tone: BadgeTone; label: string } {
  switch (status) {
    case "active":
      return { tone: "success", label: "Active" };
    case "past_due":
      return { tone: "danger", label: "Past due" };
    case "canceled":
      return { tone: "warning", label: "Cancelled" };
    default:
      return { tone: "neutral", label: "Not set up" };
  }
}
