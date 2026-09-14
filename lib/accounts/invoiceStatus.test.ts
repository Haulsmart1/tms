import { describe, expect, it } from "vitest";
import { canEditInvoiceValues, checkInvoiceTransition, isCreditableInvoiceStatus } from "./invoiceStatus";

const base = { tier: "staff" as const, accountingInvoiceId: null, amountPaid: 0, creditTotal: 0 };

describe("canEditInvoiceValues", () => {
  it("allows drafts and awaiting_pod", () => {
    expect(canEditInvoiceValues({ status: "draft", accountingInvoiceId: null }).ok).toBe(true);
    expect(canEditInvoiceValues({ status: "AWAITING_POD", accountingInvoiceId: null }).ok).toBe(true);
  });

  it.each(["approved", "sent", "paid", "void", "credited", "", null])("locks %s", (status) => {
    expect(canEditInvoiceValues({ status, accountingInvoiceId: null }).ok).toBe(false);
  });

  it("locks a synced draft", () => {
    const result = canEditInvoiceValues({ status: "draft", accountingInvoiceId: "xero-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invoice_synced");
  });
});

describe("checkInvoiceTransition", () => {
  it("lets staff approve a draft", () => {
    expect(checkInvoiceTransition({ ...base, from: "draft", to: "approved" }).ok).toBe(true);
  });

  it("refuses paid, sent and credited via PATCH", () => {
    for (const to of ["paid", "sent", "credited"]) {
      expect(checkInvoiceTransition({ ...base, tier: "super_admin", from: "approved", to }).ok).toBe(false);
    }
  });

  it("refuses unlocking a sent invoice back to draft (ACC-3 scenario)", () => {
    expect(checkInvoiceTransition({ ...base, tier: "admin", from: "sent", to: "draft" }).ok).toBe(false);
  });

  it("allows an unsynced approved invoice back to draft, but not a synced one", () => {
    expect(checkInvoiceTransition({ ...base, from: "approved", to: "draft" }).ok).toBe(true);
    expect(checkInvoiceTransition({ ...base, from: "approved", to: "draft", accountingInvoiceId: "x" }).ok).toBe(false);
  });

  it("void is admin only, unsynced, and without allocations", () => {
    expect(checkInvoiceTransition({ ...base, from: "sent", to: "void" }).ok).toBe(false);
    expect(checkInvoiceTransition({ ...base, tier: "admin", from: "sent", to: "void" }).ok).toBe(true);
    expect(checkInvoiceTransition({ ...base, tier: "admin", from: "sent", to: "void", amountPaid: 10 }).ok).toBe(false);
    expect(
      checkInvoiceTransition({ ...base, tier: "super_admin", from: "sent", to: "void", accountingInvoiceId: "x" }).ok,
    ).toBe(false);
  });

  it("paid, void and credited are terminal", () => {
    for (const from of ["paid", "void", "credited"]) {
      expect(checkInvoiceTransition({ ...base, tier: "super_admin", from, to: "draft" }).ok).toBe(false);
    }
  });

  it("rejects a no-op", () => {
    expect(checkInvoiceTransition({ ...base, from: "draft", to: "draft" }).ok).toBe(false);
  });
});

describe("isCreditableInvoiceStatus", () => {
  it("only credits invoices that reached the customer", () => {
    expect(isCreditableInvoiceStatus("sent")).toBe(true);
    expect(isCreditableInvoiceStatus("approved")).toBe(true);
    expect(isCreditableInvoiceStatus("draft")).toBe(false);
    expect(isCreditableInvoiceStatus("void")).toBe(false);
    expect(isCreditableInvoiceStatus("awaiting_pod")).toBe(false);
  });
});
