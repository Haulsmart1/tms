// The Square implementation of PeriodPaymentProvider. Square calls live here;
// every decision is delegated to the pure modules.
//
// This follows the INTENT-FIRST pattern billing_05 established for mid-cycle
// add-ons, and for the same reason: a crash between a successful Square call
// and recording the outcome must leave something a retry can rebuild a
// byte-identical request body from. Square only replays a reused idempotency
// key when the body matches, so a retry that recomputes its body from live
// state gets IDEMPOTENCY_KEY_REUSED and the charge can never advance.
//
// Period charges are in a better position than add-ons were: the amount is
// fixed once the invoice lines are written, so the body does not drift with
// the clock or the fleet size. The pending row is still recorded first,
// because the CARD can change under a customer who is told "still settling"
// and replaces it, which is the case that wedged add-ons permanently before
// billing_05.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SquareError } from "square";

import { getSquare, getSquareLocationId } from "../payments/square";
import { classifyPaymentResult } from "./money";
import { classifySquareThrow } from "./squareThrow";
import {
  periodChargeIdempotencyKey,
  periodChargeNote,
} from "./periodPayment";
import type {
  PeriodCharge,
  PeriodChargeResult,
  PeriodPaymentProvider,
} from "./periodPayment";

type PendingRow = {
  id: string;
  attempt: number;
  net_pence: number;
  vat_pence: number;
  gross_pence: number;
  currency: string;
  square_card_id: string | null;
  square_customer_id: string | null;
};

/**
 * Square-backed period payments.
 *
 * `admin` must be a service-role client: period_charges has no INSERT policy
 * and its DML grants are revoked from every browser role (billing_06).
 */
export function createSquarePeriodPaymentProvider(
  admin: SupabaseClient
): PeriodPaymentProvider {
  return {
    name: "square",
    charge: (charge) => chargePeriod(admin, charge),
  };
}

async function chargePeriod(
  admin: SupabaseClient,
  charge: PeriodCharge
): Promise<PeriodChargeResult> {
  // Nothing owed. Common: a small fleet whose whole period is covered by the
  // minimum already collected, and every cancellation by a two-vehicle
  // customer. A zero-amount audit row is still written so the period has a
  // settled record rather than an absence someone later reads as "we forgot",
  // matching how runChargeCycle handles a zero-vehicle cycle.
  if (charge.grossPence <= 0) {
    await admin.from("period_charges").insert({
      company_id: charge.companyId,
      billing_period_id: charge.periodId,
      kind: charge.kind,
      attempt: 1,
      net_pence: 0,
      vat_pence: 0,
      gross_pence: 0,
      currency: charge.currency,
      status: "succeeded",
    });
    return { status: "skipped" };
  }

  const { data: billing, error: billingError } = await admin
    .from("company_billing")
    .select("square_customer_id, square_card_id")
    .eq("company_id", charge.companyId)
    .maybeSingle();

  if (billingError) throw new Error(billingError.message);
  if (!billing?.square_card_id || !billing?.square_customer_id) {
    return { status: "failed", failureCode: "NO_PAYMENT_METHOD" };
  }

  const pending = await claimAttempt(admin, charge, {
    cardId: billing.square_card_id as string,
    customerId: billing.square_customer_id as string,
  });

  // Everything sent to Square comes from the PENDING ROW, never from `charge`.
  // That is the whole point of recording intent first: on a retry these are
  // the values the original call used, so the body is byte-identical and
  // Square replays the original payment instead of refusing the key.
  const idempotencyKey = periodChargeIdempotencyKey(
    charge.periodId,
    charge.kind,
    pending.attempt
  );
  const note = periodChargeNote(
    charge.kind,
    charge.periodStartISO,
    charge.periodEndISO
  );

  // Resolved BEFORE the try. Both throw when an env var is missing, which is a
  // configuration outage with no request sent; inside the try that would be
  // classified as a payment of unknown outcome and reported as "the money may
  // have moved" for a call that never left the process. Same reasoning as
  // runChargeCycle.
  const square = getSquare();
  const locationId = getSquareLocationId();

  let payment: { id?: string; receiptUrl?: string; status?: string } | undefined;

  try {
    const response = await square.payments.create({
      idempotencyKey,
      sourceId: pending.square_card_id ?? billing.square_card_id,
      customerId: pending.square_customer_id ?? billing.square_customer_id,
      locationId,
      amountMoney: {
        amount: BigInt(pending.gross_pence),
        currency: pending.currency as "GBP",
      },
      note,
    });
    payment = response.payment;
  } catch (error) {
    if (
      error instanceof SquareError &&
      error.errors[0]?.code === "IDEMPOTENCY_KEY_REUSED"
    ) {
      // A payment exists under this key with a body that no longer matches.
      // Its outcome is unknown here: recording a failure would misclassify a
      // possible success, recording a success would be a guess. The pending
      // row is deliberately LEFT IN PLACE so the attempt cannot advance and
      // mint a fresh key against a card that may already have been charged.
      throw new Error(
        `PAYMENT_INDETERMINATE: idempotency key already used for period ${charge.periodId} ${charge.kind} attempt ${pending.attempt}; a payment exists with unknown outcome, reconcile against Square before retrying`
      );
    }

    // Only a throw that PROVES Square refused the payment may be recorded as a
    // decline. A dropped connection arrives here as a SquareError too, and
    // recording that as failed would retire this attempt and let the next run
    // open a new key against a card that may already have been charged. See
    // squareThrow.ts, which exists entirely for this distinction.
    const thrown = classifySquareThrow(error);
    if (thrown.kind === "indeterminate") {
      throw new Error(
        `PAYMENT_INDETERMINATE: no usable answer from Square for period ${charge.periodId} ${charge.kind} attempt ${pending.attempt}: ${thrown.reason}; the pending row is kept so the next run replays the same idempotency key`
      );
    }

    await settle(admin, pending.id, {
      status: "failed",
      failure_code: thrown.failureCode,
    });
    return { status: "failed", failureCode: thrown.failureCode };
  }

  // Outside the try on purpose: the catch only sees network and SDK failures.
  // A call that SUCCEEDED but returned a non-terminal status must throw here,
  // before anything is settled, so the pending row survives for the retry.
  const classification = classifyPaymentResult(payment);
  if (classification.kind === "indeterminate") {
    throw new Error(
      `PAYMENT_INDETERMINATE: payment ${payment?.id ?? "unknown"} for period ${charge.periodId} has status ${classification.status}; nothing settled, the next run re-checks with the same idempotency key`
    );
  }

  if (classification.kind === "failed") {
    await settle(admin, pending.id, {
      status: "failed",
      failure_code: classification.failureCode,
    });
    return { status: "failed", failureCode: classification.failureCode };
  }

  await settle(admin, pending.id, {
    status: "succeeded",
    square_payment_id: payment?.id ?? null,
    receipt_url: payment?.receiptUrl ?? null,
  });

  return {
    status: "succeeded",
    providerPaymentId: payment?.id ?? "",
    receiptUrl: payment?.receiptUrl ?? null,
  };
}

/**
 * Find the pending attempt to replay, or record a new one.
 *
 * A pending row means a previous call reached Square and its outcome was never
 * recorded. NEVER delete one to tidy up: that frees the attempt number, and the
 * next request would spend the same key with a different body, wedging the
 * period exactly the way billing_05 exists to prevent.
 */
async function claimAttempt(
  admin: SupabaseClient,
  charge: PeriodCharge,
  card: { cardId: string; customerId: string }
): Promise<PendingRow> {
  const { data: existing, error: existingError } = await admin
    .from("period_charges")
    .select(
      "id, attempt, net_pence, vat_pence, gross_pence, currency, square_card_id, square_customer_id"
    )
    .eq("billing_period_id", charge.periodId)
    .eq("kind", charge.kind)
    .eq("status", "pending")
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as PendingRow;

  // Attempt numbers count settled attempts, so a decline advances the key and
  // a crash does not. Derived from the table rather than held in memory,
  // because the crash case is exactly when memory is gone.
  const { data: settled, error: settledError } = await admin
    .from("period_charges")
    .select("attempt")
    .eq("billing_period_id", charge.periodId)
    .eq("kind", charge.kind)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (settledError) throw new Error(settledError.message);

  const attempt = (settled?.attempt ?? 0) + 1;

  const { data: inserted, error: insertError } = await admin
    .from("period_charges")
    .insert({
      company_id: charge.companyId,
      billing_period_id: charge.periodId,
      kind: charge.kind,
      attempt,
      net_pence: charge.netPence,
      vat_pence: charge.vatPence,
      gross_pence: charge.grossPence,
      currency: charge.currency,
      // Stored so a retry resends exactly this card. A customer told "still
      // settling" who replaces their card and tries again would otherwise send
      // the stored key with a different body and be refused forever.
      square_card_id: card.cardId,
      square_customer_id: card.customerId,
      status: "pending",
    })
    .select(
      "id, attempt, net_pence, vat_pence, gross_pence, currency, square_card_id, square_customer_id"
    )
    .single();

  if (insertError) throw new Error(insertError.message);
  return inserted as PendingRow;
}

async function settle(
  admin: SupabaseClient,
  chargeRowId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from("period_charges")
    .update(fields)
    .eq("id", chargeRowId);

  // Throwing here leaves a pending row, which is the safe direction: the
  // outcome is genuinely unknown to the database, and the next run replays the
  // same key rather than opening a new one.
  if (error) {
    throw new Error(
      `Square answered for period charge ${chargeRowId} but the outcome could not be recorded: ${error.message}`
    );
  }
}
