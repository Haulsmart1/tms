import { describe, expect, it } from "vitest";
import { addCalendarDays, isOverdue, isValidYmd, operatorToday } from "./dates";

describe("operatorToday", () => {
  it("is the London day, not the UTC day, just after midnight in BST", () => {
    /* 23:30 UTC on 30 June is 00:30 BST on 1 July. */
    expect(operatorToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(new Date("2026-06-30T23:30:00Z").toISOString().slice(0, 10)).toBe("2026-06-30");
  });
});

describe("addCalendarDays", () => {
  it("does calendar arithmetic that DST and month ends cannot shift", () => {
    expect(addCalendarDays("2026-10-24", 14)).toBe("2026-11-07");
    expect(addCalendarDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addCalendarDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-01-05", -10)).toBe("2025-12-26");
  });

  it("returns null for invalid dates or fractional days", () => {
    expect(addCalendarDays("2026-13-01", 1)).toBeNull();
    expect(addCalendarDays("2026-02-30", 1)).toBeNull();
    expect(addCalendarDays("14/09/2026", 1)).toBeNull();
    expect(addCalendarDays("2026-09-14", 1.5)).toBeNull();
  });
});

describe("isOverdue", () => {
  it("is overdue only after the due date", () => {
    expect(isOverdue("2026-09-13", "2026-09-14")).toBe(true);
    expect(isOverdue("2026-09-14", "2026-09-14")).toBe(false);
    expect(isOverdue(null, "2026-09-14")).toBe(false);
    expect(isOverdue("not a date", "2026-09-14")).toBe(false);
  });
});

describe("isValidYmd", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isValidYmd("2026-09-14")).toBe(true);
    expect(isValidYmd("2026-9-14")).toBe(false);
    expect(isValidYmd(20260914)).toBe(false);
  });
});
