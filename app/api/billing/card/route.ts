import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import { getSquare } from "../../../../lib/payments/square";
import {
  requireCompanyAdmin,
  runChargeCycle,
} from "../../../../lib/billing/server";
import { applyChargeOutcome, selectRecoveryAction } from "../../../../lib/billing/run";
import {
  addDays,
  computeNextChargeOn,
  londonDateISO,
} from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cardToken: z.string().min(1),
  verificationToken: z.string().min(1),
});

// Best effort: after a card replacement, disable the old card at Square so
// the customer does not accumulate live cards. Nothing charges the old card
// once company_billing points at the new one, so a failure here is harmless.
async function disableReplacedCard(
  square: ReturnType<typeof getSquare>,
  oldCardId: string | null | undefined,
  newCardId: string
) {
  if (oldCardId && oldCardId !== newCardId) {
    try {
      await square.cards.disable({ cardId: oldCardId });
    } catch {
      // Best effort only; see comment above.
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body." },
        { status: 400 }
      );
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "cardToken and verificationToken are required." },
        { status: 400 }
      );
    }

    const { admin, companyId } = await requireCompanyAdmin();
    const square = getSquare();

    const { data: existing, error: existingError } = await admin
      .from("company_billing")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    // Find or create the Square customer. Search by reference_id first so a
    // failed first charge (which stores no row) does not create duplicates.
    let customerId = existing?.square_customer_id as string | undefined;
    if (!customerId) {
      const search = await square.customers.search({
        query: { filter: { referenceId: { exact: companyId } } },
      });
      customerId = search.customers?.[0]?.id ?? undefined;
    }
    if (!customerId) {
      const { data: company } = await admin
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      const created = await square.customers.create({
        referenceId: companyId,
        companyName: (company?.name as string | undefined) ?? undefined,
      });
      customerId = created.customer?.id ?? undefined;
    }
    if (!customerId) {
      throw new Error("Square customer could not be created.");
    }

    const cardResponse = await square.cards.create({
      idempotencyKey: crypto.randomUUID(),
      sourceId: parsed.data.cardToken,
      verificationToken: parsed.data.verificationToken,
      card: { customerId },
    });

    const card = cardResponse.card;
    if (!card?.id) {
      throw new Error("Square card could not be stored.");
    }

    const cardFields = {
      square_customer_id: customerId,
      square_card_id: card.id,
      card_brand: card.cardBrand ?? null,
      card_last4: card.last4 ?? null,
      card_exp_month: card.expMonth != null ? Number(card.expMonth) : null,
      card_exp_year: card.expYear != null ? Number(card.expYear) : null,
    };

    const today = londonDateISO(new Date());

    if (!existing) {
      // Orphan recovery: a prior first-time setup may have charged Square
      // successfully and then crashed before the company_billing insert
      // below ran. Detect that state before charging again, which would
      // double-bill. Only look back 31 days: a stale succeeded charge from
      // further back is not this crash window and should not be trusted.
      const { data: orphanRows, error: orphanError } = await admin
        .from("platform_charges")
        .select("cycle_date, vehicle_count, gross_pence, receipt_url")
        .eq("company_id", companyId)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(1);
      if (orphanError) {
        throw new Error(orphanError.message);
      }
      const orphan = orphanRows?.[0];
      const recentOrphan =
        orphan && (orphan.cycle_date as string) >= addDays(today, -31)
          ? orphan
          : null;

      if (recentOrphan) {
        const cycleDate = recentOrphan.cycle_date as string;
        const nextChargeOn = computeNextChargeOn(cycleDate);
        const { error: insertError } = await admin.from("company_billing").insert({
          company_id: companyId,
          ...cardFields,
          status: "active",
          next_charge_on: nextChargeOn,
          retry_at: null,
          retry_count: 0,
        });
        if (insertError) {
          throw new Error(insertError.message);
        }

        return NextResponse.json({
          ok: true,
          firstCharge: true,
          recovered: true,
          vehicleCount: Number(recentOrphan.vehicle_count),
          grossPence: Number(recentOrphan.gross_pence),
          receiptUrl: recentOrphan.receipt_url ?? null,
          nextChargeOn,
        });
      }

      // First-time setup: immediate first charge; write company_billing only
      // on success so a declined card leaves no half-configured subscription.
      //
      // Attempt number is derived from the audit trail, not hardcoded to 1: a
      // declined first attempt today already used idempotency key
      // (company, today, 1), and the admin can retry same-day with a
      // different card. Reusing attempt 1 for that retry would send a NEW
      // request body under the SAME key, which Square rejects as
      // IDEMPOTENCY_KEY_REUSED. Any recorded attempt (succeeded or failed)
      // counts, since either way that key is already spent.
      const { data: attemptRows, error: attemptError } = await admin
        .from("platform_charges")
        .select("attempt")
        .eq("company_id", companyId)
        .eq("cycle_date", today)
        .order("attempt", { ascending: false })
        .limit(1);
      if (attemptError) {
        throw new Error(attemptError.message);
      }
      const firstTimeAttempt = Number(attemptRows?.[0]?.attempt ?? 0) + 1;

      let result;
      try {
        result = await runChargeCycle(admin, {
          companyId,
          cycleDate: today,
          attempt: firstTimeAttempt,
          squareCustomerId: customerId,
          squareCardId: card.id,
        });
      } catch (chargeError) {
        if (
          chargeError instanceof Error &&
          chargeError.message.startsWith("PAYMENT_INDETERMINATE")
        ) {
          return NextResponse.json(
            {
              error:
                "A previous payment attempt is still settling with Square. Please wait a few minutes and try again; if this persists, charges resume automatically tomorrow.",
            },
            { status: 409 }
          );
        }
        throw chargeError;
      }

      if (!result.succeeded) {
        return NextResponse.json(
          {
            error: "Your card was declined. No subscription was set up.",
            failureCode: result.failureCode,
          },
          { status: 402 }
        );
      }

      const nextChargeOn = computeNextChargeOn(today);
      const { error: insertError } = await admin.from("company_billing").insert({
        company_id: companyId,
        ...cardFields,
        status: "active",
        next_charge_on: nextChargeOn,
        retry_at: null,
        retry_count: 0,
      });
      if (insertError) {
        throw new Error(insertError.message);
      }

      return NextResponse.json({
        ok: true,
        firstCharge: true,
        vehicleCount: result.vehicleCount,
        grossPence: result.grossPence,
        receiptUrl: result.receiptUrl,
        nextChargeOn,
      });
    }

    // Replacement card: store the new card, then, if a cycle is outstanding
    // (mid-dunning or past_due), retry it immediately.
    const action = selectRecoveryAction({
      status: existing.status,
      next_charge_on: existing.next_charge_on as string,
      retry_at: existing.retry_at ?? null,
      retry_count: Number(existing.retry_count),
    });

    if (action.kind === "none") {
      const { error: updateError } = await admin
        .from("company_billing")
        .update({ ...cardFields, updated_at: new Date().toISOString() })
        .eq("company_id", companyId);
      if (updateError) {
        throw new Error(updateError.message);
      }
      await disableReplacedCard(
        square,
        existing.square_card_id as string | null | undefined,
        card.id
      );
      return NextResponse.json({ ok: true, firstCharge: false, retried: false });
    }

    const { cycleDate, attempt } = action;
    let result;
    try {
      result = await runChargeCycle(admin, {
        companyId,
        cycleDate,
        attempt,
        squareCustomerId: customerId,
        squareCardId: card.id,
      });
    } catch (chargeError) {
      if (
        chargeError instanceof Error &&
        chargeError.message.startsWith("PAYMENT_INDETERMINATE")
      ) {
        return NextResponse.json(
          {
            error:
              "A previous payment attempt is still settling with Square. Please wait a few minutes and try again; if this persists, charges resume automatically tomorrow.",
          },
          { status: 409 }
        );
      }
      throw chargeError;
    }

    const outcome = applyChargeOutcome({
      row: {
        next_charge_on: existing.next_charge_on as string,
      },
      cycleDate,
      attempt,
      succeeded: result.succeeded,
    });

    // Compare-and-swap: only apply the outcome if the dunning state has not
    // moved since we read `existing` (guards against a race with the cron,
    // which may have run the same cycle concurrently). The card fields are
    // always written on the fallback below regardless of the race, because
    // the new card replaces the old dead one either way.
    const { data: casRows, error: updateError } = await admin
      .from("company_billing")
      .update({
        ...cardFields,
        ...outcome,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("status", existing.status)
      .eq("retry_count", existing.retry_count)
      .select("company_id");
    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!casRows || casRows.length === 0) {
      const { error: fallbackError } = await admin
        .from("company_billing")
        .update({ ...cardFields, updated_at: new Date().toISOString() })
        .eq("company_id", companyId);
      if (fallbackError) {
        throw new Error(fallbackError.message);
      }
      await disableReplacedCard(
        square,
        existing.square_card_id as string | null | undefined,
        card.id
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            "Billing state changed while your card was being processed. The card was saved; charges will settle automatically.",
        },
        { status: 409 }
      );
    }

    await disableReplacedCard(
      square,
      existing.square_card_id as string | null | undefined,
      card.id
    );

    return NextResponse.json({
      ok: true,
      firstCharge: false,
      retried: true,
      succeeded: result.succeeded,
      failureCode: result.failureCode,
      receiptUrl: result.receiptUrl,
      status: outcome.status,
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
