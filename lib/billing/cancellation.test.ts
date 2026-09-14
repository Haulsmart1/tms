import { describe, expect, it } from "vitest";
import {
  COOLING_OFF_HOURS,
  selectCancellationAction,
  selectV1CancellationAction,
} from "./cancellation";
import type { CancellationBillingRow, CancellablePeriod } from "./cancellation";

const NOW = "2026-03-22T09:00:00.000Z";
const TODAY = "2026-03-22";

const V2: CancellationBillingRow = {
  billingModel: "v2_period",
  status: "active",
  coolingOffRefundedAt: null,
};

const PERIOD: CancellablePeriod = {
  id: "period-1",
  periodStartISO: "2026-03-21",
  periodEndISO: "2026-04-18",
  openedAtISO: "2026-03-21T14:00:00.000Z",
  prepaidPence: 12900,
  minimumChargePending: false,
  isFirstPeriod: true,
};

describe("selectCancellationAction cooling-off limits (BILL2-10)", () => {
  it("is not available on a later activation-opened period", () => {
    expect(
      action({ openPeriod: { ...PERIOD, isFirstPeriod: false } }).kind
    ).toBe("close_early");
  });

  it("is not available on a card that already had one elsewhere", () => {
    expect(
      action({ billingRow: { ...V2, coolingOffUsedByCard: true } }).kind
    ).toBe("close_early");
  });
});

describe("selectCancellationAction before a migrated company's seam (BILL2-13)", () => {
  it("voids a period that has not started instead of cutting it short", () => {
    expect(
      action({
        openPeriod: {
          ...PERIOD,
          periodStartISO: "2026-03-30",
          periodEndISO: "2026-04-27",
          prepaidPence: 0,
        },
      })
    ).toEqual({ kind: "void_future_period", periodId: "period-1" });
  });

  it("still closes a period that started today", () => {
    expect(
      action({
        openPeriod: { ...PERIOD, periodStartISO: TODAY, prepaidPence: 0 },
      }).kind
    ).toBe("close_early");
  });
});

describe("selectV1CancellationAction (BILL1-14)", () => {
  it("cancels an active v1 company", () => {
    expect(
      selectV1CancellationAction({ status: "active", hasUnsettledCharge: false })
    ).toEqual({ kind: "cancel" });
  });

  it("cancels a past due v1 company, which stops dunning", () => {
    expect(
      selectV1CancellationAction({ status: "past_due", hasUnsettledCharge: false })
    ).toEqual({ kind: "cancel" });
  });

  it("refuses twice", () => {
    expect(
      selectV1CancellationAction({ status: "canceled", hasUnsettledCharge: false })
    ).toEqual({ kind: "blocked", reason: "already_canceled" });
  });

  it("waits for a charge whose outcome is unknown", () => {
    expect(
      selectV1CancellationAction({ status: "active", hasUnsettledCharge: true })
    ).toEqual({ kind: "blocked", reason: "payment_settling" });
  });
});

function action(overrides: Partial<Parameters<typeof selectCancellationAction>[0]> = {}) {
  return selectCancellationAction({
    billingRow: V2,
    openPeriod: PERIOD,
    nowISO: NOW,
    todayISO: TODAY,
    ...overrides,
  });
}

describe("selectCancellationAction routing", () => {
  it("does not handle a company with no billing row", () => {
    expect(action({ billingRow: null })).toEqual({ kind: "legacy" });
  });

  it("does not handle a v1 company", () => {
    expect(
      action({ billingRow: { ...V2, billingModel: "v1_immediate" } })
    ).toEqual({ kind: "legacy" });
  });

  it("refuses to cancel twice", () => {
    expect(action({ billingRow: { ...V2, status: "canceled" } })).toEqual({
      kind: "blocked",
      reason: "already_canceled",
    });
  });

  // The outcome of the up-front charge is unknown, so neither refunding it nor
  // billing around it is defensible. Same reasoning as the activation gate.
  it("blocks while the minimum is still settling", () => {
    expect(
      action({ openPeriod: { ...PERIOD, minimumChargePending: true } })
    ).toEqual({ kind: "blocked", reason: "payment_settling" });
  });
});

describe("selectCancellationAction cooling off", () => {
  // 19 hours after the period opened, so inside the window.
  it("refunds the minimum inside the window", () => {
    expect(action()).toEqual({
      kind: "cooling_off",
      periodId: "period-1",
      refundNetPence: 12900,
    });
  });

  it("closes normally once the window has passed", () => {
    expect(action({ nowISO: "2026-03-24T09:00:00.000Z" }).kind).toBe(
      "close_early"
    );
  });

  it("pins the window at 48 hours", () => {
    expect(COOLING_OFF_HOURS).toBe(48);
  });

  // Once per company, or signup-refund-repeat becomes a free trial generator.
  it("refuses a second cooling-off refund", () => {
    expect(
      action({
        billingRow: { ...V2, coolingOffRefundedAt: "2026-01-01T00:00:00.000Z" },
      }).kind
    ).toBe("close_early");
  });

  // A rollover period has prepaid_pence 0, so there is nothing to refund and
  // the window must not reopen 28 days into a subscription. This is what stops
  // the cooling-off window recurring every period.
  it("does not apply to a period opened by rollover", () => {
    expect(action({ openPeriod: { ...PERIOD, prepaidPence: 0 } }).kind).toBe(
      "close_early"
    );
  });
});

describe("selectCancellationAction closing early", () => {
  // The cancellation day counts in full, symmetric with the activation day, so
  // the exclusive end is tomorrow.
  it("ends the period at the end of the cancellation day", () => {
    expect(action({ nowISO: "2026-04-01T09:00:00.000Z", todayISO: "2026-04-01" })).toEqual({
      kind: "close_early",
      periodId: "period-1",
      periodEndISO: "2026-04-02",
    });
  });

  it("never extends a period beyond its scheduled end", () => {
    // Cancelling after the period should have closed must not push its end out
    // and bill days the customer was not covered for.
    expect(
      action({ nowISO: "2026-05-01T09:00:00.000Z", todayISO: "2026-05-01" })
    ).toEqual({
      kind: "close_early",
      periodId: "period-1",
      periodEndISO: "2026-04-18",
    });
  });
});

describe("selectCancellationAction with no open period", () => {
  // A dormant company, or one whose last period already closed. There is
  // nothing to bill, but the subscription still has to end.
  it("cancels without closing anything", () => {
    expect(action({ openPeriod: null })).toEqual({ kind: "cancel_only" });
  });
});
