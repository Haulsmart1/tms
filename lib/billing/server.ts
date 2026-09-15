// Server-only billing orchestration. Auth, DB reads/writes (service role) and
// Square calls live here; all decisions are delegated to the pure modules.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SquareError } from "square";
import { createAdminClient, createUserClient } from "../accounts/server";
import { ACCOUNTS_ADMIN_ROLES, isRoleAuthorized } from "../accounts/authz";
import { extractRoleName } from "../roles";
import { getSquare, getSquareLocationId } from "../payments/square";
import { reconcilePaymentByReference } from "../payments/squareLookup";
import {
  chargeIdempotencyKey,
  classifyPaymentResult,
  computeChargeAmounts,
  VAT_RATE,
} from "./money";
import { paymentReferenceId } from "./reconcile";
import { classifySquareThrow } from "./squareThrow";
import { billableVehicleIds } from "./vehicleCount";
import { selectV1CancellationAction } from "./cancellation";

// PostgREST caps unscoped selects at 1000 rows by default. Hitting this cap
// means the vehicle/licence count below is silently truncated, which
// undercounts and underbills; refuse rather than guess.
const POSTGREST_ROW_CAP = 1000;

export async function requireCompanyAdmin() {
  const userClient = await createUserClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    throw new Error("UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("company_id, roles(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const role = extractRoleName(profile?.roles);

  if (!profile?.company_id || !isRoleAuthorized(role, ACCOUNTS_ADMIN_ROLES)) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user, companyId: profile.company_id as string, role };
}

export async function fetchBillableVehicles(
  admin: SupabaseClient,
  companyId: string
): Promise<Set<string>> {
  const tenantsRes = await admin
    .from("tenants")
    .select("id")
    .eq("company_id", companyId);

  if (tenantsRes.error) {
    throw new Error(`Unable to load billing data: ${tenantsRes.error.message}`);
  }

  const tenantIds = (tenantsRes.data ?? []).map((t) => t.id as string);

  // Scope vehicles to this company's tenants. `vehicles` is keyed by
  // tenant_id only: there is no company_id column, so do not filter on one
  // (PostgREST answers 42703 "column vehicles.company_id does not exist" and
  // the whole charge fails). companyId is included in the list because some
  // rows carry a company id in tenant_id directly, and it also keeps
  // `in.(...)` non-empty for a company with zero tenants.
  const idList = [...tenantIds, companyId];
  const vehiclesRes = await admin
    .from("vehicles")
    .select("id, tenant_id")
    .in("tenant_id", idList);

  if (vehiclesRes.error) {
    throw new Error(`Unable to load billing data: ${vehiclesRes.error.message}`);
  }

  const vehicles = vehiclesRes.data ?? [];
  if (vehicles.length >= POSTGREST_ROW_CAP) {
    throw new Error(
      `Billing refused: query hit the 1000-row cap for company ${companyId}; counts may be truncated`
    );
  }

  const vehicleIds = vehicles.map((v) => v.id as string);
  if (vehicleIds.length === 0) {
    return new Set();
  }

  const licencesRes = await admin
    .from("vehicle_licences")
    .select("vehicle_id, active")
    .eq("active", true)
    .in("vehicle_id", vehicleIds);

  if (licencesRes.error) {
    throw new Error(`Unable to load billing data: ${licencesRes.error.message}`);
  }

  const licences = licencesRes.data ?? [];
  if (licences.length >= POSTGREST_ROW_CAP) {
    throw new Error(
      `Billing refused: query hit the 1000-row cap for company ${companyId}; counts may be truncated`
    );
  }

  return billableVehicleIds({
    companyId,
    companyTenantIds: tenantIds,
    vehicles,
    licences,
  });
}

export type CycleResult = {
  companyId: string;
  cycleDate: string;
  attempt: number;
  vehicleCount: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  succeeded: boolean;
  failureCode: string | null;
  squarePaymentId: string | null;
  receiptUrl: string | null;
};

// What one cycle charge sends to Square, and the vehicles it pays for. Taken
// from a pending intent row when one exists, never recomputed on a replay.
type CycleBody = {
  attempt: number;
  vehicleIds: string[];
  vehicleCount: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  squareCardId: string;
  squareCustomerId: string;
  createdAt: string | null;
};

const INTENT_SELECT =
  "attempt, status, vehicle_count, net_pence, vat_pence, gross_pence, square_card_id, square_customer_id, vehicle_ids, created_at";

type IntentRow = {
  attempt: number;
  status: string;
  vehicle_count: number;
  net_pence: number;
  vat_pence: number;
  gross_pence: number;
  square_card_id: string | null;
  square_customer_id: string | null;
  vehicle_ids: string[] | null;
  created_at: string | null;
};

// 42703 means prodfix_33 is not applied: platform_charges has no intent
// columns, and the charge falls back to recording its outcome after Square
// answers, which is exactly how it worked before.
function intentUnsupported(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

// Runs one charge attempt end to end: count vehicles, take payment (skipped
// for zero vehicles), record the platform_charges audit row and the coverage
// it bought. Does NOT touch company_billing; callers persist
// applyChargeOutcome themselves, because the first-ever charge creates the row
// while cron charges update it.
//
// INTENT FIRST (review BILL1-3). This used to record nothing until Square
// answered. On an indeterminate answer the next run sent the same key with a
// body recomputed from the live fleet, and if the fleet had changed Square
// answered IDEMPOTENCY_KEY_REUSED, every day, forever. It now writes a
// `pending` row holding the amounts, the card and the vehicle ids BEFORE the
// call, and a retry resends exactly that. Same pattern as billing_05 for
// add-ons and period_charges for v2. Needs docs/sql/prodfix_33; without it the
// old record-after behaviour runs unchanged.
//
// A DUNNING RETRY CHARGES WHAT THE CYCLE RECORDED (review BILL1-6). Attempts
// after the first reuse the failed attempt's amounts and vehicle ids, so a
// company recovering after months past_due pays the cycle it owed, not that
// cycle re-priced at today's fleet.
//
// If Square returns a non-terminal status (PENDING/APPROVED), this throws
// PAYMENT_INDETERMINATE before settling anything: recording it as either
// succeeded or failed would be wrong (failed schedules a retry under a NEW
// idempotency key, and if the pending payment later completes the customer is
// charged twice). The next run replays the SAME key and body.
export async function runChargeCycle(
  admin: SupabaseClient,
  args: {
    companyId: string;
    cycleDate: string;
    attempt: number;
    squareCustomerId: string;
    squareCardId: string;
  }
): Promise<CycleResult> {
  const { data: priorRows, error: priorError } = await admin
    .from("platform_charges")
    .select(
      "attempt, vehicle_count, net_pence, vat_pence, gross_pence, square_payment_id, receipt_url"
    )
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("status", "succeeded")
    .order("attempt", { ascending: false })
    .limit(1);

  if (priorError) {
    throw new Error(`Unable to check for a prior charge: ${priorError.message}`);
  }

  const prior = priorRows?.[0];
  if (prior) {
    // This cycle was already paid (an earlier attempt succeeded but the caller
    // crashed before persisting the outcome). Return the recorded result so the
    // caller can finish the bookkeeping; charging again would double-bill.
    return {
      companyId: args.companyId,
      cycleDate: args.cycleDate,
      attempt: Number(prior.attempt),
      vehicleCount: Number(prior.vehicle_count),
      netPence: Number(prior.net_pence),
      vatPence: Number(prior.vat_pence),
      grossPence: Number(prior.gross_pence),
      succeeded: true,
      failureCode: null,
      squarePaymentId: prior.square_payment_id ?? null,
      receiptUrl: prior.receipt_url ?? null,
    };
  }

  // An unsettled intent for this cycle.
  const pendingRes = await admin
    .from("platform_charges")
    .select(INTENT_SELECT)
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("status", "pending")
    .order("attempt", { ascending: false })
    .limit(1);
  if (pendingRes.error && !intentUnsupported(pendingRes.error)) {
    throw new Error(`Unable to check for a pending charge: ${pendingRes.error.message}`);
  }
  const intentsSupported = !pendingRes.error;
  const pending = (pendingRes.data?.[0] as IntentRow | undefined) ?? null;

  if (pending && Number(pending.attempt) !== args.attempt) {
    // A different attempt of this cycle has an unknown outcome. Charging
    // another attempt now is a second key against a card that may already
    // have paid, so refuse until it is reconciled.
    throw new Error(
      `PAYMENT_INDETERMINATE: attempt ${pending.attempt} for company ${args.companyId} cycle ${args.cycleDate} is still pending; it must be reconciled before attempt ${args.attempt} is charged`
    );
  }

  let body: CycleBody | null = pending ? bodyFromIntent(pending, args) : null;
  let intentRecorded = Boolean(pending);

  if (!body) {
    let recorded: IntentRow | null = null;
    if (intentsSupported && args.attempt > 1) {
      const failedRes = await admin
        .from("platform_charges")
        .select(INTENT_SELECT)
        .eq("company_id", args.companyId)
        .eq("cycle_date", args.cycleDate)
        .eq("status", "failed")
        .not("vehicle_ids", "is", null)
        .order("attempt", { ascending: false })
        .limit(1);
      if (failedRes.error) {
        throw new Error(`Unable to read the recorded cycle: ${failedRes.error.message}`);
      }
      recorded = (failedRes.data?.[0] as IntentRow | undefined) ?? null;
    }

    if (recorded) {
      body = {
        ...bodyFromIntent(recorded, args),
        attempt: args.attempt,
        squareCardId: args.squareCardId,
        squareCustomerId: args.squareCustomerId,
        createdAt: null,
      };
    } else {
      const vehicleIds = [...(await fetchBillableVehicles(admin, args.companyId))];
      const amounts = computeChargeAmounts(vehicleIds.length);
      body = {
        attempt: args.attempt,
        vehicleIds,
        vehicleCount: vehicleIds.length,
        netPence: amounts.netPence,
        vatPence: amounts.vatPence,
        grossPence: amounts.grossPence,
        squareCardId: args.squareCardId,
        squareCustomerId: args.squareCustomerId,
        createdAt: null,
      };
    }
  }

  let succeeded = true;
  let failureCode: string | null = null;
  let squarePaymentId: string | null = null;
  let receiptUrl: string | null = null;

  if (body.grossPence > 0) {
    // Resolved BEFORE the intent is written and before the try. Both throw
    // when an env var is missing, which is a configuration outage with no
    // request sent; a pending row written first would read as "the money may
    // have moved" for a call that never left the process.
    const square = getSquare();
    const locationId = getSquareLocationId();

    if (!intentRecorded && intentsSupported) {
      const inserted = await admin.from("platform_charges").insert({
        company_id: args.companyId,
        cycle_date: args.cycleDate,
        attempt: body.attempt,
        vehicle_count: body.vehicleCount,
        net_pence: body.netPence,
        vat_pence: body.vatPence,
        gross_pence: body.grossPence,
        vat_rate: VAT_RATE,
        currency: "GBP",
        status: "pending",
        square_card_id: body.squareCardId,
        square_customer_id: body.squareCustomerId,
        vehicle_ids: body.vehicleIds,
      });

      if (!inserted.error) {
        intentRecorded = true;
      } else if (inserted.error.code === "23505") {
        // Something already holds this attempt number. A pending row is
        // another caller's intent: replay it. A settled one is an attempt whose
        // company_billing outcome was never applied: replay the same key and
        // body without an intent, which is how this worked before and lets
        // Square hand back the original answer.
        const raced = await admin
          .from("platform_charges")
          .select(INTENT_SELECT)
          .eq("company_id", args.companyId)
          .eq("cycle_date", args.cycleDate)
          .eq("attempt", body.attempt)
          .maybeSingle();
        if (raced.error) throw new Error(raced.error.message);
        if ((raced.data as IntentRow | null)?.status === "pending") {
          body = bodyFromIntent(raced.data as IntentRow, args);
          intentRecorded = true;
        }
      } else if (
        inserted.error.code === "23514" ||
        intentUnsupported(inserted.error)
      ) {
        console.warn(
          "[billing] platform_charges cannot hold a pending intent yet; apply docs/sql/prodfix_33_billing_integrity.sql. Recording after Square answers instead."
        );
      } else {
        throw new Error(`Unable to record charge intent: ${inserted.error.message}`);
      }
    }

    const idempotencyKey = chargeIdempotencyKey(
      args.companyId,
      args.cycleDate,
      body.attempt
    );
    const referenceId = paymentReferenceId(idempotencyKey);
    let payment: { id?: string; receiptUrl?: string; status?: string } | undefined;
    let callThrew = false;

    try {
      const response = await square.payments.create({
        idempotencyKey,
        sourceId: body.squareCardId,
        customerId: body.squareCustomerId,
        locationId,
        amountMoney: {
          amount: BigInt(body.grossPence),
          currency: "GBP",
        },
        referenceId,
        note: `TMS Wizzard subscription ${args.cycleDate}: ${body.vehicleCount} vehicles`,
      });
      payment = response.payment;
    } catch (error) {
      if (
        error instanceof SquareError &&
        error.errors[0]?.code === "IDEMPOTENCY_KEY_REUSED"
      ) {
        // A payment already exists under this key with a body that no longer
        // matches. Ask Square what it was rather than guess.
        const found = await reconcilePaymentByReference(square, {
          locationId,
          referenceId,
          amountPence: body.grossPence,
          sinceISO: body.createdAt,
        });
        if (found.kind === "succeeded") {
          payment = { id: found.paymentId, receiptUrl: found.receiptUrl ?? undefined, status: "COMPLETED" };
        } else if (found.kind === "failed") {
          payment = { status: found.failureCode };
        } else {
          throw new Error(
            `PAYMENT_INDETERMINATE: idempotency key already used for company ${args.companyId} cycle ${args.cycleDate} attempt ${body.attempt} and Square could not confirm the outcome (${found.reason}); MANUAL REVIEW: reconcile reference ${referenceId} before retrying`
          );
        }
      } else {
        // Only a throw that PROVES Square refused the payment may be recorded
        // as a decline. See classifySquareThrow.
        const thrown = classifySquareThrow(error);
        if (thrown.kind === "indeterminate") {
          throw new Error(
            `PAYMENT_INDETERMINATE: no usable answer from Square for company ${args.companyId} cycle ${args.cycleDate} attempt ${body.attempt}: ${thrown.reason}; the next run replays the same idempotency key`
          );
        }

        callThrew = true;
        succeeded = false;
        failureCode = thrown.failureCode;
      }
    }

    // Classification happens outside the try/catch: the try/catch only
    // captures network/SDK-level failures. A successful call that returned a
    // non-terminal payment status must throw here, before anything is settled.
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
            "; nothing settled, next run re-checks with the same idempotency key"
        );
      }

      succeeded = classification.kind === "succeeded";
      failureCode =
        classification.kind === "failed" ? classification.failureCode : null;
    }
  }

  // Record (or, with an intent, SETTLE) the audit row and the coverage it
  // bought in ONE call (billing_04, amended by prodfix_33). Both writes run in
  // the single transaction PostgREST wraps around the rpc. Coverage is the
  // snapshot of vehicles this charge was priced for, not today's fleet.
  //
  // A throw here after a successful payment leaves the pending intent in place
  // (or, without prodfix_33, no row), and the next run replays the same key
  // and body, which Square answers with the original payment.
  const { error: recordError } = await admin.rpc("record_cycle_charge", {
    p_company_id: args.companyId,
    p_cycle_date: args.cycleDate,
    p_attempt: body.attempt,
    p_vehicle_count: body.vehicleCount,
    p_net_pence: body.netPence,
    p_vat_pence: body.vatPence,
    p_gross_pence: body.grossPence,
    p_vat_rate: VAT_RATE,
    p_currency: "GBP",
    p_square_payment_id: squarePaymentId,
    p_receipt_url: receiptUrl,
    p_status: succeeded ? "succeeded" : "failed",
    p_failure_code: failureCode,
    p_vehicle_ids: succeeded ? body.vehicleIds : [],
  });

  if (recordError) {
    throw new Error(
      `Charge recorded at Square but the platform_charges/coverage record failed for company ${args.companyId} cycle ${args.cycleDate}: ${recordError.message}`
    );
  }

  return {
    companyId: args.companyId,
    cycleDate: args.cycleDate,
    attempt: body.attempt,
    vehicleCount: body.vehicleCount,
    netPence: body.netPence,
    vatPence: body.vatPence,
    grossPence: body.grossPence,
    succeeded,
    failureCode,
    squarePaymentId,
    receiptUrl,
  };
}

function bodyFromIntent(
  row: IntentRow,
  args: { squareCardId: string; squareCustomerId: string }
): CycleBody {
  const vehicleIds = row.vehicle_ids ?? [];
  return {
    attempt: Number(row.attempt),
    vehicleIds,
    vehicleCount: Number(row.vehicle_count),
    netPence: Number(row.net_pence),
    vatPence: Number(row.vat_pence),
    grossPence: Number(row.gross_pence),
    squareCardId: row.square_card_id ?? args.squareCardId,
    squareCustomerId: row.square_customer_id ?? args.squareCustomerId,
    createdAt: row.created_at,
  };
}

export type V1CancellationOutcome =
  | { result: "cancelled" }
  | {
      result: "blocked";
      reason: "already_canceled" | "payment_settling" | "no_subscription";
    };

/**
 * Cancel a company still on v1. Review BILL1-14.
 *
 * Prepaid, so no invoice and no refund: the cycle in progress runs to its end.
 * Setting `canceled` is what stops the money. The cron selects only
 * non-canceled rows and selectDueAction answers none for canceled, the card
 * route's recovery answers none, and the activate route blocks additions.
 */
export async function cancelV1Company(
  admin: SupabaseClient,
  companyId: string
): Promise<V1CancellationOutcome> {
  const billingRes = await admin
    .from("company_billing")
    .select("status")
    .eq("company_id", companyId)
    .maybeSingle();
  if (billingRes.error) throw new Error(billingRes.error.message);
  if (!billingRes.data) return { result: "blocked", reason: "no_subscription" };

  const [cyclePending, addonPending] = await Promise.all([
    admin
      .from("platform_charges")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending"),
    admin
      .from("vehicle_addon_charges")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending"),
  ]);
  if (cyclePending.error) throw new Error(cyclePending.error.message);
  // 42P01: billing_03 is not applied, so there are no add-on charges at all.
  if (addonPending.error && addonPending.error.code !== "42P01") {
    throw new Error(addonPending.error.message);
  }

  const action = selectV1CancellationAction({
    status: billingRes.data.status as string,
    hasUnsettledCharge:
      (cyclePending.count ?? 0) > 0 || (addonPending.count ?? 0) > 0,
  });
  if (action.kind === "blocked") {
    return { result: "blocked", reason: action.reason };
  }

  // Conditional on not already canceled, so a concurrent cancel is harmless.
  // retry_at is cleared so nothing reads the row as mid-dunning.
  const { error } = await admin
    .from("company_billing")
    .update({
      status: "canceled",
      retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .neq("status", "canceled");
  if (error) throw new Error(error.message);

  return { result: "cancelled" };
}
