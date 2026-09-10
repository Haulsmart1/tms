import { describe, expect, it } from "vitest";
import {
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
