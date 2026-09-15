import { describe, expect, it } from "vitest";
import { operatorDay } from "../time";
import {
  buildRevenueForDays,
  isCollectableInvoiceStatus,
  lastNDayKeys,
  NON_COLLECTABLE_STATUS_FILTER,
} from "./days";

describe("lastNDayKeys", () => {
  it("returns calendar days ending today, oldest first", () => {
    expect(lastNDayKeys("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("is not shifted by the October clock change", () => {
    expect(lastNDayKeys("2026-10-26", 3)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  it("rejects a malformed key", () => {
    expect(() => lastNDayKeys("26/10/2026", 2)).toThrow(RangeError);
  });
});

describe("operator today (SET-14)", () => {
  it("is already the new day at 00:30 BST, while the UTC date is still yesterday", () => {
    const halfPastMidnightBst = new Date("2026-07-14T23:30:00Z");
    expect(halfPastMidnightBst.toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(operatorDay(halfPastMidnightBst)).toBe("2026-07-15");
  });
});

describe("buildRevenueForDays", () => {
  it("sums paid invoices per day key and labels weekdays", () => {
    const days = buildRevenueForDays(
      [
        { issueDate: "2026-09-14", total: 10 },
        { issueDate: "2026-09-14", total: 5 },
        { issueDate: "2026-09-01", total: 99 },
      ],
      ["2026-09-13", "2026-09-14"],
    );
    expect(days).toEqual([
      { date: "2026-09-13", label: "Sun", total: 0 },
      { date: "2026-09-14", label: "Mon", total: 15 },
    ]);
  });
});

describe("isCollectableInvoiceStatus", () => {
  it("excludes paid, void, credited, cancelled and draft", () => {
    for (const status of ["paid", "void", "credited", "cancelled", "draft", "VOID"]) {
      expect(isCollectableInvoiceStatus(status)).toBe(false);
    }
    expect(isCollectableInvoiceStatus("sent")).toBe(true);
    expect(isCollectableInvoiceStatus("overdue")).toBe(true);
    expect(isCollectableInvoiceStatus(null)).toBe(false);
  });

  it("builds the PostgREST in-list", () => {
    expect(NON_COLLECTABLE_STATUS_FILTER).toBe("(paid,void,credited,cancelled,canceled,draft)");
  });
});
