import { describe, expect, it } from "vitest";
import { parseSuperAdminInvoiceStatus } from "./invoiceStatus";

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
