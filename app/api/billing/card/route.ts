import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import { getSquare } from "../../../../lib/payments/square";
import {
  requireCompanyAdmin,
  runChargeCycle,
} from "../../../../lib/billing/server";
import { applyChargeOutcome } from "../../../../lib/billing/run";
import { computeNextChargeOn, londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cardToken: z.string().min(1),
  verificationToken: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
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
      // First-time setup: immediate first charge; write company_billing only
      // on success so a declined card leaves no half-configured subscription.
      const anchorDay = Number(today.slice(8, 10));
      const result = await runChargeCycle(admin, {
        companyId,
        cycleDate: today,
        attempt: 1,
        squareCustomerId: customerId,
        squareCardId: card.id,
      });

      if (!result.succeeded) {
        return NextResponse.json(
          {
            error: "Your card was declined. No subscription was set up.",
            failureCode: result.failureCode,
          },
          { status: 402 }
        );
      }

      const nextChargeOn = computeNextChargeOn(today, anchorDay);
      const { error: insertError } = await admin.from("company_billing").insert({
        company_id: companyId,
        ...cardFields,
        status: "active",
        anchor_day: anchorDay,
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
    const hasOutstandingCycle =
      existing.status === "past_due" || existing.retry_at !== null;

    if (!hasOutstandingCycle) {
      const { error: updateError } = await admin
        .from("company_billing")
        .update({ ...cardFields, updated_at: new Date().toISOString() })
        .eq("company_id", companyId);
      if (updateError) {
        throw new Error(updateError.message);
      }
      return NextResponse.json({ ok: true, firstCharge: false, retried: false });
    }

    const attempt = Number(existing.retry_count) + 1;
    const result = await runChargeCycle(admin, {
      companyId,
      cycleDate: existing.next_charge_on as string,
      attempt,
      squareCustomerId: customerId,
      squareCardId: card.id,
    });

    const outcome = applyChargeOutcome({
      row: {
        anchor_day: Number(existing.anchor_day),
        next_charge_on: existing.next_charge_on as string,
      },
      cycleDate: existing.next_charge_on as string,
      attempt,
      succeeded: result.succeeded,
    });

    const { error: updateError } = await admin
      .from("company_billing")
      .update({
        ...cardFields,
        ...outcome,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);
    if (updateError) {
      throw new Error(updateError.message);
    }

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
