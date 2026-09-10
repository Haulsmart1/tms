import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/accounts/server";
import { runChargeCycle } from "../../../../lib/billing/server";
import { applyChargeOutcome, selectDueAction } from "../../../../lib/billing/run";
import type { CompanyBillingRow } from "../../../../lib/billing/run";
import { londonDateISO } from "../../../../lib/billing/schedule";
import { closeDuePeriods } from "../../../../lib/billing/periodServer";
import { createSquarePeriodPaymentProvider } from "../../../../lib/billing/periodPaymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Charging many companies serially can exceed the default limit.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // This endpoint charges cards. No secret configured means no access at all.
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = londonDateISO(new Date());

  const { data: rows, error } = await admin
    .from("company_billing")
    .select("*")
    .neq("status", "canceled")
    .order("next_charge_on", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // PostgREST caps unscoped selects at 1000 rows by default. Hitting this cap
  // means some due companies are silently missing from this run; refuse
  // rather than under-charge. Same discipline as fetchBillableVehicles.
  if ((rows ?? []).length >= 1000) {
    return NextResponse.json(
      {
        error:
          "Billing refused: company_billing query hit the 1000-row cap; results may be truncated.",
      },
      { status: 500 }
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let conflicts = 0;
  let v2Companies = 0;

  for (const raw of rows ?? []) {
    // A company on v2 is billed by the period close below, NOT here. Without
    // this the two models both charge it: selectDueAction reads next_charge_on,
    // which the switch-over deliberately leaves in place, so a migrated company
    // would be charged a full v1 cycle on the very day its first v2 period
    // begins. Filtered in the loop rather than in the query because the
    // 1000-row cap check above must see every row, migrated or not.
    if (raw.billing_model === "v2_period") {
      // Counted separately. Folding these into `skipped` made that number
      // unusable for reconciliation: it conflated "no v1 charge was due" with
      // "this company is not on v1 at all".
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
      });

      // Compare-and-swap on the dunning state: if a concurrent card update
      // already moved this row (the /api/billing/card route retries
      // immediately on card replacement), skip rather than clobber its
      // outcome with ours.
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

  // v2 (period billing) runs AFTER the v1 cycle charges, in its own try. The
  // two are independent: a company is on exactly one model, so neither can
  // charge the other's customers, and a failure in one must not stop the
  // other's run. Sequencing v2 second means a v1 outage cannot delay it past
  // the day's window.
  //
  // Every v2 period is closed by this same daily cron rather than by pg_cron
  // or an Edge Function, because neither exists in this project and the
  // Vercel cron in vercel.json is already authenticated, already has
  // maxDuration raised, and is already the thing an operator looks at when
  // billing has not run.
  let periodOutcomes: Awaited<ReturnType<typeof closeDuePeriods>> = [];
  let periodError: string | null = null;

  try {
    periodOutcomes = await closeDuePeriods(
      admin,
      createSquarePeriodPaymentProvider(admin),
      { todayISO: today, nowISO: new Date().toISOString() }
    );
  } catch (error) {
    // A throw here is a whole-run failure (a row cap hit, a query error), not
    // one company's. Reported rather than swallowed: the response is what the
    // cron's own alerting reads.
    periodError = error instanceof Error ? error.message : String(error);
    console.error("billing cron: period close run failed:", periodError);
  }

  const periodsInvoiced = periodOutcomes.filter(
    (o) => o.result === "invoiced"
  ).length;
  const periodsDeclined = periodOutcomes.filter(
    (o) => o.result === "declined" || o.result === "suspended"
  ).length;
  const periodsErrored = periodOutcomes.filter(
    (o) => o.result === "error"
  ).length;

  return NextResponse.json({
    ok: periodError === null,
    date: today,
    processed: (rows ?? []).length,
    charged: succeeded,
    failed,
    skipped,
    conflicts,
    results,
    v2Companies,
    periods: {
      invoiced: periodsInvoiced,
      declined: periodsDeclined,
      errored: periodsErrored,
      error: periodError,
      outcomes: periodOutcomes,
    },
  });
}
