import { describe, expect, it } from "vitest";
import {
  balanceDue,
  periodChargeIdempotencyKey,
  periodChargeNote,
} from "./periodPayment";

const PERIOD = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8";

describe("periodChargeIdempotencyKey", () => {
  it("fits inside Square's 45 character limit", () => {
    expect(
      periodChargeIdempotencyKey(PERIOD, "balance", 4).length
    ).toBeLessThanOrEqual(45);
  });

  // The period id is already globally unique, so unlike addonIdempotencyKey
  // this needs no company id and therefore no truncation. A truncated key is
  // only safe while collisions stay improbable; not truncating removes the
  // question.
  it("carries the whole period id", () => {
    expect(periodChargeIdempotencyKey(PERIOD, "minimum", 1)).toContain(
      "3f2a1b4c5d6e4f708192a3b4c5d6e7f8"
    );
  });

  it("distinguishes the two charges against one period", () => {
    expect(periodChargeIdempotencyKey(PERIOD, "minimum", 1)).not.toBe(
      periodChargeIdempotencyKey(PERIOD, "balance", 1)
    );
  });

  it("distinguishes attempts", () => {
    expect(periodChargeIdempotencyKey(PERIOD, "balance", 1)).not.toBe(
      periodChargeIdempotencyKey(PERIOD, "balance", 2)
    );
  });

  // The whole point of a key: the same charge recomputed after a crash must
  // produce the same string, or Square takes the money twice.
  it("is stable for the same charge", () => {
    expect(periodChargeIdempotencyKey(PERIOD, "balance", 2)).toBe(
      periodChargeIdempotencyKey(PERIOD, "balance", 2)
    );
  });

  it("rejects an attempt below one", () => {
    expect(() => periodChargeIdempotencyKey(PERIOD, "balance", 0)).toThrow(
      /attempt/
    );
  });
});

describe("periodChargeNote", () => {
  // Square shows this to the customer on their statement and receipt, and it
  // is part of the request BODY, so it must be derivable from stored values
  // alone. Anything computed from "now" would drift between the first call and
  // a replay, and Square refuses a reused key whose body has changed.
  it("describes the minimum charge with its period", () => {
    expect(periodChargeNote("minimum", "2026-03-21", "2026-04-18")).toBe(
      "TMS Wizzard minimum charge, 21 Mar 2026 to 17 Apr 2026"
    );
  });

  it("describes the balance charge with its period", () => {
    expect(periodChargeNote("balance", "2026-03-21", "2026-04-18")).toBe(
      "TMS Wizzard, 21 Mar 2026 to 17 Apr 2026"
    );
  });

  // The end shown is the last day INCLUDED, not the exclusive boundary. A
  // customer reading "to 18 Apr" on a receipt for a period that stops covering
  // them on the 18th would reasonably dispute it.
  it("shows the last covered day, not the exclusive end", () => {
    expect(periodChargeNote("balance", "2026-03-21", "2026-04-18")).toContain(
      "17 Apr 2026"
    );
    expect(periodChargeNote("balance", "2026-03-21", "2026-04-18")).not.toContain(
      "18 Apr"
    );
  });
});

describe("balanceDue", () => {
  // The worked example from the design discussion: twenty vehicles, eleven
  // days, cancelled. GBP 405.44 net for the period, GBP 129.00 already taken
  // when it opened.
  it("charges the period net less what was already collected", () => {
    expect(balanceDue(40544, 12900, 20)).toEqual({
      netPence: 27644,
      vatPence: 5529,
      grossPence: 33173,
    });
  });

  // A small fleet whose whole period is covered by the minimum. This is the
  // common cancellation case and the reason a two-vehicle customer leaving
  // mid-period gets no final bill at all.
  it("charges nothing when the minimum already covered the period", () => {
    expect(balanceDue(12900, 12900, 20)).toEqual({
      netPence: 0,
      vatPence: 0,
      grossPence: 0,
    });
  });

  // No refunds. A period that came in UNDER what was prepaid settles to zero,
  // never to a credit: the minimum is owed for the period regardless of how
  // little of it was used.
  it("never returns a negative balance", () => {
    expect(balanceDue(6450, 12900, 20).netPence).toBe(0);
    expect(balanceDue(0, 12900, 20).grossPence).toBe(0);
  });

  it("charges the whole invoice when nothing was prepaid", () => {
    expect(balanceDue(19350, 0, 20)).toEqual({
      netPence: 19350,
      vatPence: 3870,
      grossPence: 23220,
    });
  });

  // THE INVARIANT. VAT is charged twice against one period, once on the
  // minimum and once on the balance, and the two must sum to VAT on the whole
  // period or the customer's receipts will not reconcile with their invoice.
  // This holds because 20 per cent of the GBP 129.00 floor is exact; a floor
  // whose VAT rounds would let the two differ by a penny.
  it("splits VAT without losing a penny against the whole period", () => {
    for (const invoiceNet of [12900, 19350, 40544, 58050, 103200, 251550]) {
      const prepaidVat = Math.floor((12900 * 20 + 50) / 100);
      const balance = balanceDue(invoiceNet, 12900, 20);
      const wholePeriodVat = Math.floor((invoiceNet * 20 + 50) / 100);

      expect(prepaidVat + balance.vatPence).toBe(wholePeriodVat);
    }
  });

  it("rejects a negative prepayment", () => {
    expect(() => balanceDue(1000, -1, 20)).toThrow(/non-negative integer/);
  });
});
