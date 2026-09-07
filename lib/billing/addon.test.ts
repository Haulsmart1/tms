import { describe, expect, it } from "vitest";
import { selectAddonAction } from "./addon";
import type { AddonBillingRow } from "./addon";

const TODAY = "2026-09-07";

// Charged on 2026-08-24, so the current cycle runs 2026-08-24 to 2026-09-21.
const ACTIVE: AddonBillingRow = {
  status: "active",
  next_charge_on: "2026-09-21",
  retry_at: null,
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

  // Coverage is only ever written by a real payment, so honouring it while
  // the cycle it names is still running cannot be exploited: they paid for
  // this vehicle in this cycle already, even if their card has since failed.
  it("honours coverage for a past due company while the paid cycle is still running", () => {
    expect(
      select({
        billingRow: { status: "past_due", next_charge_on: "2026-09-21", retry_at: null },
        alreadyCovered: true,
      })
    ).toEqual({ kind: "free", reason: "already_covered" });
  });

  // The frozen-date case. Once dunning is exhausted, selectDueAction returns
  // none and next_charge_on never advances again, so currentCycleDate names
  // the same elapsed cycle forever and the entire last-paid fleet reads as
  // covered. Honouring that would let a past_due company cycle its whole
  // fleet off and on for free with the status gate never firing.
  it("refuses stale coverage once the paid cycle has elapsed", () => {
    expect(
      select({
        todayISO: "2026-10-30",
        billingRow: { status: "past_due", next_charge_on: "2026-09-21", retry_at: null },
        alreadyCovered: true,
      })
    ).toEqual({ kind: "blocked", reason: "past_due" });
  });

  // The same frozen date for a company still marked active but mid-dunning:
  // coverage must not talk it past the dunning gate either.
  it("refuses stale coverage for a mid-dunning company", () => {
    expect(
      select({
        todayISO: "2026-10-30",
        billingRow: {
          status: "active",
          next_charge_on: "2026-09-21",
          retry_at: "2026-09-23",
        },
        alreadyCovered: true,
      })
    ).toEqual({ kind: "blocked", reason: "dunning" });
  });

  // A healthy company whose cycle charge is due today or overdue: coverage is
  // no longer honoured, but the outcome is unchanged (still free, still no
  // coverage written, still billed in full by the imminent cron run). Only
  // the reason string differs.
  it("falls through to cycle_due rather than already_covered on the charge date", () => {
    expect(select({ todayISO: "2026-09-21", alreadyCovered: true })).toEqual({
      kind: "free",
      reason: "cycle_due",
    });
  });

  it("is free when the company has no subscription at all", () => {
    expect(select({ billingRow: null })).toEqual({
      kind: "free",
      reason: "no_subscription",
    });
  });

  it("blocks a past due company", () => {
    expect(
      select({ billingRow: { status: "past_due", next_charge_on: "2026-09-21", retry_at: null } })
    ).toEqual({ kind: "blocked", reason: "past_due" });
  });

  it("blocks a canceled company", () => {
    expect(
      select({ billingRow: { status: "canceled", next_charge_on: "2026-09-21", retry_at: null } })
    ).toEqual({ kind: "blocked", reason: "canceled" });
  });

  // applyChargeOutcome leaves a mid-dunning company as status "active" with
  // next_charge_on in the past, so without the retry_at check this is the
  // free-fleet exploit: unlimited additions on a card that is already failing.
  it("blocks a company mid-dunning even though its status is active", () => {
    expect(
      select({
        billingRow: {
          status: "active",
          next_charge_on: "2026-09-21",
          retry_at: "2026-09-23",
        },
      })
    ).toEqual({ kind: "blocked", reason: "dunning" });
  });

  it("blocks a mid-dunning company whose cycle is already overdue", () => {
    expect(
      select({
        todayISO: "2026-09-25",
        billingRow: {
          status: "active",
          next_charge_on: "2026-09-21",
          retry_at: "2026-09-23",
        },
      })
    ).toEqual({ kind: "blocked", reason: "dunning" });
  });

  it("fails closed on a status outside the known set", () => {
    expect(
      select({
        billingRow: {
          status: "paused" as AddonBillingRow["status"],
          next_charge_on: "2026-09-21",
          retry_at: null,
        },
      })
    ).toEqual({ kind: "blocked", reason: "inactive_subscription" });
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
