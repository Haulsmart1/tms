import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse } from "../../../../lib/accounts/server";
import { getSquare } from "../../../../lib/payments/square";
import {
  fetchBillableVehicles,
  requireCompanyAdmin,
  runChargeCycle,
} from "../../../../lib/billing/server";
import { applyChargeOutcome, selectRecoveryAction } from "../../../../lib/billing/run";
import { NEW_COMPANY_BILLING_MODEL } from "../../../../lib/billing/rateCard";
import {
  addDays,
  computeNextChargeOn,
  londonDateISO,
} from "../../../../lib/billing/schedule";
import {
  collectOutstandingPeriods,
  openPeriodAndChargeMinimum,
  resolveActivation,
} from "../../../../lib/billing/periodServer";
import { createSquarePeriodPaymentProvider } from "../../../../lib/billing/periodPaymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cardToken: z.string().min(1),
  verificationToken: z.string().min(1),
});

const SETTLING_MESSAGE =
  "A previous payment attempt is still settling with Square. Please wait a few minutes and try again; if this persists, charges resume automatically tomorrow.";

// Best effort: disable a card at Square that company_billing no longer points
// at, so the customer does not accumulate live cards. Nothing charges it.
async function disableCard(
  square: ReturnType<typeof getSquare>,
  cardId: string | null | undefined,
  keepCardId: string | null | undefined
) {
  if (cardId && cardId !== keepCardId) {
    try {
      await square.cards.disable({ cardId });
    } catch {
      // Best effort only; see comment above.
    }
  }
}

/**
 * Write company_billing, tolerating a database without the card_fingerprint
 * column (prodfix_33 not applied): retried without it on 42703.
 */
async function writeBilling(
  mode: "insert" | "update",
  admin: SupabaseClient,
  companyId: string,
  fields: Record<string, unknown>
) {
  const run = (payload: Record<string, unknown>) =>
    mode === "insert"
      ? admin.from("company_billing").insert({ company_id: companyId, ...payload })
      : admin.from("company_billing").update(payload).eq("company_id", companyId);

  let result = await run(fields);
  if (result.error?.code === "42703" && "card_fingerprint" in fields) {
    const withoutFingerprint = { ...fields };
    delete withoutFingerprint.card_fingerprint;
    result = await run(withoutFingerprint);
  }
  return result;
}

/**
 * v2 after a card is saved: take anything outstanding, then make sure a fleet
 * that is billable has a period to be billed in.
 *
 * BILL2-5: a past_due v2 company could never recover; replacing the card did
 * nothing. Outstanding closed and failed periods are now collected at once
 * with the new card, and the company returns to active when all of them pay.
 *
 * BILL1-2: a fleet already active when the first card is saved (licences made
 * active before the card, or by SQL) had no period and was never billed. It
 * now gets one, with the minimum, per the spec's "on payment, the floor is
 * taken again and a new period opens".
 */
async function settleV2AfterCardSave(admin: SupabaseClient, companyId: string) {
  const provider = createSquarePeriodPaymentProvider(admin);
  const now = new Date();
  const todayISO = londonDateISO(now);

  const outstanding = await collectOutstandingPeriods(admin, provider, companyId, {
    nowISO: now.toISOString(),
    todayISO,
  });

  const billable = await fetchBillableVehicles(admin, companyId);
  let periodOpened = false;
  let openFailureCode: string | null = null;
  let chargedPence = 0;

  if (billable.size > 0) {
    const activation = await resolveActivation(admin, companyId, todayISO);
    if (activation.action.kind === "open_period_and_charge" && activation.settings) {
      try {
        const opened = await openPeriodAndChargeMinimum(admin, provider, {
          companyId,
          periodStartISO: activation.action.periodStartISO,
          settings: activation.settings,
          minimumPence: activation.action.amountPence,
        });
        if (opened.ok) {
          periodOpened = true;
          chargedPence = opened.grossPence;
        } else {
          openFailureCode = opened.failureCode;
        }
      } catch (error) {
        openFailureCode = "ERROR";
        console.error(
          "Card saved but the billing period could not be opened",
          companyId,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  return {
    retried: outstanding.attempted > 0,
    succeeded:
      outstanding.attempted === 0 ? undefined : outstanding.collected === outstanding.attempted,
    periodsCollected: outstanding.collected,
    periodOpened,
    openFailureCode,
    chargedPence,
  };
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
      // BILL2-10: lets the cooling-off refund be once per card, not only once
      // per company.
      card_fingerprint: card.fingerprint ?? null,
    };

    const today = londonDateISO(new Date());

    // BILL1-12. Two first-time saves in flight at once (a double submit, two
    // tabs) both pass `!existing`. The second insert hits the primary key; its
    // card is disabled and the request answers with the row that won instead
    // of a raw Postgres error.
    async function concurrentFirstSave() {
      await disableCard(square, card!.id, null);
      return NextResponse.json(
        {
          error:
            "Your card is already being saved in another window. Reload the billing page to see it.",
        },
        { status: 409 }
      );
    }

    if (!existing) {
      // Orphan recovery: a prior first-time setup may have charged Square
      // successfully and then crashed before the company_billing insert below
      // ran. Detect that state before charging again.
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
        const { error: insertError } = await writeBilling("insert", admin, companyId, {
          ...cardFields,
          status: "active",
          next_charge_on: nextChargeOn,
          retry_at: null,
          retry_count: 0,
        });
        if (insertError?.code === "23505") return concurrentFirstSave();
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

      /* v2 bills in ARREARS, so saving a card takes no money UNLESS the fleet
         is already billable (BILL1-2), in which case the first period opens
         now with its minimum. Placed after orphan recovery: a succeeded v1
         charge that crashed before its insert is still real money. */
      if (NEW_COMPANY_BILLING_MODEL === "v2_period") {
        const { error: insertError } = await writeBilling("insert", admin, companyId, {
          ...cardFields,
          status: "active",
          billing_model: "v2_period",
          // date NOT NULL (billing_01); inert for v2, the v1 cron skips v2 rows.
          next_charge_on: today,
          retry_at: null,
          retry_count: 0,
        });
        if (insertError?.code === "23505") return concurrentFirstSave();
        if (insertError) {
          throw new Error(insertError.message);
        }

        const settled = await settleV2AfterCardSave(admin, companyId);
        return NextResponse.json({
          ok: true,
          firstCharge: false,
          model: "v2_period",
          ...settled,
        });
      }

      // First-time v1 setup: immediate first charge; write company_billing only
      // on success so a declined card leaves no half-configured subscription.
      // The attempt number is derived from the audit trail (any status), since
      // a declined same-day attempt has already spent its key.
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
          console.error("First charge indeterminate", chargeError.message);
          return NextResponse.json({ error: SETTLING_MESSAGE }, { status: 409 });
        }
        throw chargeError;
      }

      if (!result.succeeded) {
        await disableCard(square, card.id, null);
        return NextResponse.json(
          {
            error: "Your card was declined. No subscription was set up.",
            failureCode: result.failureCode,
          },
          { status: 402 }
        );
      }

      const nextChargeOn = computeNextChargeOn(today);
      const { error: insertError } = await writeBilling("insert", admin, companyId, {
        ...cardFields,
        status: "active",
        next_charge_on: nextChargeOn,
        retry_at: null,
        retry_count: 0,
      });
      if (insertError?.code === "23505") return concurrentFirstSave();
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

    // ---------------------------------------------------------------------
    // Replacement card.
    // ---------------------------------------------------------------------

    if (existing.billing_model === "v2_period") {
      const { error: updateError } = await writeBilling("update", admin, companyId, {
        ...cardFields,
        updated_at: new Date().toISOString(),
      });
      if (updateError) {
        throw new Error(updateError.message);
      }
      await disableCard(
        square,
        existing.square_card_id as string | null | undefined,
        card.id
      );

      // A cancelled company is not billed or reactivated by saving a card.
      if (existing.status === "canceled") {
        return NextResponse.json({ ok: true, firstCharge: false, retried: false });
      }

      const settled = await settleV2AfterCardSave(admin, companyId);
      return NextResponse.json({ ok: true, firstCharge: false, ...settled });
    }

    // v1: store the new card, then, if a cycle is outstanding (mid-dunning or
    // past_due), retry it immediately.
    const action = selectRecoveryAction({
      status: existing.status,
      next_charge_on: existing.next_charge_on as string,
      retry_at: existing.retry_at ?? null,
      retry_count: Number(existing.retry_count),
      billing_model: existing.billing_model as string | null | undefined,
    });

    if (action.kind === "none") {
      const { error: updateError } = await writeBilling("update", admin, companyId, {
        ...cardFields,
        updated_at: new Date().toISOString(),
      });
      if (updateError) {
        throw new Error(updateError.message);
      }
      await disableCard(
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
      // The new card is kept either way.
      await writeBilling("update", admin, companyId, {
        ...cardFields,
        updated_at: new Date().toISOString(),
      });
      if (
        chargeError instanceof Error &&
        chargeError.message.startsWith("PAYMENT_INDETERMINATE")
      ) {
        console.error("Recovery charge indeterminate", chargeError.message);
        return NextResponse.json({ error: SETTLING_MESSAGE }, { status: 409 });
      }
      throw chargeError;
    }

    // BILL1-6: a stale cycle is collected once and the schedule restarts
    // today, instead of back-billing one missed cycle per day.
    const outcome = applyChargeOutcome({
      row: {
        next_charge_on: existing.next_charge_on as string,
      },
      cycleDate,
      attempt,
      succeeded: result.succeeded,
      todayISO: today,
    });

    // Compare-and-swap: apply the outcome only if the dunning state has not
    // moved since `existing` was read (a concurrent cron run on the same
    // cycle). The card is written by the fallback either way.
    const casUpdate = (fields: Record<string, unknown>) =>
      admin
        .from("company_billing")
        .update(fields)
        .eq("company_id", companyId)
        .eq("status", existing.status)
        .eq("retry_count", existing.retry_count)
        .select("company_id");

    const casFields: Record<string, unknown> = {
      ...cardFields,
      ...outcome,
      updated_at: new Date().toISOString(),
    };
    let cas = await casUpdate(casFields);
    if (cas.error?.code === "42703") {
      delete casFields.card_fingerprint;
      cas = await casUpdate(casFields);
    }
    if (cas.error) {
      throw new Error(cas.error.message);
    }
    const casRows = cas.data;

    if (!casRows || casRows.length === 0) {
      const fallback = await writeBilling("update", admin, companyId, {
        ...cardFields,
        updated_at: new Date().toISOString(),
      });
      if (fallback.error) throw new Error(fallback.error.message);
    }

    await disableCard(
      square,
      existing.square_card_id as string | null | undefined,
      card.id
    );

    if (!casRows || casRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Billing state changed while your card was being processed. The card was saved; charges will settle automatically.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      firstCharge: false,
      retried: true,
      succeeded: result.succeeded,
      failureCode: result.failureCode,
      receiptUrl: result.receiptUrl,
      status: outcome.status,
      nextChargeOn: outcome.next_charge_on,
    });
  } catch (error) {
    const result = errorResponse(error);
    // BILL1-12: never pass PostgREST or Square messages to the browser.
    if (result.status === 500) {
      console.error(
        "Card save failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
      return NextResponse.json(
        {
          error:
            "Something went wrong saving your card. Reload the billing page to check before trying again.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(result.body, { status: result.status });
  }
}
