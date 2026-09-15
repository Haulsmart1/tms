// Supabase calls for period billing. Every decision is delegated to the pure
// modules (period, close, invoice, activation, cancellation, periodPayment);
// this file only loads rows, writes rows, and sequences the payment call.
//
// Deliberately thin. vitest covers lib/**/*.test.ts but nothing here can be
// unit tested without a database, so anything worth asserting has been pushed
// into a pure function that is. If a branch below starts making a decision,
// that decision belongs in close.ts, invoice.ts or activation.ts instead.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assembleInvoice,
  effectiveMinimumPence,
  estimateVehicleAddition,
} from "./invoice";
import type { AssembledInvoice, AssembledLine } from "./invoice";
import {
  collectPeriodVehicles,
  highWaterMark,
  selectCloseAction,
  selectSuccessorAction,
} from "./close";
import type { PeriodLicence, PeriodStatus } from "./close";
import { nextPeriodBounds } from "./period";
import { openPeriodNeedsMinimum, selectActivationAction } from "./activation";
import type { ActivationAction } from "./activation";
import { selectCancellationAction } from "./cancellation";
import { balanceDue } from "./periodPayment";
import { refundPeriodMinimum } from "./periodPaymentServer";
import type { PeriodPaymentProvider } from "./periodPayment";
import { daysBetween, londonDateISO, nextRetryOn } from "./schedule";
import { NEW_COMPANY_BILLING_MODEL, PERIOD_MINIMUM_PENCE } from "./rateCard";
import { VAT_RATE_PERCENT, vatOnNetPence } from "./vat";

// Mirrors lib/billing/server.ts. PostgREST caps an unscoped select at 1000
// rows by default, and a truncated result here would silently under-bill, so
// every query below refuses rather than proceeds.
const POSTGREST_ROW_CAP = 1000;

const CLOSE_REASON_SCHEDULED = "scheduled";
const CLOSE_REASON_MINIMUM_DECLINED = "minimum_declined";

// How long a collection claim may sit before another run may take it over.
// Safe to take over: the charge path replays a pending row under its original
// idempotency key rather than minting a new one.
const STALE_COLLECTION_MINUTES = 15;

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

const PERIOD_SELECT =
  "id, company_id, period_start, period_end, status, closing_since, prepaid_pence, net_pence, vat_pence, gross_pence, attempt_count, retry_on, closed_reason";

const SETTINGS_SELECT =
  "company_id, billing_model, status, currency, unit_amount_pence, min_invoice_pence, included_vehicles, grace_days, min_bill_days";

function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** The ids a company's vehicles and licences carry in tenant_id. */
async function companyScopeIds(
  admin: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const tenantsRes = await admin
    .from("tenants")
    .select("id")
    .eq("company_id", companyId);
  if (tenantsRes.error) throw new Error(tenantsRes.error.message);
  return [...(tenantsRes.data ?? []).map((t) => t.id as string), companyId];
}

/**
 * Every vehicle belonging to a company.
 *
 * `vehicles` is keyed by tenant_id only, there is NO company_id column, and
 * filtering on one answers PostgREST 42703 and fails the whole run. companyId
 * is in the list because some rows carry a company id in tenant_id directly,
 * and because it keeps `in.(...)` non-empty for a company with no tenants.
 */
async function fetchCompanyVehicleIds(
  admin: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const idList = await companyScopeIds(admin, companyId);

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
 * Every licence for a company, converted to London calendar days.
 *
 * Found TWO ways and merged: through the company's live vehicles, and through
 * the licence's own tenant_id. Review SQL-5: the close used to find licences
 * only through live vehicle ids, so deleting a vehicle row the day before close
 * dropped its licences from the invoice. prodfix_31 now refuses that delete;
 * this is the second layer, so a licence whose vehicle has somehow gone is
 * still billed.
 *
 * NOT filtered by period in SQL, deliberately. activated_at is timestamptz and
 * a period boundary is a London date; converting first and letting
 * collectPeriodVehicles apply the overlap rule keeps one definition of "which
 * day is this".
 */
async function fetchCompanyLicences(
  admin: SupabaseClient,
  companyId: string
): Promise<PeriodLicence[]> {
  const scope = await companyScopeIds(admin, companyId);
  const vehicleIds = await fetchCompanyVehicleIds(admin, companyId);

  const select =
    "id, vehicle_id, tenant_id, vrn_normalised, activated_at, deactivated_at, grace_until";

  const byTenant = await admin
    .from("vehicle_licences")
    .select(select)
    .in("tenant_id", scope);
  if (byTenant.error) throw new Error(byTenant.error.message);

  const byVehicle =
    vehicleIds.length > 0
      ? await admin
          .from("vehicle_licences")
          .select(select)
          .in("vehicle_id", vehicleIds)
      : { data: [], error: null };
  if (byVehicle.error) throw new Error(byVehicle.error.message);

  const rows = new Map<string, Record<string, unknown>>();
  for (const row of [...(byTenant.data ?? []), ...(byVehicle.data ?? [])]) {
    rows.set(row.id as string, row as Record<string, unknown>);
  }

  if (
    (byTenant.data ?? []).length >= POSTGREST_ROW_CAP ||
    (byVehicle.data ?? []).length >= POSTGREST_ROW_CAP
  ) {
    throw new Error(
      `Billing refused: licence query hit the ${POSTGREST_ROW_CAP}-row cap; the invoice would be incomplete`
    );
  }

  return [...rows.values()].map((row) => ({
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
 * Returns the existing open period untouched if there is one, and says whether
 * THIS call created the row, which is what lets a failed first charge clean up
 * only a period it made itself (review BILL2-8).
 *
 * The one-open-period-per-company unique index in billing_06 is the real
 * guarantee against two concurrent openers. prodfix_33's guard trigger refuses
 * an opening for a company that is not active or has an unpaid period.
 */
export async function ensureOpenPeriod(
  admin: SupabaseClient,
  companyId: string,
  startISO: string,
  prepaidPence: number
): Promise<{ period: PeriodRow; created: boolean }> {
  const existing = await admin
    .from("billing_periods")
    .select(PERIOD_SELECT)
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    return { period: existing.data as unknown as PeriodRow, created: false };
  }

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
    if (inserted.error.code === "23505") {
      // Either the one-open index (a concurrent caller won: read theirs), or
      // the start-date rule (a non-billing period already starts that day and
      // prodfix_33 STEP 5 is not applied). Only the first has an open row.
      const raced = await admin
        .from("billing_periods")
        .select(PERIOD_SELECT)
        .eq("company_id", companyId)
        .eq("status", "open")
        .maybeSingle();
      if (raced.error) throw new Error(raced.error.message);
      if (raced.data) {
        return { period: raced.data as unknown as PeriodRow, created: false };
      }
      throw new Error(
        `PERIOD_START_TAKEN: a billing period starting ${bounds.periodStartISO} already exists for company ${companyId}; apply docs/sql/prodfix_33_billing_integrity.sql STEP 5 (review BILL2-17)`
      );
    }
    throw new Error(inserted.error.message);
  }

  return { period: inserted.data as unknown as PeriodRow, created: true };
}

export type CloseOutcome = {
  periodId: string;
  companyId: string;
  result:
    | "invoiced"
    | "declined"
    | "suspended"
    | "successor_opened"
    | "skipped_not_due"
    | "skipped_already_invoiced"
    | "skipped_in_progress"
    | "skipped_awaiting_retry"
    | "skipped_dunning_exhausted"
    | "skipped_not_v2"
    | "skipped_claim_lost"
    | "skipped_minimum_pending"
    | "skipped_time_budget"
    | "error";
  netPence?: number;
  grossPence?: number;
  attempt?: number;
  error?: string;
};

/**
 * Close and collect every period whose end has arrived, then open any
 * successor that is missing.
 *
 * COMPUTING AND COLLECTING ARE SEPARATE STEPS. Writing the lines is idempotent
 * and cheap to redo; charging a card is neither. So the invoice is computed,
 * made durable, and only then collected, under a claim, and a period that has
 * been computed but not paid stays in the due query until it is.
 *
 * `deadlineMs` (epoch ms) stops starting new periods once passed, so a slow
 * Square cannot push the run past the function's hard limit (BILL1-7). Whatever
 * is left is picked up by tomorrow's run unchanged.
 */
export async function closeDuePeriods(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  opts: {
    todayISO: string;
    nowISO: string;
    staleClosingMinutes?: number;
    deadlineMs?: number;
  }
): Promise<CloseOutcome[]> {
  const staleClosingMinutes = opts.staleClosingMinutes ?? 15;
  const pastDeadline = () =>
    opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs;

  const dueRes = await admin
    .from("billing_periods")
    .select(PERIOD_SELECT)
    .lte("period_end", opts.todayISO)
    .in("status", ["open", "closing", "closed", "failed"])
    .order("period_end", { ascending: true });

  // 42P01 (no such table) and 42703 (no such column) both mean billing_06 has
  // not been applied. There is no v2 company in that world. Narrow on purpose.
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

  const outcomes: CloseOutcome[] = [];

  const settingsByCompany = new Map<string, CompanyBillingSettings>();
  if (due.length > 0) {
    const settingsRes = await admin
      .from("company_billing")
      .select(SETTINGS_SELECT)
      .in("company_id", [...new Set(due.map((p) => p.company_id))]);
    if (settingsRes.error) throw new Error(settingsRes.error.message);
    for (const row of settingsRes.data ?? []) {
      settingsByCompany.set(
        row.company_id as string,
        row as unknown as CompanyBillingSettings
      );
    }
  }

  const SKIP_RESULT = {
    not_due: "skipped_not_due",
    already_invoiced: "skipped_already_invoiced",
    in_progress: "skipped_in_progress",
    awaiting_retry: "skipped_awaiting_retry",
    dunning_exhausted: "skipped_dunning_exhausted",
  } as const;

  for (const period of due) {
    if (pastDeadline()) {
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "skipped_time_budget",
      });
      continue;
    }

    const settings = settingsByCompany.get(period.company_id);

    // No settings row cannot be a v2 company: the flag lives on it.
    if (!settings || settings.billing_model !== "v2_period") {
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "skipped_not_v2",
      });
      continue;
    }

    // BILL2-1. A cancelled company must never have an open period; one that
    // does is a fault to look at, not a period to bill and roll over. Closed
    // and failed periods are still collected: that is debt from before the
    // cancellation.
    if (settings.status === "canceled" && period.status === "open") {
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "error",
        error:
          "open period on a cancelled company; not invoiced, needs manual review",
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
      // BILL2-4. A minimum whose outcome was never recorded would be netted
      // off as zero and the customer billed the full period on top of a
      // payment they may have made. Replay it first; if it still cannot be
      // resolved, do not invoice this period today.
      const minimumResolved = await reconcilePendingMinimum(
        admin,
        provider,
        period,
        settings
      );
      if (!minimumResolved) {
        outcomes.push({
          periodId: period.id,
          companyId: period.company_id,
          result: "skipped_minimum_pending",
          error: "the up-front minimum still has an unknown outcome",
        });
        continue;
      }

      let current = period;

      if (action.kind === "compute") {
        const refreshed = await admin
          .from("billing_periods")
          .select(PERIOD_SELECT)
          .eq("id", period.id)
          .single();
        if (refreshed.error) throw new Error(refreshed.error.message);

        const computed = await computePeriodInvoice(admin, {
          period: refreshed.data as unknown as PeriodRow,
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
          attempt: (current.attempt_count ?? 0) + 1,
          nowISO: opts.nowISO,
          todayISO: opts.todayISO,
        })
      );
    } catch (error) {
      // One company's failure must not stop the run. Only `invoiced` leaves the
      // due query, so a period computed but not collected is picked up next run.
      outcomes.push({
        periodId: period.id,
        companyId: period.company_id,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!pastDeadline()) {
    outcomes.push(...(await openMissingSuccessors(admin, opts.todayISO, pastDeadline)));
  }

  return outcomes;
}

/**
 * The daily sweep that makes rollover re-runnable. Review BILL2-7.
 *
 * Finds active v2 companies with no open period and asks selectSuccessorAction
 * whether their last settled period should have been followed by another.
 */
async function openMissingSuccessors(
  admin: SupabaseClient,
  todayISO: string,
  pastDeadline: () => boolean
): Promise<CloseOutcome[]> {
  const outcomes: CloseOutcome[] = [];

  const companiesRes = await admin
    .from("company_billing")
    .select("company_id, billing_model, status")
    .eq("billing_model", "v2_period")
    .eq("status", "active")
    .order("company_id", { ascending: true });
  if (companiesRes.error) {
    if (companiesRes.error.code === "42703") return outcomes;
    throw new Error(companiesRes.error.message);
  }
  const companies = companiesRes.data ?? [];
  if (companies.length >= POSTGREST_ROW_CAP) {
    return [
      {
        periodId: "",
        companyId: "",
        result: "error",
        error: `successor sweep refused: ${POSTGREST_ROW_CAP}-row cap on v2 companies`,
      },
    ];
  }

  for (const company of companies) {
    if (pastDeadline()) break;
    const companyId = company.company_id as string;
    try {
      const decision = await successorDecisionFor(admin, companyId, todayISO);
      if (decision.kind === "open") {
        const opened = await ensureOpenPeriod(admin, companyId, decision.startISO, 0);
        if (opened.created) {
          outcomes.push({
            periodId: opened.period.id,
            companyId,
            result: "successor_opened",
          });
        }
      } else if (decision.kind === "stale") {
        outcomes.push({
          periodId: "",
          companyId,
          result: "error",
          error: `active licences but no open period for ${decision.lagDays} days; needs an activation or manual review`,
        });
      }
    } catch (error) {
      outcomes.push({
        periodId: "",
        companyId,
        result: "error",
        error:
          "successor sweep: " +
          (error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return outcomes;
}

async function successorDecisionFor(
  admin: SupabaseClient,
  companyId: string,
  todayISO: string
) {
  const billingRes = await admin
    .from("company_billing")
    .select("billing_model, status")
    .eq("company_id", companyId)
    .maybeSingle();
  if (billingRes.error) throw new Error(billingRes.error.message);

  // The newest period that actually billed. A declined-minimum record billed
  // nothing and says nothing about rollover, so it is skipped here in code
  // (a PostgREST .neq would also drop the legacy null closed_reason rows).
  const recentRes = await admin
    .from("billing_periods")
    .select("status, closed_reason, period_end, period_start")
    .eq("company_id", companyId)
    .order("period_start", { ascending: false })
    .limit(10);
  if (recentRes.error) throw new Error(recentRes.error.message);

  const latest =
    (recentRes.data ?? []).find(
      (p) => p.closed_reason !== CLOSE_REASON_MINIMUM_DECLINED
    ) ?? null;

  const openRes = await admin
    .from("billing_periods")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (openRes.error) throw new Error(openRes.error.message);

  const licences = latest ? await fetchCompanyLicences(admin, companyId) : [];

  return selectSuccessorAction({
    billingModel: (billingRes.data?.billing_model as string) ?? "v1_immediate",
    companyStatus: (billingRes.data?.status as string) ?? "missing",
    hasOpenPeriod: Boolean(openRes.data),
    latestPeriod: latest
      ? {
          status: latest.status as PeriodStatus,
          closedReason: (latest.closed_reason as string | null) ?? null,
          periodEndISO: latest.period_end as string,
        }
      : null,
    hasActiveLicence: licences.some((l) => l.deactivatedOnISO === null),
    todayISO,
    lagDays: latest ? daysBetween(latest.period_end as string, todayISO) : 0,
  });
}

/**
 * Replay a pending up-front minimum on this period, if there is one.
 *
 * Returns true when there is nothing unresolved left: no pending row, or the
 * replay settled it. False when the outcome is still unknown.
 */
async function reconcilePendingMinimum(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  period: PeriodRow,
  settings: CompanyBillingSettings
): Promise<boolean> {
  const pendingRes = await admin
    .from("period_charges")
    .select("net_pence, vat_pence, gross_pence")
    .eq("billing_period_id", period.id)
    .eq("kind", "minimum")
    .eq("status", "pending")
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingRes.error) throw new Error(pendingRes.error.message);
  if (!pendingRes.data) return true;

  const netPence = Number(pendingRes.data.net_pence);
  try {
    const result = await provider.charge({
      companyId: period.company_id,
      periodId: period.id,
      kind: "minimum",
      attempt: 1,
      netPence,
      vatPence: Number(pendingRes.data.vat_pence),
      grossPence: Number(pendingRes.data.gross_pence),
      currency: settings.currency,
      periodStartISO: period.period_start,
      periodEndISO: period.period_end,
    });
    if (result.status === "succeeded") {
      await recordPrepaid(admin, period.id, netPence);
    }
    return true;
  } catch (error) {
    console.error(
      "[billing] pending minimum could not be reconciled",
      period.id,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

type PeriodInvoiceLoad = {
  invoice: AssembledInvoice;
  /** The rows the invoice was built from, for highWaterMark. */
  licences: PeriodLicence[];
};

/**
 * Assemble a period's invoice and hand back the licence rows it was built
 * from, in ONE read, so a licence activated mid-close cannot land in the
 * invoice and not the high-water mark or the other way round.
 */
async function loadPeriodInvoice(
  admin: SupabaseClient,
  args: {
    companyId: string;
    periodStartISO: string;
    periodEndISO: string;
    settings: CompanyBillingSettings;
    closedReason: string | null;
  }
): Promise<PeriodInvoiceLoad> {
  const licences = await fetchCompanyLicences(admin, args.companyId);

  const vehicles = collectPeriodVehicles({
    periodStartISO: args.periodStartISO,
    periodEndISO: args.periodEndISO,
    licences,
  });

  const invoice = assembleInvoice({
    periodStartISO: args.periodStartISO,
    periodEndISO: args.periodEndISO,
    vehicles,
    minBillDays: args.settings.min_bill_days,
    unitAmountPence: args.settings.unit_amount_pence,
    // BILL2-9: prorated for a period cut short by cancellation.
    minimumPence: effectiveMinimumPence({
      minimumPence: args.settings.min_invoice_pence,
      periodStartISO: args.periodStartISO,
      periodEndISO: args.periodEndISO,
      closedReason: args.closedReason,
    }),
    includedVehicles: args.settings.included_vehicles,
    vatRatePercent: VAT_RATE_PERCENT,
  });

  return { invoice, licences };
}

/**
 * What a period would invoice, without writing anything.
 *
 * The billing page and the close job share ONE implementation, so the page
 * cannot display a figure the close job never produces.
 */
export async function previewPeriodInvoice(
  admin: SupabaseClient,
  args: {
    companyId: string;
    periodStartISO: string;
    /** Exclusive, matching billing_periods.period_end. */
    periodEndISO: string;
    settings: CompanyBillingSettings;
    closedReason?: string | null;
  }
): Promise<AssembledInvoice> {
  const { invoice } = await loadPeriodInvoice(admin, {
    ...args,
    closedReason: args.closedReason ?? null,
  });
  return invoice;
}

/**
 * Claim the period, build its invoice, and make it durable.
 *
 * Returns null when the claim was lost to a concurrent run.
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
      .from("period_invoice_lines")
      .delete()
      .eq("billing_period_id", period.id);
    if (cleared.error) throw new Error(cleared.error.message);
  }

  const { invoice, licences } = await loadPeriodInvoice(admin, {
    companyId: period.company_id,
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
    settings,
    closedReason: period.closed_reason,
  });

  if (invoice.lines.length > 0) {
    const rows = invoice.lines.map((line: AssembledLine) => ({
      company_id: period.company_id,
      billing_period_id: period.id,
      kind: line.kind,
      vehicle_id: line.vehicleId,
      // No foreign key on this column: legacy rows carry a COMPANY id here.
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

    const insertLines = await admin.from("period_invoice_lines").insert(rows);
    if (insertLines.error) throw new Error(insertLines.error.message);
  }

  // `closed` means the invoice exists and has NOT been paid.
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
      vat_rate: VAT_RATE_PERCENT,
    })
    .eq("id", period.id)
    .select(PERIOD_SELECT)
    .single();
  if (closed.error) throw new Error(closed.error.message);

  return closed.data as unknown as PeriodRow;
}

/**
 * Claim a closed or failed period for collection. Review BILL2-2.
 *
 * True when this caller may charge it. Without prodfix_33 the claim function
 * does not exist and collection proceeds unclaimed; chargePeriod's
 * "already succeeded" check still refuses a second charge in that world.
 */
async function claimCollection(
  admin: SupabaseClient,
  period: PeriodRow
): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_billing_period_collection", {
    p_period_id: period.id,
    p_expected_attempt_count: period.attempt_count ?? 0,
    p_stale_minutes: STALE_COLLECTION_MINUTES,
  });
  if (error) {
    if (isMissingFunction(error) || error.code === "42703") {
      console.warn(
        "[billing] claim_billing_period_collection is not installed; collecting unclaimed. Apply docs/sql/prodfix_33_billing_integrity.sql."
      );
      return true;
    }
    throw new Error(error.message);
  }
  return data === true;
}

/**
 * Charge what is outstanding on an already-computed period.
 *
 * Under a claim, so two collectors can never both charge it. The successor
 * opens only after a successful collection and only when selectSuccessorAction
 * agrees: never for a cancelled company or out of a cancellation period.
 */
async function collectPeriod(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  args: {
    period: PeriodRow;
    settings: CompanyBillingSettings;
    attempt: number;
    nowISO: string;
    todayISO: string;
    /** False skips the successor, for cancellation and card recovery. */
    openSuccessor?: boolean;
  }
): Promise<CloseOutcome> {
  const { period, settings } = args;

  if (!(await claimCollection(admin, period))) {
    return {
      periodId: period.id,
      companyId: period.company_id,
      result: "skipped_claim_lost",
    };
  }

  const invoiceNet = period.net_pence ?? 0;
  const balance = balanceDue(invoiceNet, period.prepaid_pence, VAT_RATE_PERCENT);

  let payment;
  try {
    payment = await provider.charge({
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
  } catch (error) {
    // The claim is left to go stale rather than released: the outcome is
    // unknown, and a pending row (if any) is replayed by whoever claims next.
    throw error;
  }

  if (payment.status === "failed") {
    const retryOn = nextRetryOn(period.period_end, args.attempt);

    const marked = await admin
      .from("billing_periods")
      .update({
        status: "failed",
        attempt_count: args.attempt,
        retry_on: retryOn,
        collecting_since: null,
      })
      .eq("id", period.id);
    if (marked.error) throw new Error(marked.error.message);

    if (retryOn === null) {
      // BILL2-1 secondary: a cancelled company stays cancelled. Dunning
      // exhaustion must not relabel a customer who left as a suspended one.
      const suspended = await admin
        .from("company_billing")
        .update({ status: "past_due" })
        .eq("company_id", period.company_id)
        .neq("status", "canceled");
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

  const settled = await admin
    .from("billing_periods")
    .update({
      status: "invoiced",
      attempt_count: args.attempt,
      retry_on: null,
      collecting_since: null,
      provider_invoice_id:
        payment.status === "succeeded" ? payment.providerPaymentId : null,
    })
    .eq("id", period.id);
  if (settled.error) throw new Error(settled.error.message);

  // A failure here must not discard a payment that has already succeeded, so
  // it is reported rather than thrown, and the daily sweep repairs it.
  let successorError: string | undefined;
  if (args.openSuccessor !== false) {
    try {
      const decision = await successorDecisionFor(
        admin,
        period.company_id,
        args.todayISO
      );
      if (decision.kind === "open") {
        await ensureOpenPeriod(admin, period.company_id, decision.startISO, 0);
      }
    } catch (error) {
      successorError =
        "payment settled but the next period could not be opened (the daily sweep retries): " +
        (error instanceof Error ? error.message : String(error));
    }
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

/**
 * Collect every closed or failed period for a company NOW, ignoring the
 * dunning ladder. Used when a company saves a new card. Review BILL2-5: a v2
 * company that reached past_due could never recover, because nothing retried
 * an exhausted period and the card route did nothing for v2.
 *
 * On success of every outstanding period a past_due company is set back to
 * active. It never reactivates a cancelled company.
 */
export async function collectOutstandingPeriods(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  companyId: string,
  opts: { nowISO: string; todayISO: string }
): Promise<{ attempted: number; collected: number; outcomes: CloseOutcome[] }> {
  const settingsRes = await admin
    .from("company_billing")
    .select(SETTINGS_SELECT)
    .eq("company_id", companyId)
    .maybeSingle();
  if (settingsRes.error) throw new Error(settingsRes.error.message);
  const settings = settingsRes.data as unknown as CompanyBillingSettings | null;
  if (!settings || settings.billing_model !== "v2_period") {
    return { attempted: 0, collected: 0, outcomes: [] };
  }

  const periodsRes = await admin
    .from("billing_periods")
    .select(PERIOD_SELECT)
    .eq("company_id", companyId)
    .in("status", ["closed", "failed"])
    .order("period_start", { ascending: true });
  if (periodsRes.error) throw new Error(periodsRes.error.message);
  const periods = (periodsRes.data ?? []) as unknown as PeriodRow[];

  const outcomes: CloseOutcome[] = [];
  let collected = 0;
  for (const period of periods) {
    try {
      const outcome = await collectPeriod(admin, provider, {
        period,
        settings,
        attempt: (period.attempt_count ?? 0) + 1,
        nowISO: opts.nowISO,
        todayISO: opts.todayISO,
        openSuccessor: false,
      });
      outcomes.push(outcome);
      if (outcome.result === "invoiced") collected += 1;
    } catch (error) {
      outcomes.push({
        periodId: period.id,
        companyId,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (periods.length > 0 && collected === periods.length) {
    const reactivated = await admin
      .from("company_billing")
      .update({ status: "active" })
      .eq("company_id", companyId)
      .eq("status", "past_due");
    if (reactivated.error) throw new Error(reactivated.error.message);
  }

  return { attempted: periods.length, collected, outcomes };
}

// PostgREST answers 42703 ("column does not exist") when billing_06 has not
// been applied yet: no v2 company can exist, so `legacy` is the only correct
// answer. Narrow on purpose.
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
 * caller fall straight through to the v1 path.
 */
export async function resolveActivation(
  admin: SupabaseClient,
  companyId: string,
  todayISO: string
): Promise<ResolvedActivation> {
  const settingsRes = await admin
    .from("company_billing")
    .select(SETTINGS_SELECT + ", square_card_id, square_customer_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (settingsRes.error) {
    if (isMissingColumn(settingsRes.error)) {
      return { action: { kind: "legacy" }, settings: null };
    }
    throw new Error(settingsRes.error.message);
  }

  const settings = settingsRes.data as unknown as
    | (CompanyBillingSettings & {
        square_card_id: string | null;
        square_customer_id: string | null;
      })
    | null;

  if (!settings) {
    return {
      action: selectActivationAction({
        billingRow: null,
        openPeriod: null,
        openPeriodMinimumPending: false,
        todayISO,
        minimumPence: PERIOD_MINIMUM_PENCE,
        newCompanyBillingModel: NEW_COMPANY_BILLING_MODEL,
      }),
      settings: null,
    };
  }

  if (settings.billing_model !== "v2_period") {
    return { action: { kind: "legacy" }, settings: null };
  }

  const periodsRes = await admin
    .from("billing_periods")
    .select("id, period_start, period_end, status, prepaid_pence, created_at")
    .eq("company_id", companyId)
    .in("status", ["open", "closing", "closed", "failed"]);
  if (periodsRes.error) throw new Error(periodsRes.error.message);
  const periods = periodsRes.data ?? [];

  const open = periods.find((p) => p.status === "open") ?? null;
  const hasUncollectedPeriod = periods.some((p) => p.status === "failed");
  const hasPeriodBeingClosed = periods.some(
    (p) => p.status === "closing" || p.status === "closed"
  );

  let openPeriodMinimumPending = false;
  let openNeedsMinimum = false;
  if (open) {
    const chargesRes = await admin
      .from("period_charges")
      .select("status")
      .eq("billing_period_id", open.id)
      .eq("kind", "minimum");
    if (chargesRes.error) throw new Error(chargesRes.error.message);
    const statuses = (chargesRes.data ?? []).map((c) => c.status as string);
    openPeriodMinimumPending = statuses.includes("pending");

    const previousRes = await admin
      .from("billing_periods")
      .select("id")
      .eq("company_id", companyId)
      .eq("period_end", open.period_start as string)
      .neq("id", open.id)
      .limit(1);
    if (previousRes.error) throw new Error(previousRes.error.message);

    openNeedsMinimum = openPeriodNeedsMinimum({
      prepaidPence: Number(open.prepaid_pence ?? 0),
      minimumChargeStatuses: statuses,
      periodStartISO: open.period_start as string,
      createdOnISO: londonDateISO(new Date(open.created_at as string)),
      followsPreviousPeriod: (previousRes.data ?? []).length > 0,
    });
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
      openPeriod: open
        ? {
            id: open.id as string,
            periodStartISO: open.period_start as string,
            periodEndISO: open.period_end as string,
          }
        : null,
      openPeriodMinimumPending,
      openPeriodNeedsMinimum: openNeedsMinimum,
      hasUncollectedPeriod,
      hasPeriodBeingClosed,
      todayISO,
      minimumPence: settings.min_invoice_pence,
      newCompanyBillingModel: NEW_COMPANY_BILLING_MODEL,
    }),
    settings,
  };
}

export type OpenPeriodChargeResult =
  | {
      ok: true;
      periodId: string;
      charged: boolean;
      netPence: number;
      /** What left the card in this call, from the charge itself. 0 if none. */
      grossPence: number;
    }
  | { ok: false; failureCode: string };

/**
 * Open the company's period (or reuse the open one) and take the minimum.
 *
 * ORDER: take the money FIRST, write the licence LAST. The caller writes the
 * licence only on `ok`.
 *
 * Handles every state selectActivationAction routes here:
 *   no open period       open one, charge the minimum
 *   pending minimum      replay it under its stored key and body (BILL2-4)
 *   orphaned period      charge the minimum it never took (BILL2-8)
 *   succeeded, unrecorded repair prepaid_pence without charging
 *
 * A throw after this call created the period removes the period again if no
 * charge row was written, so a transient error cannot leave an open period
 * that later activations join free (BILL2-8). A decline on a period this call
 * created keeps the period as `minimum_declined` with its failed charge row,
 * instead of deleting the audit trail (BILL2-18).
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
): Promise<OpenPeriodChargeResult> {
  const { period, created } = await ensureOpenPeriod(
    admin,
    args.companyId,
    args.periodStartISO,
    0
  );

  try {
    const existing = await admin
      .from("period_charges")
      .select("id, status, net_pence, vat_pence, gross_pence")
      .eq("billing_period_id", period.id)
      .eq("kind", "minimum")
      .in("status", ["pending", "succeeded"])
      .order("attempt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    if (existing.data?.status === "succeeded") {
      // The race was lost, or a previous attempt charged the card and then
      // failed to record prepaid_pence. Repair it without charging again.
      const net = Number(existing.data.net_pence);
      if (period.prepaid_pence !== net) {
        await recordPrepaid(admin, period.id, net);
      }
      return {
        ok: true,
        periodId: period.id,
        charged: false,
        netPence: net,
        grossPence: 0,
      };
    }

    // A pending row is replayed with its OWN amounts; a new attempt uses the
    // company's minimum.
    const netPence = existing.data
      ? Number(existing.data.net_pence)
      : args.minimumPence;
    const vatPence = existing.data
      ? Number(existing.data.vat_pence)
      : vatOnNetPence(args.minimumPence);
    const grossPence = existing.data
      ? Number(existing.data.gross_pence)
      : args.minimumPence + vatPence;

    const payment = await provider.charge({
      companyId: args.companyId,
      periodId: period.id,
      kind: "minimum",
      attempt: 1,
      netPence,
      vatPence,
      grossPence,
      currency: args.settings.currency,
      periodStartISO: period.period_start,
      periodEndISO: period.period_end,
    });

    if (payment.status === "failed") {
      if (created) await abandonPeriod(admin, period.id);
      return { ok: false, failureCode: payment.failureCode };
    }

    // `skipped` means no provider is configured, or the minimum is zero.
    // prepaid_pence must never claim money that did not move.
    const charged = payment.status === "succeeded";
    await recordPrepaid(admin, period.id, charged ? netPence : 0);

    return {
      ok: true,
      periodId: period.id,
      charged,
      netPence,
      grossPence: charged ? grossPence : 0,
    };
  } catch (error) {
    if (created) await removeIfUncharged(admin, period.id);
    throw error;
  }
}

/** A period this request created, whose minimum was declined. */
async function abandonPeriod(admin: SupabaseClient, periodId: string) {
  const marked = await admin
    .from("billing_periods")
    .update({
      status: "invoiced",
      closed_reason: CLOSE_REASON_MINIMUM_DECLINED,
      closed_at: new Date().toISOString(),
      prepaid_pence: 0,
      net_pence: 0,
      vat_pence: 0,
      gross_pence: 0,
    })
    .eq("id", periodId);
  if (!marked.error) return;

  // prodfix_33 STEP 4 not applied: closed_reason cannot say minimum_declined.
  // Fall back to the old delete, which (without prodfix_31) also removes the
  // failed charge row.
  if (marked.error.code !== "23514") throw new Error(marked.error.message);
  const removed = await admin.from("billing_periods").delete().eq("id", periodId);
  if (removed.error) {
    throw new Error(
      `The minimum was declined but period ${periodId} could not be closed or removed (${removed.error.message}); apply docs/sql/prodfix_33_billing_integrity.sql`
    );
  }
}

/** Remove a period this request created, but only if nothing was charged. */
async function removeIfUncharged(admin: SupabaseClient, periodId: string) {
  try {
    const charges = await admin
      .from("period_charges")
      .select("id", { count: "exact", head: true })
      .eq("billing_period_id", periodId);
    if (charges.error || (charges.count ?? 0) > 0) return;
    await admin.from("billing_periods").delete().eq("id", periodId);
  } catch (error) {
    console.error(
      "[billing] could not remove an uncharged period after a failure",
      periodId,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Record what a period actually collected up front. Checked: a silent failure
 * after a successful charge would bill the full period on top of it.
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
 * within the company. grace_days is 0 for every company at launch.
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
  /** Not a v2 company; the caller quotes the v1 path. */
  | { model: "v1_immediate" }
  /** Activation would be refused, so there is nothing to quote. */
  | { model: "v2_period"; kind: "blocked"; reason: string }
  /** This vehicle would open a period (or take its missing minimum). */
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
 * Read-only. Derived from resolveActivation (review BILL2-22), so it can never
 * quote a charge the activation would refuse, and a company with no billing
 * row is quoted the way the activation treats it rather than as v1.
 */
export async function quoteVehicleAddition(
  admin: SupabaseClient,
  companyId: string,
  vehicleId: string,
  todayISO: string
): Promise<AdditionQuote> {
  const { action, settings } = await resolveActivation(admin, companyId, todayISO);

  if (action.kind === "legacy") return { model: "v1_immediate" };
  if (action.kind === "blocked") {
    return { model: "v2_period", kind: "blocked", reason: action.reason };
  }

  if (action.kind === "open_period_and_charge") {
    const vatPence = vatOnNetPence(action.amountPence);
    return {
      model: "v2_period",
      kind: "opens_period",
      netPence: action.amountPence,
      vatPence,
      grossPence: action.amountPence + vatPence,
      periodStartISO: action.periodStartISO,
      periodEndISO: action.periodEndISO,
    };
  }

  const periodRes = await admin
    .from("billing_periods")
    .select("period_start, period_end")
    .eq("id", action.periodId)
    .single();
  if (periodRes.error) throw new Error(periodRes.error.message);
  const periodStartISO = periodRes.data.period_start as string;
  const periodEndISO = periodRes.data.period_end as string;

  const licences = await fetchCompanyLicences(admin, companyId);
  const existing = collectPeriodVehicles({
    periodStartISO,
    periodEndISO,
    licences,
  }).filter((v) => v.vehicleId !== vehicleId);

  const s = settings as CompanyBillingSettings;
  const estimate = estimateVehicleAddition({
    periodStartISO,
    periodEndISO,
    existingVehicles: existing,
    newVehicle: {
      vehicleId,
      tenantId: "",
      vrnNormalised: vehicleId,
      coverageStartISO: todayISO,
    },
    minBillDays: s.min_bill_days,
    unitAmountPence: s.unit_amount_pence,
    minimumPence: s.min_invoice_pence,
    includedVehicles: s.included_vehicles,
    vatRatePercent: VAT_RATE_PERCENT,
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

export type CancellationOutcome =
  | { model: "v1_immediate" }
  | { model: "v2_period"; result: "blocked"; reason: string }
  | {
      model: "v2_period";
      result: "cancelled";
      /** Refunded in full under the 48-hour cooling-off window. */
      refundedPence?: number;
      /** False while Square still reports the refund as in progress. */
      refundSettled?: boolean;
      /** Charged for the days used, when the period was cut short. */
      finalNetPence?: number;
      finalGrossPence?: number;
      note?: string;
    };

const CLOSE_REASON_CANCELLATION = "cancellation";
const CLOSE_REASON_COOLING_OFF = "cooling_off";

/**
 * End a company's subscription on v2.
 *
 * Cancellation is the customer leaving, and it is NOT suspension. It settles up
 * and stops, and it never opens a successor period (BILL2-1).
 */
export async function cancelCompany(
  admin: SupabaseClient,
  provider: PeriodPaymentProvider,
  companyId: string,
  opts: { nowISO: string; todayISO: string }
): Promise<CancellationOutcome> {
  const billingRes = await admin
    .from("company_billing")
    .select(SETTINGS_SELECT + ", cooling_off_refunded_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (billingRes.error) {
    if (isMissingColumn(billingRes.error)) return { model: "v1_immediate" };
    throw new Error(billingRes.error.message);
  }

  const settings = billingRes.data as unknown as
    | (CompanyBillingSettings & { cooling_off_refunded_at: string | null })
    | null;
  if (!settings || settings.billing_model !== "v2_period") {
    return { model: "v1_immediate" };
  }

  const openRes = await admin
    .from("billing_periods")
    .select(PERIOD_SELECT + ", created_at")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (openRes.error) throw new Error(openRes.error.message);

  let openRow = openRes.data as unknown as (PeriodRow & { created_at: string }) | null;

  let minimumChargePending = false;
  let isFirstPeriod = false;
  if (openRow) {
    // Try to settle an unknown minimum before deciding anything (BILL2-4).
    await reconcilePendingMinimum(admin, provider, openRow, settings);
    const reread = await admin
      .from("billing_periods")
      .select(PERIOD_SELECT + ", created_at")
      .eq("id", openRow.id)
      .single();
    if (reread.error) throw new Error(reread.error.message);
    openRow = reread.data as unknown as PeriodRow & { created_at: string };

    const pendingRes = await admin
      .from("period_charges")
      .select("id")
      .eq("billing_period_id", openRow.id)
      .eq("kind", "minimum")
      .eq("status", "pending")
      .limit(1);
    if (pendingRes.error) throw new Error(pendingRes.error.message);
    minimumChargePending = (pendingRes.data ?? []).length > 0;

    const earlierRes = await admin
      .from("billing_periods")
      .select("id")
      .eq("company_id", companyId)
      .lt("period_start", openRow.period_start)
      .limit(1);
    if (earlierRes.error) throw new Error(earlierRes.error.message);
    isFirstPeriod = (earlierRes.data ?? []).length === 0;
  }

  const coolingOffUsedByCard = await cardHadCoolingOff(admin, companyId);

  const action = selectCancellationAction({
    billingRow: {
      billingModel: "v2_period",
      status: settings.status as "active" | "past_due" | "canceled",
      coolingOffRefundedAt: settings.cooling_off_refunded_at,
      coolingOffUsedByCard,
    },
    openPeriod: openRow
      ? {
          id: openRow.id,
          periodStartISO: openRow.period_start,
          periodEndISO: openRow.period_end,
          openedAtISO: openRow.created_at,
          prepaidPence: openRow.prepaid_pence,
          minimumChargePending,
          isFirstPeriod,
        }
      : null,
    nowISO: opts.nowISO,
    todayISO: opts.todayISO,
  });

  if (action.kind === "legacy") return { model: "v1_immediate" };
  if (action.kind === "blocked") {
    return { model: "v2_period", result: "blocked", reason: action.reason };
  }

  if (action.kind === "cancel_only") {
    await markCancelled(admin, companyId, null);
    return { model: "v2_period", result: "cancelled" };
  }

  if (action.kind === "void_future_period") {
    // BILL2-13. The period has not begun and nothing was billed in it. Closed
    // with a zero invoice rather than deleted, so the record of the seam stays.
    const voided = await admin
      .from("billing_periods")
      .update({
        status: "invoiced",
        closed_at: opts.nowISO,
        closed_reason: CLOSE_REASON_CANCELLATION,
        net_pence: 0,
        vat_pence: 0,
        gross_pence: 0,
      })
      .eq("id", action.periodId)
      .eq("status", "open");
    if (voided.error) throw new Error(voided.error.message);
    await markCancelled(admin, companyId, null);
    return {
      model: "v2_period",
      result: "cancelled",
      note: "your period billing had not started yet, so nothing further is charged",
    };
  }

  if (action.kind === "cooling_off") {
    // Refund BEFORE anything is marked, so a refund that does not go through
    // leaves the company cancellable again rather than cancelled with their
    // money still taken.
    const refund = await refundPeriodMinimum(admin, action.periodId);

    if (refund.status === "nothing_to_refund") {
      // BILL2-16. prepaid_pence says money was taken, and there is nothing to
      // refund it against. Refusing is the only honest answer: cancelling here
      // would use up the refund and give nothing back.
      throw new Error(
        `REFUND_UNAVAILABLE: period ${action.periodId} records ${openRow?.prepaid_pence ?? 0} pence prepaid but no refundable payment (${refund.reason}); reconcile by hand`
      );
    }

    const closed = await admin
      .from("billing_periods")
      .update({
        status: "invoiced",
        closed_at: opts.nowISO,
        closed_reason: CLOSE_REASON_COOLING_OFF,
        prepaid_pence: 0,
        net_pence: 0,
        vat_pence: 0,
        gross_pence: 0,
      })
      .eq("id", action.periodId);
    if (closed.error) throw new Error(closed.error.message);

    await markCancelled(admin, companyId, opts.nowISO);

    return {
      model: "v2_period",
      result: "cancelled",
      refundedPence: refund.refundedPence,
      refundSettled: refund.settled,
    };
  }

  // close_early: cut the period short, invoice what was used, take the
  // balance while the card is still live.
  const shortened = await admin
    .from("billing_periods")
    .update({
      period_end: action.periodEndISO,
      closed_reason: CLOSE_REASON_CANCELLATION,
    })
    .eq("id", action.periodId)
    .eq("status", "open")
    .select(PERIOD_SELECT)
    .maybeSingle();
  if (shortened.error) throw new Error(shortened.error.message);
  if (!shortened.data) {
    // The close job claimed it first. It will invoice the full period; the
    // subscription still ends here, and no successor opens for a cancelled
    // company.
    await markCancelled(admin, companyId, null);
    return {
      model: "v2_period",
      result: "cancelled",
      note: "the period was already being closed by the billing run",
    };
  }

  const period = shortened.data as unknown as PeriodRow;

  const computed = await computePeriodInvoice(admin, {
    period,
    settings,
    regenerateLines: true,
    nowISO: opts.nowISO,
  });

  if (computed === null) {
    await markCancelled(admin, companyId, null);
    return {
      model: "v2_period",
      result: "cancelled",
      note: "the period was already being closed by the billing run",
    };
  }

  // Marked cancelled BEFORE collecting, so nothing that reads the company's
  // status while the charge runs can roll it over.
  await markCancelled(admin, companyId, null);

  let collected: CloseOutcome;
  try {
    collected = await collectPeriod(admin, provider, {
      period: computed,
      settings,
      attempt: (computed.attempt_count ?? 0) + 1,
      nowISO: opts.nowISO,
      todayISO: opts.todayISO,
      openSuccessor: false,
    });
  } catch (error) {
    return {
      model: "v2_period",
      result: "cancelled",
      finalNetPence: computed.net_pence ?? undefined,
      note: `the final charge has not settled yet and will be retried (${
        error instanceof Error ? error.message.slice(0, 80) : "unknown"
      })`,
    };
  }

  return {
    model: "v2_period",
    result: "cancelled",
    finalNetPence: collected.netPence,
    finalGrossPence: collected.grossPence,
    note:
      collected.result === "invoiced"
        ? undefined
        : `the final charge did not settle (${collected.error ?? collected.result})`,
  };
}

/**
 * Has the card on this company already had a cooling-off refund on any
 * company? Review BILL2-10. False when the fingerprint column (prodfix_33) or
 * the fingerprint itself is missing, which falls back to once per company.
 */
async function cardHadCoolingOff(
  admin: SupabaseClient,
  companyId: string
): Promise<boolean> {
  const own = await admin
    .from("company_billing")
    .select("card_fingerprint")
    .eq("company_id", companyId)
    .maybeSingle();
  if (own.error) {
    if (isMissingColumn(own.error)) return false;
    throw new Error(own.error.message);
  }
  const fingerprint = own.data?.card_fingerprint as string | null | undefined;
  if (!fingerprint) return false;

  const others = await admin
    .from("company_billing")
    .select("company_id")
    .eq("card_fingerprint", fingerprint)
    .neq("company_id", companyId)
    .not("cooling_off_refunded_at", "is", null)
    .limit(1);
  if (others.error) throw new Error(others.error.message);
  return (others.data ?? []).length > 0;
}

async function markCancelled(
  admin: SupabaseClient,
  companyId: string,
  coolingOffRefundedAtISO: string | null
): Promise<void> {
  const fields: Record<string, unknown> = { status: "canceled" };
  if (coolingOffRefundedAtISO !== null) {
    fields.cooling_off_refunded_at = coolingOffRefundedAtISO;
  }
  const { error } = await admin
    .from("company_billing")
    .update(fields)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

/**
 * Is this company on period billing?
 *
 * A narrow question: a delete must not be refused because the company is
 * past_due, so it needs the model and nothing else. Tolerates 42703.
 */
export async function isPeriodBillingCompany(
  admin: SupabaseClient,
  companyId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("company_billing")
    .select("billing_model")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return false;
    throw new Error(error.message);
  }
  return data?.billing_model === "v2_period";
}
