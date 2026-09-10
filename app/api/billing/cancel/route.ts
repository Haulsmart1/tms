// End a company's subscription.
//
// Cancellation is the customer leaving. It is NOT suspension, which is us
// cutting off a non-payer and freezing everything in place, and it does NOT
// follow rule 4's no-refund-on-removal: that rule exists to make add-and-remove
// churn pointless, and a company leaving outright is not gaming anything.
//
// Two outcomes, decided by lib/billing/cancellation.ts:
//
//   inside 48 hours of first vehicle activation, once per company
//       the GBP 129 minimum is refunded in full and no invoice is raised
//   otherwise
//       the period is cut short at the end of today, invoiced for the days
//       used, and the balance taken while the card is still live
//
// Confirmation is required in the body rather than inferred from the method.
// This ends a paying relationship and, outside the cooling-off window, charges
// the card on the way out; a mis-wired fetch should not be able to do that.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import { requireCompanyAdmin } from "../../../../lib/billing/server";
import { cancelCompany } from "../../../../lib/billing/periodServer";
import { createSquarePeriodPaymentProvider } from "../../../../lib/billing/periodPaymentServer";
import { londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  confirm: z.literal("CANCEL"),
});

const BLOCKED_MESSAGE: Record<string, string> = {
  already_canceled: "This subscription has already been cancelled.",
  payment_settling:
    "A payment on your account is still settling, so it cannot be cancelled yet. Try again shortly, and contact support if this persists.",
};

export async function POST(request: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body." },
        { status: 400 }
      );
    }

    if (!BodySchema.safeParse(rawBody).success) {
      return NextResponse.json(
        { error: 'Send {"confirm":"CANCEL"} to cancel the subscription.' },
        { status: 400 }
      );
    }

    const { admin, companyId } = await requireCompanyAdmin();
    const now = new Date();

    const outcome = await cancelCompany(
      admin,
      createSquarePeriodPaymentProvider(admin),
      companyId,
      { nowISO: now.toISOString(), todayISO: londonDateISO(now) }
    );

    if (outcome.model === "v1_immediate") {
      // v1 cancellation is not implemented here and must not be faked. Doing
      // nothing while answering ok would leave a company believing they had
      // cancelled while the 4-weekly cron kept charging them.
      return NextResponse.json(
        {
          error:
            "This account is not on period billing. Contact support to cancel.",
        },
        { status: 409 }
      );
    }

    if (outcome.result === "blocked") {
      return NextResponse.json(
        {
          error:
            BLOCKED_MESSAGE[outcome.reason] ??
            "This subscription cannot be cancelled right now.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    const mapped = errorResponse(error);
    if (mapped.status === 500) {
      console.error(
        "Subscription cancellation failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
      return NextResponse.json(
        {
          error:
            "Something went wrong and the subscription was not cancelled. Contact support before trying again.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
