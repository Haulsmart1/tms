// Supabase calls for period billing. Every decision is delegated to the pure
// modules (period, close, invoice, periodPayment); this file only loads rows,
// writes rows, and sequences the payment call.
//
// Deliberately thin. vitest covers lib/**/*.test.ts but nothing here can be
// unit tested without a database, so anything worth asserting has been pushed
// into a pure function that is. If a branch below starts making a decision,
// that decision belongs in close.ts or invoice.ts instead.

import type { SupabaseClient } from "@supabase/supabase-js";

import { assembleInvoice, estimateVehicleAddition } from "./invoice";
import type { AssembledLine } from "./invoice";
import {
  collectPeriodVehicles,
  highWaterMark,
  selectCloseAction,
} from "./close";
import type { PeriodLicence, PeriodStatus } from "./close";
import { nextPeriodBounds } from "./period";
import { selectActivationAction } from "./activation";
import type { ActivationAction } from "./activation";
import { balanceDue } from "./periodPayment";
import type { PeriodPaymentProvider } from "./periodPayment";
import { londonDateISO } from "./schedule";

// Mirrors lib/billing/server.ts. PostgREST caps an unscoped select at 1000
// rows by default, and a truncated result here would silently under-bill, so
// every query below refuses rather than proceeds. Same discipline, same
// number, stated again rather than imported because server.ts keeps it
// private.
const POSTGREST_ROW_CAP = 1000;

const CLOSE_REASON_SCHEDULED = "scheduled";

export type CompanyBillingSettings = {
  company_id: string;
  billing_model: string;
  status: string;
  currency: string;
  unit_amount_pence: number;
  min_invoice_pence: number;
  included_vehicles: number;
  grace_days: number;
  min_bill_days: number;
  vat_rate?: number;
};

export type PeriodRow = {
  id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  status: PeriodStatus;
  closing_since: string | null;
  prepaid_pence: number;
};

/**
 * Every vehicle belonging to a company.
 *
 * Mirrors fetchBillableVehicles' join exactly, and the comment there applies
 * unchanged: `vehicles` is keyed by tenant_id only, there is NO company_id
 * column, and filtering on one answers PostgREST 42703 and fails the whole
 * run. companyId is in the list because some rows carry a company id in
 * tenant_id directly, and because it keeps `in.(...)` non-empty for a company
 * with no tenants.
 */
async function fetchCompanyVehicleIds(
  admin: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const tenantsRes = await admin
    .from("tenants")
    .select("id")
    .eq("company_id", companyId);
  if (tenantsRes.error) throw new Error(tenantsRes.error.message);

  const idList = [
    ...(tenantsRes.data ?? []).map((t) => t.id as string),
    companyId,
  ];

  const vehiclesRes = await admin
    .from("vehicles")
    .select("id")
    .in("tenant_id", idList);
  if (vehiclesRes.error) throw new Error(vehiclesRes.error.message);

  const vehicles = vehiclesRes.data ?? [];
  if (vehicles.length >= POSTGREST_ROW_CAP) {
    throw new Error(
      `Billing refused: vehicle query hit the ${POSTGREST_ROW_CAP}-row cap for company ${companyId}; the invoice would be incomplete`
    );
  }
  return vehicles.map((v) => v.id as string);
}

/**
 * Every licence for a company's vehicles, converted to London calendar days.
 *
 * NOT filtered by period in SQL, deliberately. activated_at is timestamptz and
 * a period boundary is a London date, so `activated_at < '2026-04-18'` would
 * compare against UTC midnight: a licence activated at 00:30 BST on the 18th
 * is 23:30 UTC on the 17th and would fall on the wrong side of it. Converting
 * first and letting collectPeriodVehicles apply the overlap rule keeps one
 * definition of "which day is this" instead of two that disagree twice a year.
 */
async function fetchCompanyLicences(
  admin: SupabaseClient,
  vehicleIds: readonly string[]
): Promise<PeriodLicence[]> {
  if (vehicleIds.length === 0) return [];

  const res = await admin
    .from("vehicle_licences")
    .select(
      "vehicle_id, tenant_id, vrn_normalised, activated_at, deactivated_at, grace_until"
    )
    .in("vehicle_id", vehicleIds as string[]);
  if (res.error) throw new Error(res.error.message);

  const rows = res.data ?? [];
  if (rows.length >= POSTGREST_ROW_CAP) {
    throw new Error(
      `Billing refused: licence query hit the ${POSTGREST_ROW_CAP}-row cap; the invoice would be incomplete`
    );
  }

  return rows.map((row) => ({
    vehicleId: row.vehicle_id as string,
    tenantId: (row.tenant_id as string) ?? "",
    vrnNormalised: (row.vrn_normalised as string) ?? (row.vehicle_id as string),
    activatedOnISO: londonDateISO(new Date(row.activated_at as string)),
    deactivatedOnISO: row.deactivated_at
      ? londonDateISO(new Date(row.deactivated_at as string))
      : null,
    graceUntilISO: row.grace_until
      ? londonDateISO(new Date(row.grace_until as string))
      : null,
  }));
}

/**
 * Open a period for a company, idempotently.
 *
 * Returns the existing open period untouched if there is one. The
 * one-open-period-per-company unique index in billing_06 is the real
 * guarantee: two concurrent callers race, one insert wins, and the loser reads
 * the winner's row rather than opening an overlapping period that would bill
 * the same days twice.
 */
export async function ensureOpenPeriod(
  admin: SupabaseClient,
  companyId: string,
  startISO: string,
  prepaidPence: number
): Promise<PeriodRow> {
  const existing = await admin
    .from("billing_periods")
    .select("id, company_id, period_start, period_end, status, closing_since, prepaid_pence")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as PeriodRow;

  const bounds = nextPeriodBounds(startISO);
  const inserted = await admin
    .from("billing_periods")
    .insert({
      company_id: companyId,
      period_start: bounds.periodStartISO,
      period_end: bounds.periodEndISO,
      status: "open",
      prepaid_pence: prepaidPence,
    })
    .select("id, company_id, period_start, period_end, status, closing_since, prepaid_pence")
    .single();

  if (inserted.error) {
    // 23505 is the one-open-period index firing, which means a concurrent
    // caller won. Read theirs rather than failing: both callers wanted "there
    // is an open period", and there is.
    if (inserted.error.code === "23505") {
      const raced = await admin
        .from("billing_periods")
        .select("id, company_id, period_start, period_end, status, closing_since, prepaid_pence")
        .eq("company_id", companyId)
        .eq("status", "open")
        .single();
      if (raced.error) throw new Error(raced.error.message);
      return raced.data as PeriodRow;
    }
    throw new Error(inserted.error.message);
  }

  return inserted.data as PeriodRow;
}

export type CloseOutcome = {
  periodId: string;
  companyId: string;
  result:
    | "closed"
    | "skipped_not_due"
    | "skipped_already_closed"
    | "skipped_in_progress"
    | "skipped_not_v2"
    | "skipped_claim_lost"
    | "failed";
  netPence?: number;
  grossPence?: number;
  vehicleCount?: number;
  error?: string;
};

/**
 * Close every period whose end has arrived, then take the balance.
 *
 * Called from the daily cron alongside the v1 charge run. Ordering inside one
 * period is deliberate and not interchangeable:
 *
 *   1. CLAIM with a compare-and-set. This, not selectCloseAction, is what
 *      makes concurrent runs safe: `update ... where id = ? and status = ?`
 *      either updates one row or none, and a run that updates none had the
 *      period taken from under it and must not proceed.
 *   2. WRITE THE LINES, and only then charge. The amount therefore comes from
 *      rows that are already durable, so a retry rebuilds a byte-identical
 *      request body. billing_05 exists because the add-on path could not do
 *      this; here it falls out of the ordering for free.
 *   3. Mark the period closed BEFORE paying. A payment failure must leave the
 *      lines in place and the period `failed`, so the close is never
 *      recomputed from licence rows that have moved on since.
 */
export async function closeDuePeriods(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  opts: { todayISO: string; nowISO: string; staleClosingMinutes?: number }
): Promise<CloseOutcome[]> {
  const staleClosingMinutes = opts.staleClosingMinutes ?? 15;

  const dueRes = await admin
    .from("billing_periods")
    .select("id, company_id, period_start, period_end, status, closing_since, prepaid_pence")
    .lte("period_end", opts.todayISO)
    .in("status", ["open", "closing", "failed"])
    .order("period_end", { ascending: true });
  if (dueRes.error) throw new Error(dueRes.error.message);

  const due = (dueRes.data ?? []) as PeriodRow[];
  if (due.length >= POSTGREST_ROW_CAP) {
    throw new Error(
      `Billing refused: due-period query hit the ${POSTGREST_ROW_CAP}-row cap; some companies would be silently skipped`
    );
  }
  if (due.length === 0) return [];

  const settingsRes = await admin
    .from("company_billing")
    .select(
      "company_id, billing_model, status, currency, unit_amount_pence, min_invoice_pence, included_vehicles, grace_days, min_bill_days"
    )
    .in("company_id", [...new Set(due.map((p) => p.company_id))]);
  if (settingsRes.error) throw new Error(settingsRes.error.message);

  const settingsByCompany = new Map<string, CompanyBillingSettings>(
    (settingsRes.data ?? []).map((row) => [
      row.company_id as string,
      row as CompanyBillingSettings,
    ])
  );

  const outcomes: CloseOutcome[] = [];

  for (const period of due) {
    const settings = settingsByCompany.get(period.company_id);

    // No settings row cannot be a v2 company: the flag lives on it. Skipping
    // rather than defaulting is the fail-closed direction, since defaulting
    // would invoice a company nobody has opted in.
    if (!settings || settings.billing_model !== "v2_period") {
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "skipped_not_v2",
      });
      continue;
    }

    const action = selectCloseAction({
      status: period.status,
      periodEndISO: period.period_end,
      todayISO: opts.todayISO,
      closingSinceISO: period.closing_since,
      nowISO: opts.nowISO,
      staleClosingMinutes,
    });

    if (action.kind === "skip") {
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result:
          action.reason === "not_due"
            ? "skipped_not_due"
            : action.reason === "in_progress"
              ? "skipped_in_progress"
              : "skipped_already_closed",
      });
      continue;
    }

    try {
      outcomes.push(
        await closeOnePeriod(admin, provider, {
          period,
          settings,
          regenerateLines: action.regenerateLines,
          nowISO: opts.nowISO,
        })
      );
    } catch (error) {
      // One company's failure must not stop the run. The period is left in
      // whatever state it reached; selectCloseAction's stale-claim rule brings
      // it back on a later run.
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}

async function closeOnePeriod(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  args: {
    period: PeriodRow;
    settings: CompanyBillingSettings;
    regenerateLines: boolean;
    nowISO: string;
  }
): Promise<CloseOutcome> {
  const { period, settings } = args;

  // THE CLAIM. Compare-and-set on the status we read, so a concurrent run that
  // already moved this period updates zero rows here and this one stands down.
  const claim = await admin
    .from("billing_periods")
    .update({ status: "closing", closing_since: args.nowISO })
    .eq("id", period.id)
    .eq("status", period.status)
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) {
    return {
      periodId: period.id,
      companyId: period.company_id,
      result: "skipped_claim_lost",
    };
  }

  // Regenerating means REPLACING, never appending. A failed period kept its
  // lines so the close would not be recomputed; a deliberate re-run must clear
  // them or the invoice doubles.
  if (args.regenerateLines) {
    const cleared = await admin
      .from("invoice_lines")
      .delete()
      .eq("billing_period_id", period.id);
    if (cleared.error) throw new Error(cleared.error.message);
  }

  const vehicleIds = await fetchCompanyVehicleIds(admin, period.company_id);
  const licences = await fetchCompanyLicences(admin, vehicleIds);

  const vehicles = collectPeriodVehicles({
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
    licences,
  });

  const vatRate = settings.vat_rate ?? 20;
  const invoice = assembleInvoice({
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
    vehicles,
    minBillDays: settings.min_bill_days,
    unitAmountPence: settings.unit_amount_pence,
    minimumPence: settings.min_invoice_pence,
    includedVehicles: settings.included_vehicles,
    vatRatePercent: vatRate,
  });

  if (invoice.lines.length > 0) {
    const rows = invoice.lines.map((line: AssembledLine) => ({
      company_id: period.company_id,
      billing_period_id: period.id,
      kind: line.kind,
      vehicle_id: line.vehicleId,
      tenant_id: line.tenantId,
      vrn_normalised: line.vrnNormalised,
      coverage_start: line.coverageStartISO,
      coverage_end: line.coverageEndISO,
      actual_days: line.actualDays,
      billable_days: line.billableDays,
      unit_amount_pence: line.unitAmountPence,
      net_pence: line.netPence,
      included_in_plan: line.includedInPlan,
      description: line.description,
    }));

    const insertLines = await admin.from("invoice_lines").insert(rows);
    if (insertLines.error) throw new Error(insertLines.error.message);
  }

  const closed = await admin
    .from("billing_periods")
    .update({
      status: "closed",
      closed_at: args.nowISO,
      closed_reason: CLOSE_REASON_SCHEDULED,
      high_water_mark: highWaterMark({
        periodStartISO: period.period_start,
        periodEndISO: period.period_end,
        licences,
      }),
      net_pence: invoice.netPence,
      vat_pence: invoice.vatPence,
      gross_pence: invoice.grossPence,
      vat_rate: vatRate,
    })
    .eq("id", period.id)
    .select("id")
    .single();
  if (closed.error) throw new Error(closed.error.message);

  // The next period opens only while the company still runs something. A
  // company with nothing active gets no period, so it accrues nothing and sees
  // no zero-pound invoice; its next activation opens one and takes the minimum,
  // exactly as a first activation does.
  //
  // prepaid_pence is 0 on a rollover. The minimum is collected up front only
  // when a period is opened by an ACTIVATION, where it buys card proof on a
  // customer who has never paid. By the time a period rolls over the card has
  // settled at least once, and charging the minimum here would put two
  // transactions on the customer's statement on the same day.
  const stillActive = licences.some((l) => l.deactivatedOnISO === null);
  if (stillActive) {
    await ensureOpenPeriod(admin, period.company_id, period.period_end, 0);
  }

  const balance = balanceDue(invoice.netPence, period.prepaid_pence, vatRate);

  const payment = await provider.charge({
    companyId: period.company_id,
    periodId: period.id,
    kind: "balance",
    attempt: 1,
    netPence: balance.netPence,
    vatPence: balance.vatPence,
    grossPence: balance.grossPence,
    currency: settings.currency,
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
  });

  if (payment.status === "failed") {
    // The lines stay. `failed` is what stops the close being recomputed later
    // from licence rows that have moved on, so the customer is chased for the
    // invoice they actually incurred.
    await admin
      .from("billing_periods")
      .update({ status: "failed" })
      .eq("id", period.id);

    return {
      periodId: period.id,
      companyId: period.company_id,
      result: "failed",
      error: payment.failureCode,
      netPence: invoice.netPence,
      grossPence: invoice.grossPence,
      vehicleCount: invoice.vehicleCount,
    };
  }

  if (payment.status === "succeeded") {
    await admin
      .from("billing_periods")
      .update({
        status: "invoiced",
        provider_invoice_id: payment.providerPaymentId,
      })
      .eq("id", period.id);
  }

  // `skipped` leaves the period `closed`, not `invoiced`. Nothing was owed, or
  // no provider is configured; either way claiming it was invoiced would make
  // an unpaid period look settled.
  return {
    periodId: period.id,
    companyId: period.company_id,
    result: "closed",
    netPence: invoice.netPence,
    grossPence: invoice.grossPence,
    vehicleCount: invoice.vehicleCount,
  };
}


// PostgREST answers 42703 ("column does not exist") when billing_06 has not
// been applied yet. That is not an error to propagate: the flag lives on the
// column, so a database without it has no v2 company by definition, and
// `legacy` is the only correct answer.
//
// Narrow on purpose. A blanket catch here would hide a real outage behind
// silent v1 behaviour, and the one thing worse than a broken deploy is a
// deploy that looks fine while billing the wrong model. 42703 is unambiguous;
// nothing else is tolerated.
//
// This exists because resolveActivation runs on EVERY licence activation. A
// hard failure would mean nobody can add a vehicle until the SQL is applied,
// which is an outage of the kind billing_03's header warns about, and it would
// arrive on the deploy rather than on the migration.
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

export type ResolvedActivation = {
  action: ActivationAction;
  settings: CompanyBillingSettings | null;
};

/**
 * Load everything selectActivationAction needs and ask it what to do.
 *
 * Returns `legacy` for any company that is not on v2, which is what lets the
 * caller fall straight through to the path that exists today.
 */
export async function resolveActivation(
  admin: SupabaseClient,
  companyId: string,
  todayISO: string
): Promise<ResolvedActivation> {
  const settingsRes = await admin
    .from("company_billing")
    .select(
      "company_id, billing_model, status, currency, unit_amount_pence, min_invoice_pence, included_vehicles, grace_days, min_bill_days, square_card_id, square_customer_id"
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (settingsRes.error) {
    if (isMissingColumn(settingsRes.error)) {
      return { action: { kind: "legacy" }, settings: null };
    }
    throw new Error(settingsRes.error.message);
  }

  const settings = settingsRes.data as
    | (CompanyBillingSettings & {
        square_card_id: string | null;
        square_customer_id: string | null;
      })
    | null;

  if (!settings || settings.billing_model !== "v2_period") {
    return { action: { kind: "legacy" }, settings: null };
  }

  const openRes = await admin
    .from("billing_periods")
    .select("id, period_start, period_end")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (openRes.error) throw new Error(openRes.error.message);

  const openPeriod = openRes.data
    ? {
        id: openRes.data.id as string,
        periodStartISO: openRes.data.period_start as string,
        periodEndISO: openRes.data.period_end as string,
      }
    : null;

  // A pending minimum means a Square call whose outcome was never recorded.
  // Only asked when there IS an open period, since that is the only case the
  // answer changes.
  let openPeriodMinimumPending = false;
  if (openPeriod) {
    const pendingRes = await admin
      .from("period_charges")
      .select("id")
      .eq("billing_period_id", openPeriod.id)
      .eq("kind", "minimum")
      .eq("status", "pending")
      .maybeSingle();
    if (pendingRes.error) throw new Error(pendingRes.error.message);
    openPeriodMinimumPending = Boolean(pendingRes.data);
  }

  return {
    action: selectActivationAction({
      billingRow: {
        billingModel: "v2_period",
        status: settings.status as "active" | "past_due" | "canceled",
        hasPaymentMethod: Boolean(
          settings.square_card_id && settings.square_customer_id
        ),
      },
      openPeriod,
      openPeriodMinimumPending,
      todayISO,
      minimumPence: settings.min_invoice_pence,
    }),
    settings,
  };
}

/**
 * Open the company's period and take the minimum up front.
 *
 * ORDER, and it is the same rule the v1 route follows for the same reason:
 * take the money FIRST, write the licence LAST. The caller writes the licence
 * only on a true return here, so a decline leaves no billable vehicle behind.
 *
 * On a decline the period is DELETED. Leaving it would be worse than useless:
 * the next attempt would find an open period, take the join branch, let the
 * vehicle in without charging, and leave prepaid_pence at 0 so the customer is
 * billed the whole period at close on top of a minimum they never paid.
 *
 * An indeterminate payment throws out of here with the period intact and a
 * pending charge row, which is exactly the state selectActivationAction blocks
 * on. That is deliberate: the money may have moved, and guessing either way is
 * worse than telling the customer it is still settling.
 */
export async function openPeriodAndChargeMinimum(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  args: {
    companyId: string;
    periodStartISO: string;
    settings: CompanyBillingSettings;
    minimumPence: number;
  }
): Promise<{ ok: true; periodId: string } | { ok: false; failureCode: string }> {
  const vatRate = args.settings.vat_rate ?? 20;
  const period = await ensureOpenPeriod(
    admin,
    args.companyId,
    args.periodStartISO,
    0
  );

  const vatPence = Math.floor((args.minimumPence * vatRate + 50) / 100);

  const payment = await provider.charge({
    companyId: args.companyId,
    periodId: period.id,
    kind: "minimum",
    attempt: 1,
    netPence: args.minimumPence,
    vatPence,
    grossPence: args.minimumPence + vatPence,
    currency: args.settings.currency,
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
  });

  if (payment.status === "failed") {
    await admin.from("billing_periods").delete().eq("id", period.id);
    return { ok: false, failureCode: payment.failureCode };
  }

  // `skipped` means no provider is configured, or the minimum is zero. The
  // period stands and records what it actually collected, which for a skipped
  // charge is nothing: prepaid_pence must never claim money that did not move,
  // or the close job would net it off a real invoice.
  const collected = payment.status === "succeeded" ? args.minimumPence : 0;
  await admin
    .from("billing_periods")
    .update({ prepaid_pence: collected })
    .eq("id", period.id);

  return { ok: true, periodId: period.id };
}

/**
 * When this vehicle's free window ends, or null for no grace.
 *
 * RULE 7. Grace is granted only on the FIRST ever licence for a registration
 * within the company, matched on the normalised VRN, so deleting and re-adding
 * a vehicle cannot recycle it. Returns null the moment any prior licence
 * exists for that registration, whatever its state.
 *
 * grace_days is 0 for every company at launch, so this returns `now` and
 * changes nothing. It exists so switching grace on is a config change.
 */
export async function computeGraceUntil(
  admin: SupabaseClient,
  args: {
    companyId: string;
    vehicleIds: readonly string[];
    vrnNormalised: string;
    graceDays: number;
    nowISO: string;
  }
): Promise<string | null> {
  if (args.graceDays <= 0) return null;
  if (args.vehicleIds.length === 0) return null;

  // Scoped to the company's own vehicles, so one company's history cannot deny
  // grace to another's identically-plated vehicle.
  const priorRes = await admin
    .from("vehicle_licences")
    .select("id")
    .in("vehicle_id", args.vehicleIds as string[])
    .eq("vrn_normalised", args.vrnNormalised)
    .limit(1)
    .maybeSingle();
  if (priorRes.error) throw new Error(priorRes.error.message);
  if (priorRes.data) return null;

  const until = new Date(args.nowISO);
  until.setUTCDate(until.getUTCDate() + args.graceDays);
  return until.toISOString();
}

export { fetchCompanyVehicleIds };

export type AdditionQuote =
  /** Not a v2 company; the caller has nothing to show from this model. */
  | { model: "v1_immediate" }
  /** No period is open, so this vehicle would open one and pay the minimum. */
  | {
      model: "v2_period";
      kind: "opens_period";
      netPence: number;
      vatPence: number;
      grossPence: number;
      periodStartISO: string;
      periodEndISO: string;
    }
  | {
      model: "v2_period";
      kind: "joins_period";
      netPence: number;
      vatPence: number;
      grossPence: number;
      billableDays: number;
      periodStartISO: string;
      periodEndISO: string;
    };

/**
 * What adding this vehicle would cost, for the UI to show BEFORE the click.
 *
 * Read-only. Charges nothing, writes nothing, and opens no period.
 */
export async function quoteVehicleAddition(
  admin: SupabaseClient,
  companyId: string,
  vehicleId: string,
  todayISO: string
): Promise<AdditionQuote> {
  const settingsRes = await admin
    .from("company_billing")
    .select(
      "company_id, billing_model, status, currency, unit_amount_pence, min_invoice_pence, included_vehicles, grace_days, min_bill_days"
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (settingsRes.error) {
    if (isMissingColumn(settingsRes.error)) return { model: "v1_immediate" };
    throw new Error(settingsRes.error.message);
  }

  const settings = settingsRes.data as CompanyBillingSettings | null;
  if (!settings || settings.billing_model !== "v2_period") {
    return { model: "v1_immediate" };
  }

  const vatRate = settings.vat_rate ?? 20;

  const openRes = await admin
    .from("billing_periods")
    .select("id, period_start, period_end")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (openRes.error) throw new Error(openRes.error.message);

  // No open period: this vehicle would open one and the minimum falls due up
  // front. Quoting the minimum rather than a prorated line is the honest
  // answer, and it is the number that will actually leave their card today.
  if (!openRes.data) {
    const bounds = nextPeriodBounds(todayISO);
    const vatPence = Math.floor(
      (settings.min_invoice_pence * vatRate + 50) / 100
    );
    return {
      model: "v2_period",
      kind: "opens_period",
      netPence: settings.min_invoice_pence,
      vatPence,
      grossPence: settings.min_invoice_pence + vatPence,
      periodStartISO: bounds.periodStartISO,
      periodEndISO: bounds.periodEndISO,
    };
  }

  const periodStartISO = openRes.data.period_start as string;
  const periodEndISO = openRes.data.period_end as string;

  const vehicleIds = await fetchCompanyVehicleIds(admin, companyId);
  const licences = await fetchCompanyLicences(admin, vehicleIds);
  const existing = collectPeriodVehicles({
    periodStartISO,
    periodEndISO,
    licences,
  }).filter((v) => v.vehicleId !== vehicleId);

  const estimate = estimateVehicleAddition({
    periodStartISO,
    periodEndISO,
    existingVehicles: existing,
    newVehicle: {
      vehicleId,
      tenantId: "",
      vrnNormalised: vehicleId,
      // Coverage would start today. Grace is not applied here: grace_days is 0
      // for every company, and quoting a free window that a concurrent
      // activation on the same registration could consume would be a quote we
      // cannot honour.
      coverageStartISO: todayISO,
    },
    minBillDays: settings.min_bill_days,
    unitAmountPence: settings.unit_amount_pence,
    minimumPence: settings.min_invoice_pence,
    includedVehicles: settings.included_vehicles,
    vatRatePercent: vatRate,
  });

  return {
    model: "v2_period",
    kind: "joins_period",
    netPence: estimate.netPence,
    vatPence: estimate.vatPence,
    grossPence: estimate.grossPence,
    billableDays: estimate.billableDays,
    periodStartISO,
    periodEndISO,
  };
}
