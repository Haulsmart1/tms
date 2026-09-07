import { describe, expect, it } from "vitest";
import { selectAddonAction } from "./addon";
import type { AddonBillingRow } from "./addon";

const TODAY = "2026-09-07";

// Charged on 2026-08-24, so the current cycle runs 2026-08-24 to 2026-09-21.
const ACTIVE: AddonBillingRow = {
  status: "active",
  next_charge_on: "2026-09-21",
};

function select(
  overrides: {
    billingRow?: AddonBillingRow | null;
    todayISO?: string;
    alreadyCovered?: boolean;
  } = {}
) {
  return selectAddonAction({
    billingRow: overrides.billingRow === undefined ? ACTIVE : overrides.billingRow,
    todayISO: overrides.todayISO ?? TODAY,
    alreadyCovered: overrides.alreadyCovered ?? false,
  });
}

describe("selectAddonAction", () => {
  it("charges for the days left in the current cycle", () => {
    expect(select()).toEqual({
      kind: "charge",
      cycleDate: "2026-08-24",
      days: 14,
    });
  });

  it("dates the charge to the cycle already paid for, not the next one", () => {
    const action = select();
    if (action.kind !== "charge") throw new Error("expected a charge");
    // 2026-09-21 is when the NEXT charge lands; the cycle being topped up
    // started 28 days earlier.
    expect(action.cycleDate).toBe("2026-08-24");
  });

  it("charges nearly a full cycle the day after a charge", () => {
    // Only "today" moves here. cycleDate is derived from next_charge_on
    // alone, so it stays 2026-08-24 no matter how far into the cycle we
    // are: anchoring the subtraction to today instead would be the
    // double-billing bug the cycle date rule exists to prevent.
    const action = select({ todayISO: "2026-08-25" });
    expect(action).toEqual({ kind: "charge", cycleDate: "2026-08-24", days: 27 });
  });

  it("is free when the vehicle is already covered for this cycle", () => {
    expect(select({ alreadyCovered: true })).toEqual({
      kind: "free",
      reason: "already_covered",
    });
  });

  // Coverage is only ever written by a real payment, so honouring it even for
  // a past_due company cannot be exploited: they paid for this vehicle in
  // this cycle already.
  it("honours existing coverage even when the company is past due", () => {
    expect(
      select({
        billingRow: { status: "past_due", next_charge_on: "2026-09-21" },
        alreadyCovered: true,
      })
    ).toEqual({ kind: "free", reason: "already_covered" });
  });

  it("is free when the company has no subscription at all", () => {
    expect(select({ billingRow: null })).toEqual({
      kind: "free",
      reason: "no_subscription",
    });
  });

  it("blocks a past due company", () => {
    expect(
      select({ billingRow: { status: "past_due", next_charge_on: "2026-09-21" } })
    ).toEqual({ kind: "blocked", reason: "past_due" });
  });

  it("blocks a canceled company", () => {
    expect(
      select({ billingRow: { status: "canceled", next_charge_on: "2026-09-21" } })
    ).toEqual({ kind: "blocked", reason: "canceled" });
  });

  // Between a cycle falling due and the cron running, next_charge_on is in
  // the past. The imminent cron run counts live vehicles, so it will pick
  // this one up at full price; recording coverage here would make it free for
  // a whole cycle.
  it("is free on the charge date, leaving the vehicle to the cron", () => {
    expect(select({ todayISO: "2026-09-21" })).toEqual({
      kind: "free",
      reason: "cycle_due",
    });
  });

  it("is free while a due charge has not yet run", () => {
    expect(select({ todayISO: "2026-09-23" })).toEqual({
      kind: "free",
      reason: "cycle_due",
    });
  });

  it("charges for one day on the last day of a cycle", () => {
    const action = select({ todayISO: "2026-09-20" });
    expect(action).toEqual({ kind: "charge", cycleDate: "2026-08-24", days: 1 });
  });
});
