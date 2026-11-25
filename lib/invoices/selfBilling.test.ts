import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateInvoicePdf } from "./generatePdf";
import { parseSelfBillingDetails } from "./selfBilling";

describe("self-billing invoices", () => {
  it("calculates supplier line totals and generates a titled draft PDF", async () => {
    const details = parseSelfBillingDetails("2026-11-25", JSON.stringify([
      { description: "Transport JOB-1", quantity: "1", unitPrice: "3800.00", vat: "none" },
      { description: "Waiting time", quantity: "1.50", unitPrice: "50.00", vat: "20" },
    ]));
    if (details.error) throw new Error(details.error);
    expect(details.totals).toMatchObject({ subtotal: 3875, vat: 15, total: 3890 });
    expect(details.lines[0]).toMatchObject({ vatLabel: "No VAT", grossAmount: 3800 });
    const { bytes } = await generateInvoicePdf({
      companyName: "Supplier Ltd", customerName: "Workspace Ltd", invoiceNumber: "SB-001",
      issueDate: "2026-11-26", dueDate: "2026-12-26", currency: "GBP",
      selfBilling: { customerAddress: "1 Depot Road", supplyDate: details.supplyDate, draft: true },
      subtotal: details.totals.subtotal, vatTotal: details.totals.vat, total: details.totals.total,
      amountPaid: 0, creditTotal: 0, balanceDue: details.totals.total, lines: details.lines,
    });
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Draft self-billing invoice SB-001");
  });

  it("requires a supply date and an explicit VAT treatment", () => {
    expect(parseSelfBillingDetails("2026-02-30", "[]").error).toContain("supply date");
    expect(parseSelfBillingDetails("2026-11-25", JSON.stringify([
      { description: "Transport", quantity: "1", unitPrice: "100", vat: "" },
    ])).error).toContain("VAT treatment");
  });
});
