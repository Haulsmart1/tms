import { describe, expect, it } from "vitest";
import { isIsoDate, parsePaymentInput } from "./payments";

const customerId = "11111111-1111-4111-8111-111111111111";
const invoiceId = "22222222-2222-4222-8222-222222222222";
const today = "2026-09-14";

describe("parsePaymentInput", () => {
  it("accepts an unallocated payment and defaults the date", () => {
    const result = parsePaymentInput({ customerId, amount: "120.505" }, today);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(120.51);
      expect(result.value.paymentDate).toBe(today);
      expect(result.value.invoiceId).toBeNull();
      expect(result.value.currency).toBeNull();
    }
  });

  it("rejects NaN, zero and negative amounts", () => {
    for (const amount of ["", "abc", 0, -5, Number.NaN, Infinity]) {
      expect(parsePaymentInput({ customerId, amount }, today).ok).toBe(false);
    }
  });

  it("defaults the allocation to the payment amount", () => {
    const result = parsePaymentInput({ customerId, amount: 50, invoiceId }, today);
    expect(result.ok && result.value.allocateAmount).toBe(50);
  });

  it("refuses allocating more than the payment (ACC-1 scenario)", () => {
    expect(parsePaymentInput({ customerId, amount: 1, invoiceId, allocateAmount: 99999 }, today).ok).toBe(false);
  });

  it("refuses a zero or negative allocation", () => {
    expect(parsePaymentInput({ customerId, amount: 10, invoiceId, allocateAmount: 0 }, today).ok).toBe(false);
    expect(parsePaymentInput({ customerId, amount: 10, invoiceId, allocateAmount: -1 }, today).ok).toBe(false);
  });

  it("validates ids, currency and date", () => {
    expect(parsePaymentInput({ customerId: "x", amount: 1 }, today).ok).toBe(false);
    expect(parsePaymentInput({ customerId, amount: 1, invoiceId: "nope" }, today).ok).toBe(false);
    expect(parsePaymentInput({ customerId, amount: 1, currency: "euro" }, today).ok).toBe(false);
    expect(parsePaymentInput({ customerId, amount: 1, paymentDate: "2026-02-30" }, today).ok).toBe(false);
    const eur = parsePaymentInput({ customerId, amount: 1, currency: "eur" }, today);
    expect(eur.ok && eur.value.currency).toBe("EUR");
  });
});

describe("isIsoDate", () => {
  it("checks real calendar dates", () => {
    expect(isIsoDate("2026-09-14")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("14/09/2026")).toBe(false);
  });
});
