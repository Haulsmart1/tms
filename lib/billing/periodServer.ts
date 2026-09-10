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
import { roundHalfUpDiv } from "./pence";
import type { PeriodPaymentProvider } from "./periodPayment";
import { londonDateISO, nextRetryOn } from "./schedule";

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
  net_pence: number | null;
  vat_pence: number | null;
  gross_pence: number | null;
  attempt_count: number;
  retry_on: string | null;
  closed_reason: string | null;
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
    .select(PERIOD_SELECT)
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as unknown as PeriodRow;

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
    .select(PERIOD_SELECT)
    .single();

  if (inserted.error) {
    // 23505 is the one-open-period index firing, which means a concurrent
    // caller won. Read theirs rather than failing: both callers wanted "there
    // is an open period", and there is.
    if (inserted.error.code === "23505") {
      const raced = await admin
        .from("billing_periods")
        .select(PERIOD_SELECT)
        .eq("company_id", companyId)
        .eq("status", "open")
        .single();
      if (raced.error) throw new Error(raced.error.message);
      return raced.data as unknown as PeriodRow;
    }
    throw new Error(inserted.error.message);
  }

  return inserted.data as unknown as PeriodRow;
}

export type CloseOutcome = {
  periodId: string;
  companyId: string;
  result:
    | "invoiced"
    | "declined"
    | "suspended"
    | "skipped_not_due"
    | "skipped_already_invoiced"
    | "skipped_in_progress"
    | "skipped_awaiting_retry"
    | "skipped_dunning_exhausted"
    | "skipped_not_v2"
    | "skipped_claim_lost"
    | "error";
  netPence?: number;
  grossPence?: number;
  attempt?: number;
  error?: string;
};

const PERIOD_SELECT =
  "id, company_id, period_start, period_end, status, closing_since, prepaid_pence, net_pence, vat_pence, gross_pence, attempt_count, retry_on, closed_reason";

/**
 * Close and collect every period whose end has arrived.
 *
 * COMPUTING AND COLLECTING ARE SEPARATE STEPS, and that separation is the
 * correction. Writing the lines is idempotent and cheap to redo; charging a
 * card is neither. So the invoice is computed, made durable, and only then
 * collected, and a period that has been computed but not paid stays in the due
 * query until it is. Marking a period finished before the charge meant any
 * exit other than a clean decline lost the invoice permanently: an
 * indeterminate answer from Square, a missing env var, a failed status write.
 */
export async function closeDuePeriods(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  opts: { todayISO: string; nowISO: string; staleClosingMinutes?: number }
): Promise<CloseOutcome[]> {
  const staleClosingMinutes = opts.staleClosingMinutes ?? 15;

  const dueRes = await admin
    .from("billing_periods")
    .select(PERIOD_SELECT)
    .lte("period_end", opts.todayISO)
    .in("status", ["open", "closing", "closed", "failed"])
    .order("period_end", { ascending: true });

  // 42P01 (no such table) and 42703 (no such column) both mean billing_06 has
  // not been applied. There is no v2 company in that world, so there is
  // nothing to close, and reporting it as a run failure would make the nightly
  // cron cry wolf every night between the deploy and the migration while all
  // v1 charging succeeded. Narrow on purpose: any other error is real.
  if (dueRes.error) {
    if (dueRes.error.code === "42P01" || dueRes.error.code === "42703") {
      return [];
    }
    throw new Error(dueRes.error.message);
  }

  const due = (dueRes.data ?? []) as unknown as PeriodRow[];
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

  const SKIP_RESULT = {
    not_due: "skipped_not_due",
    already_invoiced: "skipped_already_invoiced",
    in_progress: "skipped_in_progress",
    awaiting_retry: "skipped_awaiting_retry",
    dunning_exhausted: "skipped_dunning_exhausted",
  } as const;

  const outcomes: CloseOutcome[] = [];

  for (const period of due) {
    const settings = settingsByCompany.get(period.company_id);

    // No settings row cannot be a v2 company: the flag lives on it. Skipping
    // rather than defaulting is the fail-closed direction.
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
      attemptCount: period.attempt_count ?? 0,
      retryOnISO: period.retry_on,
    });

    if (action.kind === "skip") {
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: SKIP_RESULT[action.reason],
      });
      continue;
    }

    try {
      let current = period;

      if (action.kind === "compute") {
        const computed = await computePeriodInvoice(admin, {
          period,
          settings,
          regenerateLines: action.regenerateLines,
          nowISO: opts.nowISO,
        });
        if (computed === null) {
          outcomes.push({
            periodId: period.id,
            companyId: period.company_id,
            result: "skipped_claim_lost",
          });
          continue;
        }
        current = computed;
      }

      outcomes.push(
        await collectPeriod(admin, provider, {
          period: current,
          settings,
          attempt: action.kind === "collect" ? action.attempt : 1,
          nowISO: opts.nowISO,
        })
      );
    } catch (error) {
      // One company's failure must not stop the run. The period keeps whatever
      // state it reached, and because only `invoiced` leaves the due query, a
      // period computed but not collected is picked up next run rather than
      // lost.
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}

/**
 * Claim the period, build its invoice, and make it durable.
 *
 * Returns null when the claim was lost to a concurrent run. The claim is a
 * compare-and-set on the status that was read, so it updates one row or none,
 * and a run that updated none must stand down.
 */
async function computePeriodInvoice(
  admin: SupabaseClient,
  args: {
    period: PeriodRow;
    settings: CompanyBillingSettings;
    regenerateLines: boolean;
    nowISO: string;
  }
): Promise<PeriodRow | null> {
  const { period, settings } = args;

  const claim = await admin
    .from("billing_periods")
    .update({ status: "closing", closing_since: args.nowISO })
    .eq("id", period.id)
    .eq("status", period.status)
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) return null;

  // Regenerating means REPLACING, never appending.
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
      // No foreign key on this column: legacy rows carry a COMPANY id here,
      // and an FK to tenants(id) rejected them with 23503 forever. Null rather
      // than the empty string a missing value used to become, which would be a
      // 22P02 invalid-uuid insert.
      tenant_id: line.tenantId === "" ? null : line.tenantId,
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

  // `closed` means the invoice exists and has NOT been paid. It stays in the
  // due query until it is.
  const closed = await admin
    .from("billing_periods")
    .update({
      status: "closed",
      closed_at: args.nowISO,
      closed_reason: period.closed_reason ?? CLOSE_REASON_SCHEDULED,
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
    .select(PERIOD_SELECT)
    .single();
  if (closed.error) throw new Error(closed.error.message);

  return closed.data as unknown as PeriodRow;
}

/**
 * Charge what is outstanding on an already-computed period.
 *
 * The successor opens only AFTER a successful collection, and only while the
 * company still runs something. Opening it before the charge meant a transient
 * error there discarded the invoice; opening it regardless of outcome let a
 * non-payer's debt compound period after period, which is the exposure cap
 * this model was described as having and did not.
 */
async function collectPeriod(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  args: {
    period: PeriodRow;
    settings: CompanyBillingSettings;
    attempt: number;
    nowISO: string;
  }
): Promise<CloseOutcome> {
  const { period, settings } = args;
  const vatRate = settings.vat_rate ?? 20;
  const invoiceNet = period.net_pence ?? 0;
  const balance = balanceDue(invoiceNet, period.prepaid_pence, vatRate);

  const payment = await provider.charge({
    companyId: period.company_id,
    periodId: period.id,
    kind: "balance",
    attempt: args.attempt,
    netPence: balance.netPence,
    vatPence: balance.vatPence,
    grossPence: balance.grossPence,
    currency: settings.currency,
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
  });

  if (payment.status === "failed") {
    // The dunning ladder, shared with v1: attempts on days 1, 3, 5 and 7 from
    // the close date. Null means exhausted, so the company goes past_due,
    // which is what selectActivationAction's gate reads and what stops it
    // adding vehicles. No successor period opens either, so the debt stops
    // compounding at one period.
    const retryOn = nextRetryOn(period.period_end, args.attempt);

    const marked = await admin
      .from("billing_periods")
      .update({
        status: "failed",
        attempt_count: args.attempt,
        retry_on: retryOn,
      })
      .eq("id", period.id);
    if (marked.error) throw new Error(marked.error.message);

    if (retryOn === null) {
      const suspended = await admin
        .from("company_billing")
        .update({ status: "past_due" })
        .eq("company_id", period.company_id);
      if (suspended.error) throw new Error(suspended.error.message);
    }

    return {
      periodId: period.id,
      companyId: period.company_id,
      result: retryOn === null ? "suspended" : "declined",
      error: payment.failureCode,
      attempt: args.attempt,
      netPence: invoiceNet,
      grossPence: balance.grossPence,
    };
  }

  // `skipped` means nothing was owed, or no provider is configured. Both leave
  // the period settled: there is no outstanding amount either way.
  const settled = await admin
    .from("billing_periods")
    .update({
      status: "invoiced",
      attempt_count: args.attempt,
      retry_on: null,
      provider_invoice_id:
        payment.status === "succeeded" ? payment.providerPaymentId : null,
    })
    .eq("id", period.id);
  if (settled.error) throw new Error(settled.error.message);

  // A failure here must not discard a payment that has already succeeded, so
  // it is reported rather than thrown. The next activation self-heals it.
  let successorError: string | undefined;
  try {
    const vehicleIds = await fetchCompanyVehicleIds(admin, period.company_id);
    const licences = await fetchCompanyLicences(admin, vehicleIds);
    if (licences.some((l) => l.deactivatedOnISO === null)) {
      await ensureOpenPeriod(admin, period.company_id, period.period_end, 0);
    }
  } catch (error) {
    successorError =
      "payment settled but the next period could not be opened: " +
      (error instanceof Error ? error.message : String(error));
  }

  return {
    periodId: period.id,
    companyId: period.company_id,
    result: "invoiced",
    attempt: args.attempt,
    netPence: invoiceNet,
    grossPence: balance.grossPence,
    error: successorError,
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
 * ORDER: take the money FIRST, write the licence LAST, so a decline leaves no
 * billable vehicle behind. The caller writes the licence only on `ok`.
 *
 * THE RACE THIS GUARDS. `ensureOpenPeriod` returns an EXISTING open period
 * rather than opening one, by design. Two activations that both saw no open
 * period (a double click across two tabs is enough; the page's writeInFlight
 * guard is per tab) would otherwise both arrive here, the second would find
 * the first's period, mint a fresh attempt because the first had already
 * settled, and charge the card a second GBP 129. Worse, prepaid_pence would
 * then record one payment, so only one would ever be netted off at close.
 *
 * So the charge is conditional on there being no minimum charge for this
 * period already. A succeeded one means the race was lost and the money is
 * collected; a pending one means the outcome is unknown, and the caller must
 * block rather than guess.
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
): Promise<
  | { ok: true; periodId: string; charged: boolean }
  | { ok: false; failureCode: string }
> {
  const vatRate = args.settings.vat_rate ?? 20;
  const period = await ensureOpenPeriod(
    admin,
    args.companyId,
    args.periodStartISO,
    0
  );

  const existing = await admin
    .from("period_charges")
    .select("id, status, net_pence")
    .eq("billing_period_id", period.id)
    .eq("kind", "minimum")
    .in("status", ["pending", "succeeded"])
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  if (existing.data?.status === "pending") {
    // A Square call was made whose outcome was never recorded. The card may
    // well have been charged, so charging again is not available and neither
    // is proceeding.
    return { ok: false, failureCode: "PAYMENT_SETTLING" };
  }

  if (existing.data?.status === "succeeded") {
    // The race was lost, or a previous attempt charged the card and then
    // failed to record prepaid_pence. Repair it either way: leaving it at 0
    // would net nothing off at close and bill the customer for the whole
    // period on top of a minimum they have already paid.
    await recordPrepaid(admin, period.id, existing.data.net_pence as number);
    return { ok: true, periodId: period.id, charged: false };
  }

  const vatPence = roundHalfUpDiv(args.minimumPence * vatRate, 100);

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
    // The period is removed, not left behind. Leaving it would let the next
    // attempt take the join branch, add the vehicle free, and bill the whole
    // period at close on top of a minimum that was never paid.
    const removed = await admin
      .from("billing_periods")
      .delete()
      .eq("id", period.id);
    if (removed.error) throw new Error(removed.error.message);
    return { ok: false, failureCode: payment.failureCode };
  }

  // `skipped` means no provider is configured, or the minimum is zero.
  // prepaid_pence must never claim money that did not move, or the close job
  // would net it off a real invoice.
  await recordPrepaid(
    admin,
    period.id,
    payment.status === "succeeded" ? args.minimumPence : 0
  );

  return {
    ok: true,
    periodId: period.id,
    charged: payment.status === "succeeded",
  };
}

/**
 * Record what a period actually collected up front.
 *
 * Checked, unlike the fire-and-forget write this replaces. If it silently
 * failed after a successful charge, the card had been debited GBP 129 while
 * the period recorded nothing prepaid, so balanceDue would net nothing off and
 * the customer would be billed the full period on top of it. Throwing surfaces
 * it, and the succeeded-charge branch above repairs it on the next attempt.
 */
async function recordPrepaid(
  admin: SupabaseClient,
  periodId: string,
  netPence: number
): Promise<void> {
  const { error } = await admin
    .from("billing_periods")
    .update({ prepaid_pence: netPence })
    .eq("id", periodId);
  if (error) {
    throw new Error(
      `The minimum was collected for period ${periodId} but prepaid_pence could not be recorded: ${error.message}`
    );
  }
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
