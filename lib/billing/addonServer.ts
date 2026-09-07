// Server-only orchestration for ONE mid-cycle vehicle add-on charge.
//
// It follows runChargeCycle in ./server.ts on the parts that stop a crash or a
// retry from charging a customer twice: the prior-success check, the
// IDEMPOTENCY_KEY_REUSED handling and the indeterminate-status guard. Those
// three must not diverge between the two paths.
//
// It deliberately DOES diverge on two points, and both are documented where
// they happen rather than here: this file records its audit row BEFORE calling
// Square (see recordIntent below), and it writes coverage AFTER the audit row
// rather than atomically with it (see the writeCoverage call). Do not
// "resynchronise" either one with ./server.ts without reading those comments;
// the asymmetry is what makes each path safe.

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

// The exact numbers one Square call is made with. Once an attempt exists these
// come from the stored pending row and NEVER from the caller's args, because
// the args drift: `days` counts down at every London midnight and
// `baselineCount` moves whenever another vehicle is added. Square only replays
// a reused idempotency key when the request body is byte-identical, so a body
// rebuilt from drifted args is refused with IDEMPOTENCY_KEY_REUSED instead of
// returning the original payment.
type ResolvedCharge = {
  attempt: number;
  days: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
};

function extractSquareFailureCode(error: unknown): string {
  if (error instanceof SquareError) {
    return error.errors[0]?.code ?? error.message.slice(0, 120);
  }
  const maybe = error as { message?: string };
  return maybe?.message ? maybe.message.slice(0, 120) : "UNKNOWN";
}

// The highest-numbered attempt that has not yet reached a terminal status, if
// any. Selecting the amounts as well as the attempt is the point: this row is
// the record of what was sent to Square, and a replay must send exactly that
// again.
async function readPendingIntent(
  admin: SupabaseClient,
  companyId: string,
  cycleDate: string,
  vehicleId: string
): Promise<ResolvedCharge | null> {
  const { data, error } = await admin
    .from("vehicle_addon_charges")
    .select("attempt, covers_days, net_pence, vat_pence, gross_pence")
    .eq("company_id", companyId)
    .eq("cycle_date", cycleDate)
    .eq("vehicle_id", vehicleId)
    .eq("status", "pending")
    .order("attempt", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Unable to check for a pending charge: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) return null;

  return {
    attempt: Number(row.attempt),
    days: Number(row.covers_days),
    netPence: Number(row.net_pence),
    vatPence: Number(row.vat_pence),
    grossPence: Number(row.gross_pence),
  };
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

  let resolved: ResolvedCharge | null = null;

  // Rounds exist only to settle a race. Round 0 is the plain path: prior
  // success, then pending intent, then insert a new intent. A concurrent
  // request that wins the unique key sends us round again, and the second look
  // sees whatever it left behind (a pending row to join, a succeeded row to
  // return, or a failed row to number the next attempt from). Three is far
  // more than the two-request case needs and still terminates.
  for (let round = 0; round < 3 && resolved === null; round += 1) {
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

    // An attempt that was started but never settled. Its idempotency key may
    // already have taken the customer's money, so the only safe move is to
    // replay it with the SAME body and let Square tell us what happened. Do
    // not recompute from args here: see the comment on ResolvedCharge.
    resolved = await readPendingIntent(
      admin,
      args.companyId,
      args.cycleDate,
      args.vehicleId
    );
    if (resolved !== null) break;

    // Attempt number comes from the audit trail, never hardcoded, and counts
    // rows of EVERY status. A declined attempt has spent its idempotency key
    // (a retry under a new card is a different body, which Square refuses
    // under the old key), and so has a pending one. Same derivation as the
    // first-time charge in app/api/billing/card/route.ts.
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

    // RECORD INTENT BEFORE SPENDING THE KEY. This is the divergence from
    // ./server.ts flagged in the file header, and it is the whole fix.
    //
    // Writing the audit row afterwards meant a crash between a successful
    // Square call and the insert left no record at all. The next request
    // recomputed the same attempt (nothing had advanced it) but a different
    // body, because `days` shrinks at every London midnight and
    // `baselineCount` moves when another vehicle is added, so Square answered
    // IDEMPOTENCY_KEY_REUSED and the code threw PAYMENT_INDETERMINATE. It
    // would throw that forever: the attempt cannot advance without a row, and
    // the row cannot be written without a successful call. The customer was
    // charged, uncovered, unable to add the vehicle, and charged a second time
    // once the cycle rolled over and minted a fresh key.
    //
    // Storing covers_days, baseline_count and the amounts BEFORE the call
    // makes the key replayable: a retry rebuilds a byte-identical body from
    // this row, so Square returns the original payment instead of refusing.
    // Requires docs/sql/billing_05_addon_intent.sql, which widens the status
    // check to allow 'pending'. Without it this insert is rejected with 23514,
    // BEFORE the Square call, so the failure is an outage and not a charge.
    const { error: intentError } = await admin
      .from("vehicle_addon_charges")
      .insert({
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
        square_payment_id: null,
        receipt_url: null,
        status: "pending",
        failure_code: null,
      });

    if (!intentError) {
      resolved = {
        attempt,
        days: amounts.days,
        netPence: amounts.netPence,
        vatPence: amounts.vatPence,
        grossPence: amounts.grossPence,
      };
      break;
    }

    // 23505 = unique_violation on (company_id, cycle_date, vehicle_id,
    // attempt). A concurrent request for the same vehicle claimed this attempt
    // first. Loop and read what it wrote rather than picking attempt + 1: the
    // pending row is now the serialisation point, so two simultaneous requests
    // converge on ONE attempt, one idempotency key and therefore one payment,
    // instead of racing to two keys and charging the card twice.
    if (intentError.code !== "23505") {
      throw new Error(`Unable to record charge intent: ${intentError.message}`);
    }
  }

  if (resolved === null) {
    // Only reachable if something else keeps taking the attempt number away
    // from us. Throwing leaves whatever rows exist untouched and no payment
    // attempted, which is the safe direction.
    throw new Error(
      `PAYMENT_INDETERMINATE: could not claim an attempt for company ${args.companyId} vehicle ${args.vehicleId} cycle ${args.cycleDate}; try again shortly`
    );
  }

  const charge = resolved;

  let succeeded = true;
  let failureCode: string | null = null;
  let squarePaymentId: string | null = null;
  let receiptUrl: string | null = null;
  let payment: { id?: string; receiptUrl?: string; status?: string } | undefined;
  let callThrew = false;

  // Unconditional: there is no "if the amount is zero, skip Square" branch any
  // more. It was unreachable (days >= 1 is enforced above and the cheapest
  // price band is 500 pence a week, so the marginal rate is never zero) and it
  // encoded the wrong outcome if it ever did fire: skip the payment, declare
  // success, write coverage, which is a free vehicle. The zero-day guard plus
  // the band minimum is what makes charging unconditionally safe here; if a
  // free band is ever introduced, handle it in selectAddonAction so it returns
  // `free` and never reaches this function.
  try {
    const square = getSquare();
    const response = await square.payments.create({
      idempotencyKey: addonIdempotencyKey(
        args.companyId,
        args.cycleDate,
        args.vehicleId,
        charge.attempt
      ),
      sourceId: args.squareCardId,
      customerId: args.squareCustomerId,
      locationId: getSquareLocationId(),
      amountMoney: {
        amount: BigInt(charge.grossPence),
        currency: "GBP",
      },
      // charge.days, not args.days. The note is part of the request body, so
      // interpolating the caller's drifting day count would break the replay
      // just as surely as a wrong amount would.
      note: `TMS Wizzard vehicle added mid-cycle ${args.cycleDate}: ${charge.days} days`,
    });
    payment = response.payment;
  } catch (error) {
    if (
      error instanceof SquareError &&
      error.errors[0]?.code === "IDEMPOTENCY_KEY_REUSED"
    ) {
      throw new Error(
        `PAYMENT_INDETERMINATE: idempotency key already used for company ${args.companyId} vehicle ${args.vehicleId} cycle ${args.cycleDate} attempt ${charge.attempt}; a payment exists with unknown outcome, try again later`
      );
    }

    // A THROW THAT IS NOT A SquareError IS NOT A DECLINE. A socket reset, a
    // DNS failure or a request timeout means we have no answer, and "no
    // response" is not evidence that no payment was taken: Square may have
    // processed the request perfectly and lost the reply. Recording that as
    // `failed` would retire this attempt, and the next call would open a NEW
    // idempotency key and charge the card a second time for the same vehicle.
    //
    // So rethrow and leave the pending row exactly as it is. The next call
    // finds it, replays the same key with the same body, and observes the real
    // outcome from Square instead of guessing at one.
    if (!(error instanceof SquareError)) {
      throw new Error(
        `PAYMENT_INDETERMINATE: no response from Square for company ${args.companyId} vehicle ${args.vehicleId} cycle ${args.cycleDate} attempt ${charge.attempt}: ${extractSquareFailureCode(error)}; the payment may have been taken, try again shortly`
      );
    }

    // A SquareError IS an answer: the API accepted the request and refused it.
    // That is terminal and safe to record as a decline.
    callThrew = true;
    succeeded = false;
    failureCode = extractSquareFailureCode(error);
  }

  // Outside the try/catch on purpose: the catch only sees network and SDK
  // failures. A call that succeeded but returned a non-terminal status must
  // throw HERE, before the audit row is settled, so no outcome is recorded and
  // the pending row survives for the next call to replay.
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

  // Settle the row we already own. An UPDATE, never a second INSERT: the
  // amounts stored before the call are the amounts that were charged, and
  // rewriting them from args would destroy the record of what the idempotency
  // key actually bought.
  //
  // No status filter on the update. If a concurrent request settled the same
  // attempt first, it saw the same replayed payment and therefore reached the
  // same outcome, so writing it again is a no-op in content.
  const { error: settleError } = await admin
    .from("vehicle_addon_charges")
    .update({
      square_payment_id: squarePaymentId,
      receipt_url: receiptUrl,
      status: succeeded ? "succeeded" : "failed",
      failure_code: failureCode,
    })
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("vehicle_id", args.vehicleId)
    .eq("attempt", charge.attempt);

  if (settleError) {
    throw new Error(
      `Charge recorded at Square but vehicle_addon_charges update failed: ${settleError.message}`
    );
  }

  if (succeeded) {
    // AUDIT ROW FIRST, COVERAGE SECOND. This is the OPPOSITE order to
    // ./server.ts, which writes both atomically through record_cycle_charge,
    // and the difference is deliberate.
    //
    // Here the prior-success branch at the top of this function REWRITES
    // coverage every time it runs, so an audit row without coverage repairs
    // itself on the very next call. Nothing is lost by writing coverage
    // second.
    //
    // The reverse order would not be recoverable. /api/licences/activate looks
    // up vehicle_cycle_coverage BEFORE it calls this function and short
    // circuits to `free` when it finds a row. So a coverage-first write
    // followed by a failed audit write would leave a real payment with no
    // audit row, and the next call would never enter this function at all: no
    // prior-success check would run, nothing would notice, and the payment
    // would sit unrecorded forever.
    await writeCoverage(admin, args.companyId, args.cycleDate, args.vehicleId);
  }

  return {
    companyId: args.companyId,
    vehicleId: args.vehicleId,
    cycleDate: args.cycleDate,
    attempt: charge.attempt,
    days: charge.days,
    netPence: charge.netPence,
    vatPence: charge.vatPence,
    grossPence: charge.grossPence,
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
//
// MODULE-PRIVATE ON PURPOSE, and it must stay that way. selectAddonAction
// honours `alreadyCovered` ahead of the past_due and canceled gates, and it is
// only allowed to do that because of one invariant: coverage is written by a
// payment that actually succeeded, and by nothing else. An exported
// coverage writer takes no proof of payment, so it hands any future caller a
// one-line way to mark a vehicle paid for on a free path. That is not an
// abstract worry: it would let a company with a dead card keep adding vehicles
// through the dunning gate, which is a hole in dunning itself. Keep the only
// call sites the two in chargeVehicleAddon above, both of which sit behind a
// confirmed payment.
async function writeCoverage(
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
