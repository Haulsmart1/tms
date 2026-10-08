import { describe, expect, it } from "vitest";
import { parseSuperAdminInvoiceStatus, superAdminAllowedFromStatuses } from "./invoiceStatus";

describe("superAdminAllowedFromStatuses", () => {
  it("marks an issued, unpaid invoice paid", () => {
    const from = superAdminAllowedFromStatuses("paid");
    for (const status of ["approved", "sent", "part_paid", "partially_paid", "overdue", "pending"]) {
      expect(from).toContain(status);
    }
    expect(from).not.toContain("paid");
  });

  it("moves a paid invoice back to pending", () => {
    const from = superAdminAllowedFromStatuses("pending");
    expect(from).toContain("paid");
    expect(from).not.toContain("pending");
  });

  it("never flips out of void, credited, cancelled or an unissued draft", () => {
    for (const target of ["paid", "pending"] as const) {
      const from = superAdminAllowedFromStatuses(target);
      for (const status of ["void", "credited", "cancelled", "draft", "awaiting_pod"]) {
        expect(from).not.toContain(status);
      }
    }
  });
});

describe("parseSuperAdminInvoiceStatus", () => {
  it("accepts the two statuses the super-admin page offers", () => {
    expect(parseSuperAdminInvoiceStatus({ status: "paid" })).toEqual({ ok: true, status: "paid" });
    expect(parseSuperAdminInvoiceStatus({ status: "pending" })).toEqual({ ok: true, status: "pending" });
  });

  it("refuses anything else, including statuses the accounts API reserves", () => {
    for (const body of [
      { status: "void" },
      { status: "PAID" },
      { status: "" },
      { status: 1 },
      {},
      null,
      "paid",
    ]) {
      const result = parseSuperAdminInvoiceStatus(body);
      expect(result.ok).toBe(false);
    }
  });
});
