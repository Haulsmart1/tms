// What the open period would invoice if it closed today.
//
// Read only, and deliberately a server route rather than browser arithmetic:
// it calls previewPeriodInvoice, which is the same function closeDuePeriods
// calls, on the same rows. The number on the billing page is therefore the
// number the close job will produce by construction, not by agreement. See
// docs/superpowers/specs/2026-09-11-v2-billing-ui-and-pricing-design.md.

import { NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/accounts/server";
import { requireCompanyAdmin } from "../../../../lib/billing/server";
import { previewPeriodInvoice } from "../../../../lib/billing/periodServer";
import type { CompanyBillingSettings } from "../../../../lib/billing/periodServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_SELECT =
  "company_id, billing_model, status, currency, unit_amount_pence, " +
  "min_invoice_pence, included_vehicles, grace_days, min_bill_days";

const PERIOD_SELECT =
  "id, period_start, period_end, status, prepaid_pence, attempt_count, retry_on";

/* 42P01 is "no such table", 42703 is "no such column". Either means billing_06
   has not been applied, in which case there is no v2 company in this world and
   nothing to preview. NARROW ON PURPOSE, mirroring closeDuePeriods: any other
   code is a real fault, and dressing it up as a reassuring message would hide
   the faults this page exists to surface. */
function isMissingSchema(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "42703";
}

export async function GET() {
  try {
    const { admin, companyId } = await requireCompanyAdmin();

    const settingsRes = await admin
      .from("company_billing")
      .select(SETTINGS_SELECT)
      .eq("company_id", companyId)
      .maybeSingle();

    if (settingsRes.error) {
      if (isMissingSchema(settingsRes.error)) {
        return NextResponse.json({ ok: true, unavailable: "migration" });
      }
      throw new Error(settingsRes.error.message);
    }

    const settings = settingsRes.data as CompanyBillingSettings | null;

    /* Refused rather than answered with v1 figures. A v1 company rendering a
       v2 projection would show a bill that will never be raised. */
    if (!settings || settings.billing_model !== "v2_period") {
      return NextResponse.json(
        { error: "This account is not on period billing." },
        { status: 409 }
      );
    }

    /* maybeSingle is safe: billing_06 carries a partial unique index allowing
       at most one open period per company. */
    const periodRes = await admin
      .from("billing_periods")
      .select(PERIOD_SELECT)
      .eq("company_id", companyId)
      .eq("status", "open")
      .maybeSingle();

    if (periodRes.error) {
      if (isMissingSchema(periodRes.error)) {
        return NextResponse.json({ ok: true, unavailable: "migration" });
      }
      throw new Error(periodRes.error.message);
    }

    const period = periodRes.data;

    /* A SUCCESS, not an error. A v2 company that has not yet activated a
       vehicle for billing has no open period, and that is a legitimate steady
       state. Answering 404 would put a red banner on a page where nothing is
       wrong and teach the reader to ignore the banner that matters. */
    if (!period) {
      return NextResponse.json({ ok: true, period: null });
    }

    const invoice = await previewPeriodInvoice(admin, {
      companyId,
      periodStartISO: period.period_start as string,
      periodEndISO: period.period_end as string,
      settings,
    });

    return NextResponse.json({
      ok: true,
      period,
      lines: invoice.lines,
      vehicleCount: invoice.vehicleCount,
      discountPercent: invoice.discountPercent,
      subtotalPence: invoice.subtotalPence,
      netPence: invoice.netPence,
      vatPence: invoice.vatPence,
      grossPence: invoice.grossPence,
      minimumPence: settings.min_invoice_pence,
    });
  } catch (error) {
    const mapped = errorResponse(error);
    if (mapped.status === 500) {
      /* errorResponse puts the raw message in the body on a 500, and the
         messages reaching here are PostgREST's, which name tables, columns and
         constraints. Logged for diagnosis and replaced before it is sent, the
         same way cancel/route.ts does: the person running this down has the
         server logs, and the person holding the browser should not be handed
         the schema. */
      console.error(
        "Period preview failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
      return NextResponse.json(
        {
          error:
            "Your billing figures could not be worked out just now. Nothing has been charged. Try again shortly, and contact support if this persists.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
