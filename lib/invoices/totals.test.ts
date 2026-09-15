import { describe, expect, it } from "vitest";

import { addInvoiceTotals, computeInvoiceTotals, emptyInvoiceTotals, finishInvoiceTotals, isOutstandingInvoice } from "./totals";

const today = "2026-09-14";

describe("isOutstandingInvoice", () => {
  it("excludes void, credited, cancelled, draft, blank status and zero balances", () => {
    for (const status of ["void", "credited", "cancelled", "draft", "DRAFT", null, ""]) {
      expect(isOutstandingInvoice({ status, due_date: null, balance_due: 10 })).toBe(false);
    }
    expect(isOutstandingInvoice({ status: "sent", due_date: null, balance_due: 0 })).toBe(false);
    expect(isOutstandingInvoice({ status: "sent", due_date: null, balance_due: "-5.00" })).toBe(false);
    expect(isOutstandingInvoice({ status: "part_paid", due_date: null, balance_due: "0.01" })).toBe(true);
  });
});

describe("computeInvoiceTotals", () => {
  it("sums outstanding and overdue in pence, overdue from the day after the due date", () => {
    const totals = computeInvoiceTotals(
      [
        { status: "sent", due_date: "2026-09-13", balance_due: "100.10" },
        { status: "approved", due_date: "2026-09-14", balance_due: 0.2 },
        { status: "part_paid", due_date: null, balance_due: "50" },
        { status: "void", due_date: "2026-01-01", balance_due: 999 },
        { status: "draft", due_date: "2026-01-01", balance_due: 999 },
      ],
      today,
    );
    expect(totals).toEqual({ openCount: 3, outstandingTotal: 150.3, overdueCount: 1, overdueTotal: 100.1 });
  });

  it("accumulates across pages exactly as one pass would", () => {
    const rows = Array.from({ length: 2500 }, (_, index) => ({
      status: "sent",
      due_date: index % 2 === 0 ? "2026-09-01" : "2026-10-01",
      balance_due: "0.10",
    }));
    const acc = emptyInvoiceTotals();
    for (let from = 0; from < rows.length; from += 1000) {
      addInvoiceTotals(acc, rows.slice(from, from + 1000), today);
    }
    expect(finishInvoiceTotals(acc)).toEqual(computeInvoiceTotals(rows, today));
    expect(finishInvoiceTotals(acc)).toEqual({ openCount: 2500, outstandingTotal: 250, overdueCount: 1250, overdueTotal: 125 });
  });
});
