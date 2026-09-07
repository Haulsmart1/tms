// Server-only orchestration for ONE mid-cycle vehicle add-on charge.
// Deliberately mirrors runChargeCycle in ./server.ts: the prior-success
// check, the IDEMPOTENCY_KEY_REUSED handling and the indeterminate-status
// guard are what stop a crash or a retry from charging a customer twice, and
// they must not diverge between the two paths.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SquareError } from "square";
import { getSquare, getSquareLocationId } from "../payments/square";
import { addonIdempotencyKey, classifyPaymentResult } from "./money";
import { computeAddonAmounts } from "./prorata";

export type AddonChargeResult = {
  companyId: string;
  vehicleId: string;
  cycleDate: string;
  attempt: number;
  days: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  succeeded: boolean;
  failureCode: string | null;
  squarePaymentId: string | null;
  receiptUrl: string | null;
  alreadyPaid: boolean;
};

function extractSquareFailureCode(error: unknown): string {
  if (error instanceof SquareError) {
    return error.errors[0]?.code ?? error.message.slice(0, 120);
  }
  const maybe = error as { message?: string };
  return maybe?.message ? maybe.message.slice(0, 120) : "UNKNOWN";
}

// Charges the card for one vehicle's share of the rest of the cycle, records
// the audit row, and writes the coverage row that makes the vehicle legal for
// this cycle.
//
// Throws PAYMENT_INDETERMINATE when Square's answer is not terminal. The
// caller must translate that into "try again shortly" and must NOT activate
// the licence: recording a success would be a lie, and recording a failure
// would let a later-completing payment charge the customer twice.
export async function chargeVehicleAddon(
  admin: SupabaseClient,
  args: {
    companyId: string;
    vehicleId: string;
    cycleDate: string;
    days: number;
    baselineCount: number;
    squareCustomerId: string;
    squareCardId: string;
  }
): Promise<AddonChargeResult> {
  // A zero-day add-on is not a cheap charge, it is a free cycle. days === 0
  // means the cycle charge is due today, and selectAddonAction deliberately
  // returns free/cycle_due there WITHOUT recording coverage, precisely so the
  // imminent cron run bills the vehicle at full price. Reaching this function
  // with days === 0 would instead write a coverage row for a payment of
  // nothing, which is the exploit this feature exists to close. Unreachable
  // through selectAddonAction today; guarded because the cost of being wrong
  // here is a free fleet.
  if (!Number.isInteger(args.days) || args.days < 1) {
    throw new Error(
      `chargeVehicleAddon requires at least one day, got ${args.days} for company ${args.companyId} vehicle ${args.vehicleId}`
    );
  }

  // Has this vehicle already been paid for in this cycle by an earlier
  // attempt that crashed before writing coverage? Same guard as
  // runChargeCycle's prior-success check, and for the same reason.
  const { data: priorRows, error: priorError } = await admin
    .from("vehicle_addon_charges")
    .select("attempt, covers_days, net_pence, vat_pence, gross_pence, square_payment_id, receipt_url")
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("vehicle_id", args.vehicleId)
    .eq("status", "succeeded")
    .order("attempt", { ascending: false })
    .limit(1);

  if (priorError) {
    throw new Error(`Unable to check for a prior charge: ${priorError.message}`);
  }

  const prior = priorRows?.[0];
  if (prior) {
    await writeCoverage(admin, args.companyId, args.cycleDate, args.vehicleId);
    return {
      companyId: args.companyId,
      vehicleId: args.vehicleId,
      cycleDate: args.cycleDate,
      attempt: Number(prior.attempt),
      days: Number(prior.covers_days),
      netPence: Number(prior.net_pence),
      vatPence: Number(prior.vat_pence),
      grossPence: Number(prior.gross_pence),
      succeeded: true,
      failureCode: null,
      squarePaymentId: prior.square_payment_id ?? null,
      receiptUrl: prior.receipt_url ?? null,
      alreadyPaid: true,
    };
  }

  // Attempt number comes from the audit trail, never hardcoded. A declined
  // attempt has already spent its idempotency key, so reusing it for a retry
  // under a different card would send a new request body under the same key,
  // which Square rejects as IDEMPOTENCY_KEY_REUSED. Failed attempts count for
  // exactly that reason. Same derivation as the first-time charge in
  // app/api/billing/card/route.ts.
  const { data: attemptRows, error: attemptError } = await admin
    .from("vehicle_addon_charges")
    .select("attempt")
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("vehicle_id", args.vehicleId)
    .order("attempt", { ascending: false })
    .limit(1);

  if (attemptError) {
    throw new Error(attemptError.message);
  }

  const attempt = Number(attemptRows?.[0]?.attempt ?? 0) + 1;
  const amounts = computeAddonAmounts(args.baselineCount, args.days);

  let succeeded = true;
  let failureCode: string | null = null;
  let squarePaymentId: string | null = null;
  let receiptUrl: string | null = null;

  if (amounts.grossPence > 0) {
    let payment: { id?: string; receiptUrl?: string; status?: string } | undefined;
    let callThrew = false;

    try {
      const square = getSquare();
      const response = await square.payments.create({
        idempotencyKey: addonIdempotencyKey(
          args.companyId,
          args.cycleDate,
          args.vehicleId,
          attempt
        ),
        sourceId: args.squareCardId,
        customerId: args.squareCustomerId,
        locationId: getSquareLocationId(),
        amountMoney: {
          amount: BigInt(amounts.grossPence),
          currency: "GBP",
        },
        note: `TMS Wizzard vehicle added mid-cycle ${args.cycleDate}: ${args.days} days`,
      });
      payment = response.payment;
    } catch (error) {
      if (
        error instanceof SquareError &&
        error.errors[0]?.code === "IDEMPOTENCY_KEY_REUSED"
      ) {
        throw new Error(
          `PAYMENT_INDETERMINATE: idempotency key already used for company ${args.companyId} vehicle ${args.vehicleId} cycle ${args.cycleDate} attempt ${attempt}; a payment exists with unknown outcome, try again later`
        );
      }
      callThrew = true;
      succeeded = false;
      failureCode = extractSquareFailureCode(error);
    }

    // Outside the try/catch on purpose: the catch only sees network and SDK
    // failures. A call that succeeded but returned a non-terminal status must
    // throw HERE, before the audit insert, so nothing is recorded.
    if (!callThrew) {
      squarePaymentId = payment?.id ?? null;
      receiptUrl = payment?.receiptUrl ?? null;

      const classification = classifyPaymentResult(payment);
      if (classification.kind === "indeterminate") {
        throw new Error(
          "PAYMENT_INDETERMINATE: payment " +
            (squarePaymentId ?? "unknown") +
            " has status " +
            classification.status +
            "; no outcome recorded, try again shortly"
        );
      }

      succeeded = classification.kind === "succeeded";
      failureCode =
        classification.kind === "failed" ? classification.failureCode : null;
    }
  }

  const { error: insertError } = await admin.from("vehicle_addon_charges").insert({
    company_id: args.companyId,
    vehicle_id: args.vehicleId,
    cycle_date: args.cycleDate,
    attempt,
    covers_days: amounts.days,
    baseline_count: amounts.baselineCount,
    net_pence: amounts.netPence,
    vat_pence: amounts.vatPence,
    gross_pence: amounts.grossPence,
    vat_rate: amounts.vatRate,
    currency: "GBP",
    square_payment_id: squarePaymentId,
    receipt_url: receiptUrl,
    status: succeeded ? "succeeded" : "failed",
    failure_code: failureCode,
  });

  // 23505 = unique_violation. A rerun after a crash reuses the same
  // idempotency key, so Square returns the SAME payment and the recomputed
  // outcome matches the row already recorded: already-recorded, not an error.
  if (insertError && insertError.code !== "23505") {
    throw new Error(
      `Charge recorded at Square but vehicle_addon_charges insert failed: ${insertError.message}`
    );
  }

  if (succeeded) {
    await writeCoverage(admin, args.companyId, args.cycleDate, args.vehicleId);
  }

  return {
    companyId: args.companyId,
    vehicleId: args.vehicleId,
    cycleDate: args.cycleDate,
    attempt,
    days: amounts.days,
    netPence: amounts.netPence,
    vatPence: amounts.vatPence,
    grossPence: amounts.grossPence,
    succeeded,
    failureCode,
    squarePaymentId,
    receiptUrl,
    alreadyPaid: false,
  };
}

// Coverage is what makes the vehicle legal for this cycle, so a failure here
// must be loud: silently skipping it would leave the customer charged for a
// vehicle the next add would charge them for all over again.
export async function writeCoverage(
  admin: SupabaseClient,
  companyId: string,
  cycleDate: string,
  vehicleId: string
): Promise<void> {
  const { error } = await admin
    .from("vehicle_cycle_coverage")
    .upsert(
      { company_id: companyId, cycle_date: cycleDate, vehicle_id: vehicleId },
      { onConflict: "company_id,cycle_date,vehicle_id", ignoreDuplicates: true }
    );
  if (error) {
    throw new Error(`Coverage could not be recorded: ${error.message}`);
  }
}
