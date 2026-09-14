import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/accounts/server";
import { runChargeCycle } from "../../../../lib/billing/server";
import { applyChargeOutcome, selectDueAction } from "../../../../lib/billing/run";
import type { CompanyBillingRow } from "../../../../lib/billing/run";
import { londonDateISO } from "../../../../lib/billing/schedule";
import { closeDuePeriods } from "../../../../lib/billing/periodServer";
import { createSquarePeriodPaymentProvider } from "../../../../lib/billing/periodPaymentServer";
import {
  checkCronAuthorization,
  withinBudget,
} from "../../../../lib/billing/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Charging many companies serially can exceed the default limit.
export const maxDuration = 300;

// BILL1-7. Work stops STARTING at these points so the function finishes before
// Vercel kills it at maxDuration, which would leave a payment mid-flight and
// unrecorded. The v2 close runs FIRST with its own share, so a slow v1 run can
// no longer stop periods closing. A Square call is bounded at about 50 seconds
// (lib/payments/square.ts), hence the margin at the end.
const V2_BUDGET_MS = 110_000;
const TOTAL_BUDGET_MS = 230_000;

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  // BILL1-4 and BILL1-11. A deployment with no CRON_SECRET is an outage (no
  // renewals, no period closes, no dunning), and it used to look exactly like
  // an ordinary unauthorised request. The comparison is constant-time.
  const auth = checkCronAuthorization(
    process.env.CRON_SECRET,
    request.headers.get("authorization")
  );
  if (auth === "misconfigured") {
    console.error(
      "billing cron: CRON_SECRET is not configured; NO BILLING IS RUNNING. Set it in the Vercel project environment."
    );
    return NextResponse.json(
      { error: "Billing is not configured on this deployment." },
      { status: 500 }
    );
  }
  if (auth !== "ok") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = londonDateISO(new Date());

  // v2 FIRST. Independent of v1 (a company is on exactly one model), so
  // neither can charge the other's customers and a failure in one must not
  // stop the other.
  let periodOutcomes: Awaited<ReturnType<typeof closeDuePeriods>> = [];
  let periodError: string | null = null;

  try {
    periodOutcomes = await closeDuePeriods(
      admin,
      createSquarePeriodPaymentProvider(admin),
      {
        todayISO: today,
        nowISO: new Date().toISOString(),
        deadlineMs: startedAt + V2_BUDGET_MS,
      }
    );
  } catch (error) {
    periodError = error instanceof Error ? error.message : String(error);
    console.error("billing cron: period close run failed:", periodError);
  }

  // BILL1-11. Paged by company_id rather than refused at the 1000-row cap,
  // which used to stop ALL billing once the platform had 1000 billing rows.
  const rows: Array<Record<string, any>> = [];
  let v1Error: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await admin
      .from("company_billing")
      .select("*")
      .neq("status", "canceled")
      .order("company_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      v1Error = error.message;
      break;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) {
      v1Error = `company_billing has more than ${MAX_PAGES * PAGE_SIZE} rows; the rest were not processed`;
    }
  }
  if (v1Error) console.error("billing cron: company_billing read failed:", v1Error);

  const results: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let conflicts = 0;
  let deferred = 0;
  let v2Companies = 0;

  for (const raw of rows) {
    // A company on v2 is billed by the period close above, NOT here.
    if (raw.billing_model === "v2_period") {
      v2Companies += 1;
      continue;
    }

    const row: CompanyBillingRow = {
      company_id: raw.company_id,
      status: raw.status,
      next_charge_on: raw.next_charge_on,
      retry_at: raw.retry_at ?? null,
      retry_count: Number(raw.retry_count),
    };

    const action = selectDueAction(row, today);
    if (action.kind === "none") {
      skipped += 1;
      continue;
    }

    if (!withinBudget(startedAt, Date.now(), TOTAL_BUDGET_MS)) {
      // Left for tomorrow; nothing about the row changes.
      deferred += 1;
      continue;
    }

    // Per-company isolation: one company's failure never aborts the batch.
    try {
      const result = await runChargeCycle(admin, {
        companyId: row.company_id,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        squareCustomerId: raw.square_customer_id,
        squareCardId: raw.square_card_id,
      });

      const outcome = applyChargeOutcome({
        row,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        succeeded: result.succeeded,
        todayISO: today,
      });

      // Compare-and-swap on the dunning state: if a concurrent card update or
      // a cancellation already moved this row, skip rather than clobber it.
      const { data: updatedRows, error: updateError } = await admin
        .from("company_billing")
        .update({ ...outcome, updated_at: new Date().toISOString() })
        .eq("company_id", row.company_id)
        .eq("status", row.status)
        .eq("retry_count", row.retry_count)
        .select("company_id");
      if (updateError) {
        throw new Error(updateError.message);
      }
      if (!updatedRows || updatedRows.length === 0) {
        conflicts += 1;
        results.push({
          companyId: row.company_id,
          cycleDate: action.cycleDate,
          attempt: action.attempt,
          succeeded: result.succeeded,
          grossPence: result.grossPence,
          skippedReason: "concurrent billing update, outcome not applied",
        });
        continue;
      }

      if (result.succeeded) {
        succeeded += 1;
      } else {
        failed += 1;
      }
      results.push({
        companyId: row.company_id,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        vehicleCount: result.vehicleCount,
        grossPence: result.grossPence,
        succeeded: result.succeeded,
        failureCode: result.failureCode,
        newStatus: outcome.status,
      });
    } catch (cycleError) {
      failed += 1;
      const message =
        cycleError instanceof Error ? cycleError.message : "Unknown error.";
      console.error(`billing cron: company ${row.company_id} failed:`, message);
      results.push({
        companyId: row.company_id,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        error: message,
      });
    }
  }

  const periodsInvoiced = periodOutcomes.filter((o) => o.result === "invoiced").length;
  const periodsDeclined = periodOutcomes.filter(
    (o) => o.result === "declined" || o.result === "suspended"
  ).length;
  const periodsErrored = periodOutcomes.filter((o) => o.result === "error").length;
  const periodsDeferred = periodOutcomes.filter(
    (o) => o.result === "skipped_time_budget"
  ).length;

  if (periodsErrored > 0 || failed > 0) {
    console.error(
      `billing cron: ${periodsErrored} period errors, ${failed} v1 failures on ${today}; see the response body`
    );
  }

  const ok = periodError === null && v1Error === null;
  return NextResponse.json(
    {
      ok,
      date: today,
      processed: rows.length,
      charged: succeeded,
      failed,
      skipped,
      conflicts,
      deferred,
      v1Error,
      results,
      v2Companies,
      periods: {
        invoiced: periodsInvoiced,
        declined: periodsDeclined,
        errored: periodsErrored,
        deferred: periodsDeferred,
        error: periodError,
        outcomes: periodOutcomes,
      },
    },
    { status: ok ? 200 : 500 }
  );
}
