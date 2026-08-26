import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/accounts/server";
import { runChargeCycle } from "../../../../lib/billing/server";
import { applyChargeOutcome, selectDueAction } from "../../../../lib/billing/run";
import type { CompanyBillingRow } from "../../../../lib/billing/run";
import { londonDateISO } from "../../../../lib/billing/schedule";

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
    .neq("status", "canceled");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const raw of rows ?? []) {
    const row: CompanyBillingRow = {
      company_id: raw.company_id,
      status: raw.status,
      anchor_day: Number(raw.anchor_day),
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
        skipped += 1;
        results.push({
          companyId: row.company_id,
          cycleDate: action.cycleDate,
          attempt: action.attempt,
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
      results.push({ companyId: row.company_id, error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    processed: (rows ?? []).length,
    charged: succeeded,
    failed,
    skipped,
    results,
  });
}
