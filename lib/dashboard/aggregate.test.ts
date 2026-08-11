import { describe, it, expect } from "vitest";
import { buildNeedsAttention, buildRevenueLast7Days } from "./aggregate";

describe("buildNeedsAttention", () => {
  const now = new Date("2026-08-11T12:00:00Z");

  it("merges overdue PODs and overdue invoices, oldest first", () => {
    const items = buildNeedsAttention(
      [{ stopId: "s1", jobRef: "TMS-1", plannedAt: "2026-08-09T08:00:00Z" }],
      [{ id: "i1", invoiceNumber: "INV-1", dueDate: "2026-08-10", total: 100 }],
      now,
    );
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("pod-s1"); // planned 2 days ago, oldest
    expect(items[1].id).toBe("invoice-i1");
  });

  it("returns an empty list when nothing is overdue", () => {
    expect(buildNeedsAttention([], [], now)).toEqual([]);
  });
});

describe("buildRevenueLast7Days", () => {
  const today = new Date("2026-08-11T00:00:00Z");

  it("returns exactly 7 days, oldest first, summing same-day invoices", () => {
    const days = buildRevenueLast7Days(
      [
        { issueDate: "2026-08-11", total: 100 },
        { issueDate: "2026-08-11", total: 50 },
        { issueDate: "2026-08-05", total: 10 },
      ],
      today,
    );
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-08-11");
    expect(days[6].total).toBe(150);
    expect(days[0].date).toBe("2026-08-05");
    expect(days[0].total).toBe(10);
  });

  it("zeroes days with no paid invoices", () => {
    const days = buildRevenueLast7Days([], today);
    expect(days.every((d) => d.total === 0)).toBe(true);
  });

  it("buckets correctly even when 'today' is a realistic local time near local midnight, not a UTC-midnight test artifact", () => {
    const today = new Date(2026, 7, 11, 0, 30, 0); // local Aug 11, 00:30 — the exact scenario that broke before this fix
    const days = buildRevenueLast7Days([], today);
    expect(days[6].date).toBe("2026-08-11");
    expect(days[0].date).toBe("2026-08-05");
  });
});
