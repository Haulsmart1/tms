import { describe, expect, it } from "vitest";
import { parseCreateInvoice, parseInvoicePatch } from "./invoiceRequests";

const customerId = "11111111-1111-4111-8111-111111111111";
const jobA = "22222222-2222-4222-8222-222222222222";
const jobB = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const today = "2026-09-14";

describe("parseCreateInvoice", () => {
  it("dedupes jobs and defaults the issue date", () => {
    const result = parseCreateInvoice({ customerId, jobIds: [jobA, jobA, jobB] }, today);
    expect(result).toEqual({
      ok: true,
      value: { customerId, jobIds: [jobA, jobB], issueDate: today, dueDate: null, poReference: null, notes: null },
    });
  });

  it("refuses a caller-supplied invoice number (INV-9)", () => {
    expect(parseCreateInvoice({ customerId, jobIds: [jobA], invoiceNumber: "INV-1" }, today).ok).toBe(false);
  });

  it("answers invalid dates instead of throwing (ACC-9)", () => {
    expect(parseCreateInvoice({ customerId, jobIds: [jobA], issueDate: "banana" }, today).ok).toBe(false);
    expect(parseCreateInvoice({ customerId, jobIds: [jobA], dueDate: "2026-02-31" }, today).ok).toBe(false);
    expect(parseCreateInvoice({ customerId, jobIds: [jobA], issueDate: "2026-09-14", dueDate: "2026-09-01" }, today).ok).toBe(
      false,
    );
  });

  it("requires uuids", () => {
    expect(parseCreateInvoice({ customerId: "x", jobIds: [jobA] }, today).ok).toBe(false);
    expect(parseCreateInvoice({ customerId, jobIds: ["nope"] }, today).ok).toBe(false);
    expect(parseCreateInvoice({ customerId, jobIds: [] }, today).ok).toBe(false);
  });
});

describe("parseInvoicePatch", () => {
  const line = { id: lineId, description: "Leeds to Gdansk", quantity: 1, unit_price: 100, vat_rate: 20 };

  it("parses a status change on its own", () => {
    expect(parseInvoicePatch({ status: "Approved" })).toEqual({ ok: true, value: { kind: "status", status: "approved" } });
  });

  it("refuses status mixed with value edits (the ACC-3 unlock-and-reprice body)", () => {
    const result = parseInvoicePatch({ status: "draft", lines: [line] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("mixed_update");
  });

  it("refuses server-only fields such as the Xero id", () => {
    expect(parseInvoicePatch({ accounting_invoice_id: "fake" }).ok).toBe(false);
    expect(parseInvoicePatch({ invoice_email: "x@y.com" }).ok).toBe(false);
  });

  it("parses the editor save", () => {
    const result = parseInvoicePatch({
      issue_date: "2026-09-01",
      due_date: null,
      po_reference: " PO-1 ",
      notes: "",
      lines: [line],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "values",
        header: { issue_date: "2026-09-01", due_date: null, po_reference: "PO-1", notes: null },
        lines: [line],
      },
    });
  });

  it("rejects any bad line before anything is written", () => {
    for (const bad of [
      { ...line, quantity: 0 },
      { ...line, unit_price: -1 },
      { ...line, vat_rate: 101 },
      { ...line, vat_rate: "" },
      { ...line, id: "x" },
    ]) {
      expect(parseInvoicePatch({ notes: "ok", lines: [bad] }).ok).toBe(false);
    }
    expect(parseInvoicePatch({ lines: [line, line] }).ok).toBe(false);
  });

  it("requires a real issue date when one is sent", () => {
    expect(parseInvoicePatch({ issue_date: null }).ok).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(parseInvoicePatch({}).ok).toBe(false);
  });
});
