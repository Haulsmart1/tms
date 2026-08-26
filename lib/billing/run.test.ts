import { describe, expect, it } from "vitest";
import { applyChargeOutcome, selectDueAction, selectRecoveryAction } from "./run";
import type { CompanyBillingRow } from "./run";

function row(overrides: Partial<CompanyBillingRow> = {}): CompanyBillingRow {
  return {
    company_id: "company-1",
    status: "active",
    anchor_day: 26,
    next_charge_on: "2026-08-26",
    retry_at: null,
    retry_count: 0,
    ...overrides,
  };
}

describe("selectDueAction", () => {
  it("charges attempt 1 when the cycle date has arrived", () => {
    expect(selectDueAction(row(), "2026-08-26")).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 1,
    });
  });

  it("also fires when the cycle date was missed (cron downtime)", () => {
    expect(selectDueAction(row(), "2026-08-28")).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 1,
    });
  });

  it("does nothing before the cycle date", () => {
    expect(selectDueAction(row(), "2026-08-25")).toEqual({ kind: "none" });
  });

  it("fires a due retry with the next attempt number", () => {
    const r = row({ retry_at: "2026-08-28", retry_count: 1 });
    expect(selectDueAction(r, "2026-08-28")).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 2,
    });
  });

  it("waits for a future retry even though next_charge_on is past", () => {
    const r = row({ retry_at: "2026-08-28", retry_count: 1 });
    expect(selectDueAction(r, "2026-08-27")).toEqual({ kind: "none" });
  });

  it("never charges a past_due company (dunning halted)", () => {
    const r = row({ status: "past_due", retry_count: 4 });
    expect(selectDueAction(r, "2026-09-26")).toEqual({ kind: "none" });
  });

  it("never charges a canceled company", () => {
    const r = row({ status: "canceled" });
    expect(selectDueAction(r, "2026-09-26")).toEqual({ kind: "none" });
  });
});

describe("applyChargeOutcome", () => {
  it("advances the schedule and clears dunning on success", () => {
    expect(
      applyChargeOutcome({
        row: row({ retry_at: "2026-08-28", retry_count: 1 }),
        cycleDate: "2026-08-26",
        attempt: 2,
        succeeded: true,
      })
    ).toEqual({
      status: "active",
      next_charge_on: "2026-09-26",
      retry_at: null,
      retry_count: 0,
    });
  });

  it("anchor-clamps the advanced date", () => {
    expect(
      applyChargeOutcome({
        row: row({ anchor_day: 31, next_charge_on: "2027-01-31" }),
        cycleDate: "2027-01-31",
        attempt: 1,
        succeeded: true,
      }).next_charge_on
    ).toBe("2027-02-28");
  });

  it("schedules a retry on a non-final failure", () => {
    expect(
      applyChargeOutcome({
        row: row(),
        cycleDate: "2026-08-26",
        attempt: 1,
        succeeded: false,
      })
    ).toEqual({
      status: "active",
      next_charge_on: "2026-08-26",
      retry_at: "2026-08-28",
      retry_count: 1,
    });
  });

  it("goes past_due after the fourth failure", () => {
    expect(
      applyChargeOutcome({
        row: row({ retry_at: "2026-09-01", retry_count: 3 }),
        cycleDate: "2026-08-26",
        attempt: 4,
        succeeded: false,
      })
    ).toEqual({
      status: "past_due",
      next_charge_on: "2026-08-26",
      retry_at: null,
      retry_count: 4,
    });
  });
});

describe("selectRecoveryAction", () => {
  it("retries the outstanding cycle for a past_due company", () => {
    const r = row({ status: "past_due", retry_at: null, retry_count: 4 });
    expect(selectRecoveryAction(r)).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 5,
    });
  });

  it("retries immediately for a company mid-dunning", () => {
    const r = row({ retry_at: "2026-08-30", retry_count: 2 });
    expect(selectRecoveryAction(r)).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 3,
    });
  });

  it("does nothing for a clean active company", () => {
    expect(selectRecoveryAction(row())).toEqual({ kind: "none" });
  });

  it("never charges a canceled company even mid-dunning", () => {
    const r = row({ status: "canceled", retry_at: "2026-08-28", retry_count: 1 });
    expect(selectRecoveryAction(r)).toEqual({ kind: "none" });
  });
});
