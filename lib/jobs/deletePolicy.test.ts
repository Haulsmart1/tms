import { describe, expect, it } from "vitest";
import {
  canDeleteJobStatus,
  hasProtectedJobLinks,
} from "./deletePolicy";

describe("canDeleteJobStatus", () => {
  it("allows pending acceptance jobs", () => {
    expect(canDeleteJobStatus("pending_acceptance")).toBe(true);
  });

  it("allows planned jobs", () => {
    expect(canDeleteJobStatus("planned")).toBe(true);
  });

  it("blocks completed jobs", () => {
    expect(canDeleteJobStatus("completed")).toBe(false);
  });

  it("blocks operational statuses", () => {
    expect(canDeleteJobStatus("in_progress")).toBe(false);
    expect(canDeleteJobStatus("collected")).toBe(false);
    expect(canDeleteJobStatus("delivered")).toBe(false);
  });

  it("blocks missing or unknown statuses", () => {
    expect(canDeleteJobStatus(null)).toBe(false);
    expect(canDeleteJobStatus(undefined)).toBe(false);
    expect(canDeleteJobStatus("unknown_status")).toBe(false);
  });
});

describe("hasProtectedJobLinks", () => {
  it("allows deletion when there are no protected links", () => {
    expect(
      hasProtectedJobLinks({
        invoiceJobs: 0,
        invoices: 0,
        supplierPurchaseOrderJobs: 0,
      })
    ).toBe(false);
  });

  it("blocks an invoice_jobs relationship", () => {
    expect(
      hasProtectedJobLinks({
        invoiceJobs: 1,
        invoices: 0,
        supplierPurchaseOrderJobs: 0,
      })
    ).toBe(true);
  });

  it("blocks a direct invoice relationship", () => {
    expect(
      hasProtectedJobLinks({
        invoiceJobs: 0,
        invoices: 1,
        supplierPurchaseOrderJobs: 0,
      })
    ).toBe(true);
  });

  it("blocks a supplier purchase order relationship", () => {
    expect(
      hasProtectedJobLinks({
        invoiceJobs: 0,
        invoices: 0,
        supplierPurchaseOrderJobs: 1,
      })
    ).toBe(true);
  });

  it("blocks when several protected relationships exist", () => {
    expect(
      hasProtectedJobLinks({
        invoiceJobs: 2,
        invoices: 1,
        supplierPurchaseOrderJobs: 3,
      })
    ).toBe(true);
  });
});
