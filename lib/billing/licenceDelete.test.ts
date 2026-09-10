import { describe, expect, it } from "vitest";
import { selectLicenceDeleteAction } from "./licenceDelete";

const ACTIVATED = "2026-03-21T10:00:00.000Z";

function action(overrides: Partial<Parameters<typeof selectLicenceDeleteAction>[0]> = {}) {
  return selectLicenceDeleteAction({
    isPeriodBilling: true,
    active: false,
    activatedAtISO: ACTIVATED,
    deactivatedAtISO: ACTIVATED,
    ...overrides,
  });
}

describe("selectLicenceDeleteAction under v1", () => {
  // THE REGRESSION THIS EXISTS TO PREVENT. Under v1 the cycle is PREPAID and
  // vehicle_cycle_coverage records what a payment bought, so billing_03
  // deliberately kept the browser's delete grant: removing a licence can only
  // reduce a bill. Applying the arrears rule to v1 took away an operation
  // every company had, and since every company is v1 today, it took it away
  // from all of them.
  it("allows deleting a licence that has been active", () => {
    expect(
      action({
        isPeriodBilling: false,
        deactivatedAtISO: "2026-03-25T10:00:00.000Z",
      })
    ).toEqual({ kind: "delete" });
  });

  it("allows deleting a licence that is still active", () => {
    expect(
      action({ isPeriodBilling: false, active: true, deactivatedAtISO: null })
    ).toEqual({ kind: "delete" });
  });
});

describe("selectLicenceDeleteAction under v2", () => {
  // A licence created inactive has bought nothing: the sync trigger writes a
  // zero-length row, which is the shape the billing_07 backfill produces too.
  // This is the typo case, and it is the reason delete survives at all.
  it("allows deleting a licence that was never activated", () => {
    expect(action()).toEqual({ kind: "delete" });
  });

  // Anything that ran for even a second has deactivated_at strictly greater,
  // and is evidence the invoice was computed from.
  it("refuses a licence that was active and is now off", () => {
    expect(
      action({ deactivatedAtISO: "2026-03-21T10:00:01.000Z" })
    ).toEqual({ kind: "blocked", reason: "was_active" });
  });

  it("refuses a licence that is still active", () => {
    expect(action({ active: true, deactivatedAtISO: null })).toEqual({
      kind: "blocked",
      reason: "was_active",
    });
  });

  // Fails closed. A row with no lifecycle recorded cannot be shown to have
  // bought nothing, and deleting billing evidence on the strength of a missing
  // value is the wrong direction to guess in.
  it("refuses when the lifecycle is unknown", () => {
    expect(action({ activatedAtISO: null, deactivatedAtISO: null })).toEqual({
      kind: "blocked",
      reason: "was_active",
    });
  });
});
