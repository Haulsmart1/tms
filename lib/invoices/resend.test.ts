import { describe, expect, it } from "vitest";

import { formatSentAt, invoiceResendWarning } from "./resend";

describe("formatSentAt", () => {
  it("shows the London clock, including BST", () => {
    expect(formatSentAt("2026-07-01T23:30:00Z")).toBe("02/07/2026 at 00:30");
    expect(formatSentAt("2026-12-01T09:05:00Z")).toBe("01/12/2026 at 09:05");
  });

  it("returns null for a missing or invalid timestamp", () => {
    expect(formatSentAt(null)).toBeNull();
    expect(formatSentAt("not a date")).toBeNull();
  });
});

describe("invoiceResendWarning", () => {
  it("warns only for a sent invoice, naming the last-sent date when known", () => {
    expect(invoiceResendWarning({ invoiceNumber: "INV-7", status: "approved", sentAt: null })).toBeNull();
    expect(invoiceResendWarning({ invoiceNumber: "INV-7", status: "sent", sentAt: "2026-12-01T09:05:00Z" })).toBe(
      "INV-7 was already emailed on 01/12/2026 at 09:05. Sending again gives the customer a duplicate.",
    );
    expect(invoiceResendWarning({ invoiceNumber: null, status: "Sent", sentAt: null })).toBe(
      "This invoice was already emailed. Sending again gives the customer a duplicate.",
    );
  });
});
