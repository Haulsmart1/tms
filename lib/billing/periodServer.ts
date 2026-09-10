// Supabase calls for period billing. Every decision is delegated to the pure
// modules (period, close, invoice, periodPayment); this file only loads rows,
// writes rows, and sequences the payment call.
//
// Deliberately thin. vitest covers lib/**/*.test.ts but nothing here can be
// unit tested without a database, so anything worth asserting has been pushed
// into a pure function that is. If a branch below starts making a decision,
// that decision belongs in close.ts or invoice.ts instead.

import type { SupabaseClient } from "@supabase/supabase-js";

import { assembleInvoice } from "./invoice";
import type { AssembledLine } from "./invoice";
import {
  collectPeriodVehicles,
  highWaterMark,
  selectCloseAction,
} from "./close";
import type { PeriodLicence, PeriodStatus } from "./close";
import { nextPeriodBounds } from "./period";
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
