import { podAgeHours } from "../pod/overdue";

export type AttentionItem = {
  id: string;
  title: string;
  meta: string;
  ageHours: number;
  href: string;
};

export function buildNeedsAttention(
  overduePods: { stopId: string; jobRef: string; plannedAt: string }[],
  overdueInvoices: { id: string; invoiceNumber: string; dueDate: string; total: number }[],
  now: Date,
): AttentionItem[] {
  const podItems: AttentionItem[] = overduePods.map((p) => ({
    id: `pod-${p.stopId}`,
    title: `${p.jobRef} — POD awaiting`,
    meta: `since ${new Date(p.plannedAt).toLocaleDateString("en-GB")}`,
    // Shared with /pod so the two pages cannot disagree. Non-null asserted
    // because the caller filters null planned_at before mapping (see
    // app/dashboard/page.tsx and isAwaitingPod).
    ageHours: podAgeHours(p.plannedAt, now)!,
    href: "/pod",
  }));
  const invoiceItems: AttentionItem[] = overdueInvoices.map((i) => ({
    id: `invoice-${i.id}`,
    title: `${i.invoiceNumber} — overdue`,
    meta: `£${i.total.toFixed(2)} · due ${new Date(i.dueDate).toLocaleDateString("en-GB")}`,
    ageHours: (now.getTime() - new Date(i.dueDate).getTime()) / 36e5,
    href: "/invoices",
  }));
  return [...podItems, ...invoiceItems].sort((a, b) => b.ageHours - a.ageHours);
}

export type RevenueDay = { date: string; label: string; total: number };

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildRevenueLast7Days(
  paidInvoices: { issueDate: string; total: number }[],
  today: Date,
): RevenueDay[] {
  const days: RevenueDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const total = paidInvoices
      .filter((inv) => inv.issueDate === key)
      .reduce((sum, inv) => sum + inv.total, 0);
    days.push({ date: key, label: d.toLocaleDateString("en-GB", { weekday: "short" }), total });
  }
  return days;
}
