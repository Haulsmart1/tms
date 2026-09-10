import { describe, expect, it } from "vitest";
import {
  collectPeriodVehicles,
  highWaterMark,
  selectCloseAction,
} from "./close";
import type { PeriodLicence } from "./close";

const PERIOD_START = "2026-03-21";
const PERIOD_END = "2026-04-18";

function licence(overrides: Partial<PeriodLicence> = {}): PeriodLicence {
  return {
    vehicleId: "vehicle-1",
    tenantId: "tenant-1",
    vrnNormalised: "AB12CDE",
    activatedOnISO: PERIOD_START,
    deactivatedOnISO: null,
    graceUntilISO: null,
    ...overrides,
  };
}

function collect(licences: readonly PeriodLicence[]) {
  return collectPeriodVehicles({
    periodStartISO: PERIOD_START,
    periodEndISO: PERIOD_END,
    licences,
  });
}

describe("collectPeriodVehicles", () => {
  it("covers a licence active all period from the period start", () => {
    expect(collect([licence()])).toEqual([
      {
        vehicleId: "vehicle-1",
        tenantId: "tenant-1",
        vrnNormalised: "AB12CDE",
        coverageStartISO: PERIOD_START,
      },
    ]);
  });

  it("covers a licence added part way through from its activation", () => {
    const [vehicle] = collect([licence({ activatedOnISO: "2026-04-09" })]);
    expect(vehicle.coverageStartISO).toBe("2026-04-09");
  });

  // Rule 4. Deactivation stops renewal, it does not refund, so the licence
  // still covers to the period end and the deactivation date is not consulted
  // at all when building the line.
  it("ignores a deactivation part way through the period", () => {
    const stillRunning = collect([licence()]);
    const removedEarly = collect([
      licence({ activatedOnISO: PERIOD_START, deactivatedOnISO: "2026-03-24" }),
    ]);

    expect(removedEarly).toEqual(stillRunning);
  });

  // Rule 5. Add, remove, add again inside one period is ONE line, covering
  // from the earliest activation. Otherwise churning a licence would either
  // bill the vehicle twice or reset its coverage to the later date.
  it("produces one line per vehicle however many licences it had", () => {
    const vehicles = collect([
      licence({ activatedOnISO: "2026-03-25", deactivatedOnISO: "2026-03-28" }),
      licence({ activatedOnISO: "2026-04-02" }),
    ]);

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].coverageStartISO).toBe("2026-03-25");
  });

  it("clamps a licence carried over from an earlier period", () => {
    const [vehicle] = collect([licence({ activatedOnISO: "2026-01-05" })]);
    expect(vehicle.coverageStartISO).toBe(PERIOD_START);
  });

  it("keeps separate vehicles apart", () => {
    const vehicles = collect([
      licence({ vehicleId: "a", vrnNormalised: "AA11AAA" }),
      licence({ vehicleId: "b", vrnNormalised: "BB22BBB" }),
    ]);

    expect(vehicles.map((v) => v.vehicleId).sort()).toEqual(["a", "b"]);
  });
});

describe("collectPeriodVehicles overlap", () => {
  it("excludes a licence that ended before the period began", () => {
    expect(
      collect([
        licence({
          activatedOnISO: "2026-01-05",
          deactivatedOnISO: "2026-02-01",
        }),
      ])
    ).toEqual([]);
  });

  it("excludes a licence that starts after the period ends", () => {
    expect(collect([licence({ activatedOnISO: "2026-05-01" })])).toEqual([]);
  });

  it("excludes a licence deactivated on the first day of the period", () => {
    // deactivated_on > period_start is the overlap rule, so a licence ended
    // ON the period start did not overlap it.
    expect(
      collect([
        licence({
          activatedOnISO: "2026-01-05",
          deactivatedOnISO: PERIOD_START,
        }),
      ])
    ).toEqual([]);
  });
});

describe("collectPeriodVehicles grace", () => {
  // Rule 7. Billable time starts when grace ends, so a vehicle activated the
  // day before a period ends with a fortnight of grace produces no billable
  // coverage in this period at all.
  it("starts coverage when grace ends", () => {
    const [vehicle] = collect([
      licence({ activatedOnISO: "2026-04-17", graceUntilISO: "2026-05-01" }),
    ]);

    expect(vehicle.coverageStartISO).toBe("2026-05-01");
  });

  // Which the invoice assembly then drops, because a coverage start at or
  // after the period end is zero billable days. The vehicle reappears next
  // period, charged from the day grace ends.
  it("leaves a wholly-graced vehicle with no billable coverage", () => {
    const [vehicle] = collect([
      licence({ activatedOnISO: "2026-04-17", graceUntilISO: "2026-05-01" }),
    ]);

    expect(vehicle.coverageStartISO >= PERIOD_END).toBe(true);
  });

  it("ignores a grace window that expired before the period", () => {
    const [vehicle] = collect([
      licence({ activatedOnISO: "2026-01-05", graceUntilISO: "2026-01-19" }),
    ]);

    expect(vehicle.coverageStartISO).toBe(PERIOD_START);
  });

  // A vehicle whose first licence carried grace and whose second did not must
  // keep the grace it was granted. Taking the latest grace_until across the
  // vehicle's licences is what does that; taking the latest licence's would
  // silently drop it.
  it("honours grace granted on an earlier licence of the same vehicle", () => {
    const [vehicle] = collect([
      licence({ activatedOnISO: "2026-03-25", graceUntilISO: "2026-04-08" }),
      licence({ activatedOnISO: "2026-04-02" }),
    ]);

    expect(vehicle.coverageStartISO).toBe("2026-04-08");
  });

  // Rule 7's anti-recycling half, seen from the close side: a licence with no
  // grace_until gets none, which is what a second licence on the same VRN
  // will always look like.
  it("gives no grace to a licence that was granted none", () => {
    const [vehicle] = collect([licence({ activatedOnISO: "2026-04-09" })]);
    expect(vehicle.coverageStartISO).toBe("2026-04-09");
  });
});

describe("highWaterMark", () => {
  it("counts a single licence running all period", () => {
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [licence()],
      })
    ).toBe(1);
  });

  it("counts concurrent licences, not total licences", () => {
    // Two vehicles that never overlap: one ran the first week, the other the
    // last. Two lines will be billed, but only one was ever live at a time.
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [
          licence({
            vehicleId: "a",
            activatedOnISO: "2026-03-21",
            deactivatedOnISO: "2026-03-28",
          }),
          licence({
            vehicleId: "b",
            activatedOnISO: "2026-04-10",
          }),
        ],
      })
    ).toBe(1);
  });

  it("finds the peak in the middle of a period", () => {
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [
          licence({ vehicleId: "a", deactivatedOnISO: "2026-04-10" }),
          licence({ vehicleId: "b", deactivatedOnISO: "2026-04-10" }),
          licence({ vehicleId: "c", activatedOnISO: "2026-04-01" }),
          licence({ vehicleId: "d", activatedOnISO: "2026-04-12" }),
        ],
      })
    ).toBe(3);
  });

  // A licence ending on the same day another begins overlapped for part of
  // that day, so both count. Processing activations before deactivations is
  // what makes the sweep report the peak rather than a trough.
  it("counts a handover on the same day as concurrent", () => {
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [
          licence({ vehicleId: "a", deactivatedOnISO: "2026-04-01" }),
          licence({ vehicleId: "b", activatedOnISO: "2026-04-01" }),
        ],
      })
    ).toBe(2);
  });

  // vehicle_licences holds COMPLIANCE documents, not billing seats: a vehicle
  // legitimately carries an O-licence, a waste carrier licence and an ADR
  // certificate at once, and billing treats it as billable if ANY of them is
  // active (see lib/billing/vehicleCount.ts). Counting licences would report
  // a fleet three times its real size.
  it("counts a vehicle once however many licences it holds", () => {
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [
          licence({ vehicleId: "a", vrnNormalised: "AA11AAA" }),
          licence({ vehicleId: "a", vrnNormalised: "AA11AAA" }),
          licence({ vehicleId: "a", vrnNormalised: "AA11AAA" }),
        ],
      })
    ).toBe(1);
  });

  // Overlapping licences on one vehicle keep it continuously live, so the
  // vehicle must not drop out when the first of them ends.
  it("keeps a vehicle live while any of its licences is", () => {
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [
          licence({ vehicleId: "a", deactivatedOnISO: "2026-04-01" }),
          licence({ vehicleId: "a", activatedOnISO: "2026-03-25" }),
          licence({ vehicleId: "b", activatedOnISO: "2026-04-05" }),
        ],
      })
    ).toBe(2);
  });

  it("is zero for a period with no licences", () => {
    expect(
      highWaterMark({
        periodStartISO: PERIOD_START,
        periodEndISO: PERIOD_END,
        licences: [],
      })
    ).toBe(0);
  });
});

describe("selectCloseAction", () => {
  const NOW = "2026-04-18T06:00:00.000Z";

  function action(overrides: Partial<Parameters<typeof selectCloseAction>[0]>) {
    return selectCloseAction({
      status: "open",
      periodEndISO: PERIOD_END,
      todayISO: PERIOD_END,
      closingSinceISO: null,
      nowISO: NOW,
      staleClosingMinutes: 15,
      attemptCount: 0,
      retryOnISO: null,
      ...overrides,
    });
  }

  it("computes the invoice for an open period whose end has arrived", () => {
    expect(action({})).toEqual({ kind: "compute", regenerateLines: false });
  });

  it("leaves an open period alone before its end", () => {
    expect(action({ todayISO: "2026-04-17" })).toEqual({
      kind: "skip",
      reason: "not_due",
    });
  });

  // Only `invoiced` is finished. A cron that fires twice cannot rewrite an
  // invoice already paid.
  it("skips a period that has been paid", () => {
    expect(action({ status: "invoiced" })).toEqual({
      kind: "skip",
      reason: "already_invoiced",
    });
  });

  // THE FIX FOR THE LOST-MONEY BUG. `closed` means the lines are written and
  // the payment has NOT settled: an indeterminate Square answer, a missing env
  // var, a failed status write. Treating it as finished left the period out of
  // the due query forever and the invoice was never collected. It must be
  // picked back up, and it must NOT recompute: the lines are durable and the
  // licence rows behind them have moved on.
  it("collects a closed period rather than treating it as finished", () => {
    expect(action({ status: "closed" })).toEqual({ kind: "collect", attempt: 1 });
  });

  it("does not recompute the lines of a closed period", () => {
    expect(action({ status: "closed" }).kind).not.toBe("compute");
  });

  // A declined period retries on the dunning ladder, not on every cron run.
  // Without this a failing card was hit with a fresh real Square attempt every
  // 24 hours, forever.
  it("retries a failed period only when its retry date arrives", () => {
    expect(
      action({ status: "failed", attemptCount: 1, retryOnISO: "2026-04-20" })
    ).toEqual({ kind: "skip", reason: "awaiting_retry" });

    expect(
      action({
        status: "failed",
        attemptCount: 1,
        retryOnISO: "2026-04-20",
        todayISO: "2026-04-20",
      })
    ).toEqual({ kind: "collect", attempt: 2 });
  });

  it("advances the attempt number so a retry mints a new idempotency key", () => {
    expect(
      action({ status: "failed", attemptCount: 3, retryOnISO: PERIOD_END })
    ).toEqual({ kind: "collect", attempt: 4 });
  });

  // Exhaustion stops the ladder. The company goes past_due and is suspended;
  // continuing to retry would hammer a dead card indefinitely.
  it("stops retrying once the ladder is exhausted", () => {
    expect(
      action({ status: "failed", attemptCount: 4, retryOnISO: PERIOD_END })
    ).toEqual({ kind: "skip", reason: "dunning_exhausted" });
  });

  it("collects a failed period with no retry date recorded", () => {
    expect(
      action({ status: "failed", attemptCount: 0, retryOnISO: null })
    ).toEqual({ kind: "collect", attempt: 1 });
  });

  it("skips a period another run is closing right now", () => {
    expect(
      action({
        status: "closing",
        closingSinceISO: "2026-04-18T05:59:30.000Z",
      })
    ).toEqual({ kind: "skip", reason: "in_progress" });
  });

  // A claim held for an hour is a crashed run. Its lines may be half written,
  // so this one DOES recompute.
  it("reclaims and recomputes a stale closing period", () => {
    expect(
      action({
        status: "closing",
        closingSinceISO: "2026-04-18T05:00:00.000Z",
      })
    ).toEqual({ kind: "compute", regenerateLines: true });
  });

  it("reclaims a closing period with no claim timestamp", () => {
    expect(action({ status: "closing", closingSinceISO: null })).toEqual({
      kind: "compute",
      regenerateLines: true,
    });
  });

  it("reports a paid period as paid rather than not due", () => {
    expect(action({ status: "invoiced", todayISO: "2026-04-01" })).toEqual({
      kind: "skip",
      reason: "already_invoiced",
    });
  });
});
