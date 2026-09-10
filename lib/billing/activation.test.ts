import { describe, expect, it } from "vitest";
import { selectActivationAction } from "./activation";
import type { ActivationBillingRow, OpenPeriod } from "./activation";

const TODAY = "2026-03-21";

const V2_ACTIVE: ActivationBillingRow = {
  billingModel: "v2_period",
  status: "active",
  hasPaymentMethod: true,
};

const OPEN: OpenPeriod = {
  id: "period-1",
  periodStartISO: "2026-03-01",
  periodEndISO: "2026-03-29",
};

function action(overrides: Partial<Parameters<typeof selectActivationAction>[0]> = {}) {
  return selectActivationAction({
    billingRow: V2_ACTIVE,
    openPeriod: null,
    openPeriodMinimumPending: false,
    todayISO: TODAY,
    minimumPence: 12900,
    ...overrides,
  });
}

describe("selectActivationAction routing", () => {
  // The flag lives on company_billing, so a company with no row cannot be on
  // v2 and must fall through to the path that exists today. This is the branch
  // that keeps every current customer working while v2 rolls out.
  it("falls through to v1 for a company with no billing row", () => {
    expect(action({ billingRow: null })).toEqual({ kind: "legacy" });
  });

  it("falls through to v1 for a company still on the old model", () => {
    expect(
      action({
        billingRow: {
          billingModel: "v1_immediate",
          status: "active",
          hasPaymentMethod: true,
        },
      })
    ).toEqual({ kind: "legacy" });
  });
});

describe("selectActivationAction first activation", () => {
  // The one deliberate exception to "nothing is charged mid-period": the
  // minimum is collected up front, at the moment service becomes billable.
  // It proves the card with a settled payment rather than the AVS check
  // square.cards.create already does, and it reduces credit exposure by the
  // floor.
  it("opens a period and charges the minimum when none is open", () => {
    expect(action({ openPeriod: null })).toEqual({
      kind: "open_period_and_charge",
      periodStartISO: "2026-03-21",
      periodEndISO: "2026-04-18",
      amountPence: 12900,
    });
  });

  // The period is anchored HERE, at first vehicle activation, not at signup.
  // That is what makes the gap between creating an account and adding a first
  // vehicle not a billing period at all, so a dormant company never sees a
  // zero-pound invoice or a minimum charge for nothing.
  it("anchors the period on the day of activation", () => {
    expect(action({ todayISO: "2026-07-04" }).kind).toBe(
      "open_period_and_charge"
    );
    expect(
      action({ todayISO: "2026-07-04" })
    ).toMatchObject({ periodStartISO: "2026-07-04" });
  });

  // Reactivation after suspension takes the same path, so a company that has
  // already failed to pay once re-proves its card before service resumes.
  it("charges again when reactivating with no open period", () => {
    expect(action({ openPeriod: null, minimumPence: 12900 })).toMatchObject({
      amountPence: 12900,
    });
  });
});

describe("selectActivationAction inside an open period", () => {
  // Rule 10. Adding a vehicle mid-period moves no money at all: no Square
  // call, no coverage row, no pro-rata charge. It is an insert. The vehicle
  // is billed in arrears when the period closes.
  it("joins an open period without charging", () => {
    expect(action({ openPeriod: OPEN })).toEqual({
      kind: "join_open_period",
      periodId: "period-1",
    });
  });

  // An open period whose end has passed is one the close job has not reached
  // yet; the cron runs daily, so this window is hours. Joining it is safe:
  // the licence activates today, which is at or after that period's end, so
  // it contributes no line there and is covered in full from the start of the
  // next one. Opening a second period instead would violate the one-open-
  // period-per-company index.
  it("joins an expired period rather than opening a second one", () => {
    expect(
      action({
        openPeriod: OPEN,
        todayISO: "2026-03-30",
      })
    ).toEqual({ kind: "join_open_period", periodId: "period-1" });
  });
});

describe("selectActivationAction with an unsettled minimum", () => {
  // A pending period_charges row means a Square call was made whose outcome
  // was never recorded. The card may well have been charged.
  //
  // Without this the hole is real and expensive: the period exists, so an
  // ordinary retry would take the join_open_period branch, let the vehicle in
  // without charging, and leave prepaid_pence at 0, so at close the customer
  // is billed the whole period again on top of a minimum they may already
  // have paid. Blocking is the honest answer, and the situation resolves the
  // moment the pending row is reconciled against Square.
  it("blocks rather than joining a period whose minimum is still settling", () => {
    expect(
      action({ openPeriod: OPEN, openPeriodMinimumPending: true })
    ).toEqual({ kind: "blocked", reason: "payment_settling" });
  });

  it("joins normally once the minimum has settled", () => {
    expect(
      action({ openPeriod: OPEN, openPeriodMinimumPending: false })
    ).toEqual({ kind: "join_open_period", periodId: "period-1" });
  });

  // Meaningless without a period, and must not block a first activation: there
  // is no period yet, so there is no unsettled charge against one.
  it("ignores the flag when there is no open period", () => {
    expect(
      action({ openPeriod: null, openPeriodMinimumPending: true }).kind
    ).toBe("open_period_and_charge");
  });
});

describe("selectActivationAction blocked", () => {
  // Suspension. Under arrears a company that has not paid must not be able to
  // grow its fleet, or the debt simply accrues against a card that is already
  // failing. Same reasoning as selectAddonAction's gates, which these mirror.
  it("blocks a past due company", () => {
    expect(action({ billingRow: { ...V2_ACTIVE, status: "past_due" } })).toEqual(
      { kind: "blocked", reason: "past_due" }
    );
  });

  it("blocks a canceled company", () => {
    expect(action({ billingRow: { ...V2_ACTIVE, status: "canceled" } })).toEqual(
      { kind: "blocked", reason: "canceled" }
    );
  });

  // Fails CLOSED on anything outside the union, exactly as selectAddonAction
  // does. The union is a compile-time claim about a runtime column, so a
  // status added later (paused, trialing) must not fall through to a branch
  // that charges a card.
  it("blocks an unrecognised status rather than charging", () => {
    expect(
      action({
        billingRow: {
          ...V2_ACTIVE,
          status: "trialing" as ActivationBillingRow["status"],
        },
      })
    ).toEqual({ kind: "blocked", reason: "inactive_subscription" });
  });

  // Checked AFTER the status gates, because those carry the message the
  // customer actually needs: a past due company has a card, it declined, and
  // telling them they have no payment method would send them down the wrong
  // path entirely.
  it("blocks when there is no card to charge the minimum against", () => {
    expect(
      action({
        billingRow: { ...V2_ACTIVE, hasPaymentMethod: false },
        openPeriod: null,
      })
    ).toEqual({ kind: "blocked", reason: "no_payment_method" });
  });

  // But a company mid-period is not being charged, so a missing card does not
  // stop them adding a vehicle. They will be chased at close like anyone else.
  it("lets a company with no card join an open period", () => {
    expect(
      action({
        billingRow: { ...V2_ACTIVE, hasPaymentMethod: false },
        openPeriod: OPEN,
      })
    ).toEqual({ kind: "join_open_period", periodId: "period-1" });
  });
});
