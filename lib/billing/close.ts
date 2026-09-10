// Pure decision core of the period close job. The route loads licence rows,
// calls these, hands the result to assembleInvoice, then persists. Nothing
// here touches the network or the DB.
//
// Dates arriving here are London calendar days (YYYY-MM-DD), converted from
// the timestamptz columns at the edge by londonDateISO. The DB keeps full
// timestamps because "when exactly was this activated" is an audit question;
// billing only ever asks which DAY, and doing that conversion once at the
// boundary is what keeps the arithmetic here free of BST.

import type { InvoiceVehicle } from "./invoice";
import { MAX_ATTEMPTS } from "./schedule";

export type PeriodLicence = {
  vehicleId: string;
  tenantId: string;
  vrnNormalised: string;
  activatedOnISO: string;
  /** Null while active. */
  deactivatedOnISO: string | null;
  /** Set only on the first ever licence for this VRN in this company. */
  graceUntilISO: string | null;
};

export type PeriodBounds = {
  periodStartISO: string;
  /** Exclusive. */
  periodEndISO: string;
};

// A licence is in scope when it was live at any point inside the period.
// Deactivation ON the period start means it ended as the period began, so it
// bought nothing here. Activation ON the period end belongs to the next
// period for the same reason the end is exclusive everywhere else.
function overlapsPeriod(
  licence: PeriodLicence,
  bounds: PeriodBounds
): boolean {
  return (
    licence.activatedOnISO < bounds.periodEndISO &&
    (licence.deactivatedOnISO === null ||
      licence.deactivatedOnISO > bounds.periodStartISO)
  );
}

/**
 * Turn a period's licence rows into at most one billable vehicle each.
 *
 * Rule 5 lives here. A vehicle removed and re-added inside one period has two
 * licence rows and must still produce ONE line, covering from its EARLIEST
 * activation. Grouping by vehicle is what makes add-and-remove churn
 * pointless: neither billing the vehicle twice nor resetting its coverage to
 * the later activation is available.
 *
 * Rule 4 is the absence of anything here: `deactivatedOnISO` is used only to
 * decide overlap, never to shorten coverage. A licence removed on day 3 is
 * still billed to the period end, and simply does not reappear next period.
 *
 * Coverage starts at the latest of the period start, the earliest activation,
 * and any grace the vehicle was granted. Grace is taken as the LATEST
 * grace_until across the vehicle's licences rather than from its most recent
 * row: grace is granted once, on the first ever licence for a registration,
 * so reading the newest row would silently discard it the moment the vehicle
 * was re-licensed.
 *
 * A vehicle whose grace outlasts the period is returned with a coverage start
 * at or after the period end. It is dropped by assembleInvoice, which is the
 * single place that decides whether a line exists, rather than being filtered
 * in two places that could disagree.
 */
export function collectPeriodVehicles(args: {
  periodStartISO: string;
  periodEndISO: string;
  licences: readonly PeriodLicence[];
}): InvoiceVehicle[] {
  const bounds = {
    periodStartISO: args.periodStartISO,
    periodEndISO: args.periodEndISO,
  };

  const byVehicle = new Map<string, PeriodLicence[]>();
  for (const licence of args.licences) {
    if (!overlapsPeriod(licence, bounds)) continue;
    const existing = byVehicle.get(licence.vehicleId);
    if (existing) existing.push(licence);
    else byVehicle.set(licence.vehicleId, [licence]);
  }

  const vehicles: InvoiceVehicle[] = [];
  for (const [vehicleId, licences] of byVehicle) {
    let earliestActivation = licences[0].activatedOnISO;
    let latestGrace: string | null = null;

    for (const licence of licences) {
      if (licence.activatedOnISO < earliestActivation) {
        earliestActivation = licence.activatedOnISO;
      }
      if (
        licence.graceUntilISO !== null &&
        (latestGrace === null || licence.graceUntilISO > latestGrace)
      ) {
        latestGrace = licence.graceUntilISO;
      }
    }

    let coverageStartISO = earliestActivation;
    if (coverageStartISO < args.periodStartISO) {
      coverageStartISO = args.periodStartISO;
    }
    if (latestGrace !== null && latestGrace > coverageStartISO) {
      coverageStartISO = latestGrace;
    }

    // The registration is taken from the licence that started the coverage,
    // so a line reads with the plate the vehicle carried when it began
    // costing money rather than whatever it was last re-registered as.
    const originating =
      licences.find((l) => l.activatedOnISO === earliestActivation) ??
      licences[0];

    vehicles.push({
      vehicleId,
      tenantId: originating.tenantId,
      vrnNormalised: originating.vrnNormalised,
      coverageStartISO,
    });
  }

  return vehicles;
}

/**
 * The largest number of VEHICLES live at once inside the period.
 *
 * Vehicles, not licences, and this is a correction to the brief rather than a
 * paraphrase of it. public.vehicle_licences holds COMPLIANCE documents: the
 * page at app/settings/licences asks for a free-text licence type, an issue
 * date and an expiry date, so one vehicle legitimately carries an O-licence, a
 * waste carrier licence and an ADR certificate at the same time. Billing reads
 * the set as "billable if ANY licence is active" (lib/billing/vehicleCount.ts),
 * so counting licence rows would report a fleet several times its real size,
 * and it would do so silently, on a number nobody reconciles.
 *
 * A vehicle is live while ANY of its licences is, so the sweep tracks a count
 * per vehicle and moves the total only on a 0-to-1 or 1-to-0 transition.
 *
 * Informational, and deliberately NOT the number of invoice lines. Two
 * vehicles that never overlapped, one running the first week and one the
 * last, produce two lines but a high-water mark of one. The lines are what
 * the customer pays; this is what they actually ran, and the two answering
 * different questions is the point of storing it.
 *
 * Activations are applied before deactivations on a shared day, because a
 * licence ending the day another begins did overlap it for part of that day.
 * Sweeping the other way would report a trough rather than a peak.
 */
export function highWaterMark(args: {
  periodStartISO: string;
  periodEndISO: string;
  licences: readonly PeriodLicence[];
}): number {
  const bounds = {
    periodStartISO: args.periodStartISO,
    periodEndISO: args.periodEndISO,
  };

  type Event = { onISO: string; delta: number; vehicleId: string };
  const events: Event[] = [];

  for (const licence of args.licences) {
    if (!overlapsPeriod(licence, bounds)) continue;

    // Clamped, so a licence carried in from an earlier period counts from the
    // first day of this one rather than sorting before every other event and
    // still arriving at the same total by luck.
    const startISO =
      licence.activatedOnISO < args.periodStartISO
        ? args.periodStartISO
        : licence.activatedOnISO;
    events.push({ onISO: startISO, delta: 1, vehicleId: licence.vehicleId });

    // A deactivation at or after the period end did not reduce the count
    // inside this period.
    if (
      licence.deactivatedOnISO !== null &&
      licence.deactivatedOnISO < args.periodEndISO
    ) {
      events.push({
        onISO: licence.deactivatedOnISO,
        delta: -1,
        vehicleId: licence.vehicleId,
      });
    }
  }

  events.sort((a, b) => {
    const byDate = a.onISO.localeCompare(b.onISO);
    if (byDate !== 0) return byDate;
    return b.delta - a.delta; // +1 before -1 on the same day
  });

  // Licences held per vehicle, so the total only moves when a vehicle gains
  // its first live licence or loses its last.
  const perVehicle = new Map<string, number>();
  let live = 0;
  let peak = 0;

  for (const event of events) {
    const before = perVehicle.get(event.vehicleId) ?? 0;
    const after = before + event.delta;
    perVehicle.set(event.vehicleId, after);

    if (before === 0 && after > 0) live += 1;
    else if (before > 0 && after === 0) live -= 1;

    if (live > peak) peak = live;
  }
  return peak;
}

export type PeriodStatus = "open" | "closing" | "closed" | "invoiced" | "failed";

export type CloseAction =
  /** Build the invoice from licence rows. */
  | { kind: "compute"; regenerateLines: boolean }
  /** The lines already exist and are durable; only the payment is outstanding. */
  | { kind: "collect"; attempt: number }
  | {
      kind: "skip";
      reason:
        | "not_due"
        | "already_invoiced"
        | "in_progress"
        | "awaiting_retry"
        | "dunning_exhausted";
    };

/**
 * What this run should do with a period.
 *
 * COMPUTING AND COLLECTING ARE SEPARATE, and conflating them lost money. The
 * earlier version marked a period `closed` before charging and treated
 * `closed` as finished, so any exit other than a clean decline (an
 * indeterminate answer from Square, a missing env var, a failed status write)
 * left the period out of the due query permanently and its invoice was never
 * collected. Only `invoiced` means finished now:
 *
 *   open       no lines yet: compute them
 *   closing    a run holds this, or one crashed holding it. The claim itself
 *              is a conditional UPDATE in Postgres, which is what actually
 *              makes concurrent runs safe; this only decides how long a claim
 *              may sit before it is treated as abandoned. A reclaim DOES
 *              recompute, because a crashed run may have written half its
 *              lines.
 *   closed     lines are written, payment is outstanding. Collect, and do NOT
 *              recompute: the lines are the invoice the customer incurred, and
 *              the licence rows behind them have moved on since.
 *   failed     a payment was declined. Collect again, but only on the dunning
 *              ladder, and never past exhaustion.
 *   invoiced   done.
 *
 * The ladder is the same one v1 uses (nextRetryOn: attempts on days 1, 3, 5
 * and 7 from the close date). Without it a `failed` period was re-selected on
 * every daily run, so a declining card took a fresh real Square attempt every
 * 24 hours indefinitely and the company was never suspended.
 */
export function selectCloseAction(args: {
  status: PeriodStatus;
  periodEndISO: string;
  todayISO: string;
  closingSinceISO: string | null;
  nowISO: string;
  staleClosingMinutes: number;
  /** Settled payment attempts against this period so far. */
  attemptCount: number;
  /** When the next dunning attempt is due, or null for "now". */
  retryOnISO: string | null;
}): CloseAction {
  // Before the due check on purpose: a paid period is finished whatever its
  // dates say, and reporting it as "not due" would be misleading in the log.
  if (args.status === "invoiced") {
    return { kind: "skip", reason: "already_invoiced" };
  }

  if (args.periodEndISO > args.todayISO) {
    return { kind: "skip", reason: "not_due" };
  }

  if (args.status === "closing") {
    if (args.closingSinceISO === null) {
      return { kind: "compute", regenerateLines: true };
    }
    const heldForMs =
      Date.parse(args.nowISO) - Date.parse(args.closingSinceISO);
    if (heldForMs >= args.staleClosingMinutes * 60_000) {
      return { kind: "compute", regenerateLines: true };
    }
    return { kind: "skip", reason: "in_progress" };
  }

  if (args.status === "open") {
    return { kind: "compute", regenerateLines: false };
  }

  // closed or failed: the lines exist, so this is a collection question.
  if (args.status === "failed") {
    if (args.attemptCount >= MAX_ATTEMPTS) {
      return { kind: "skip", reason: "dunning_exhausted" };
    }
    if (args.retryOnISO !== null && args.retryOnISO > args.todayISO) {
      return { kind: "skip", reason: "awaiting_retry" };
    }
  }

  return { kind: "collect", attempt: args.attemptCount + 1 };
}
