// Server-only billing orchestration. Auth, DB reads/writes (service role) and
// Square calls live here; all decisions are delegated to the pure modules.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SquareError } from "square";
import { createAdminClient, createUserClient } from "../accounts/server";
import { ACCOUNTS_ADMIN_ROLES, isRoleAuthorized } from "../accounts/authz";
import { extractRoleName } from "../roles";
import { getSquare, getSquareLocationId } from "../payments/square";
import {
  chargeIdempotencyKey,
  classifyPaymentResult,
  computeChargeAmounts,
} from "./money";
import { billableVehicleIds } from "./vehicleCount";

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

function extractSquareFailureCode(error: unknown): string {
  // v45 throws SquareError with a typed errors array; fall back to the
  // message for anything else (network errors, etc).
  if (error instanceof SquareError) {
    return error.errors[0]?.code ?? error.message.slice(0, 120);
  }
  const maybe = error as { message?: string };
  return maybe?.message ? maybe.message.slice(0, 120) : "UNKNOWN";
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

// Runs one charge attempt end to end: count vehicles, take payment (skipped
// for zero vehicles), append the platform_charges audit row. Does NOT touch
// company_billing; callers persist applyChargeOutcome themselves, because the
// first-ever charge creates the row while cron charges update it.
//
// If Square returns a non-terminal status (PENDING/APPROVED), this throws
// PAYMENT_INDETERMINATE before writing the audit row: recording it as either
// succeeded or failed would be wrong (succeeded is a lie; failed schedules a
// retry under a NEW idempotency key, and if the pending payment later
// completes the customer is charged twice). The next run replays the SAME
// (company, cycle, attempt) idempotency key and observes the payment's
// eventual terminal state.
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

  const vehicleIds = await fetchBillableVehicles(admin, args.companyId);
  const vehicleCount = vehicleIds.size;
  const amounts = computeChargeAmounts(vehicleCount);

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
        idempotencyKey: chargeIdempotencyKey(
          args.companyId,
          args.cycleDate,
          args.attempt
        ),
        sourceId: args.squareCardId,
        customerId: args.squareCustomerId,
        locationId: getSquareLocationId(),
        amountMoney: {
          amount: BigInt(amounts.grossPence),
          currency: "GBP",
        },
        note: `TMS Wizzard subscription ${args.cycleDate}: ${vehicleCount} vehicles`,
      });
      payment = response.payment;
    } catch (error) {
      if (
        error instanceof SquareError &&
        error.errors[0]?.code === "IDEMPOTENCY_KEY_REUSED"
      ) {
        // A payment already exists under this (company, cycle, attempt) key
        // with a body that no longer matches (e.g. a replacement card), so
        // Square refused to replay it. The prior payment's outcome is unknown
        // to this caller: recording a failure here would misclassify a
        // possible success, and recording a success would be a guess.
        throw new Error(
          `PAYMENT_INDETERMINATE: idempotency key already used for company ${args.companyId} cycle ${args.cycleDate} attempt ${args.attempt}; a payment exists with unknown outcome, re-run later`
        );
      }
      callThrew = true;
      succeeded = false;
      failureCode = extractSquareFailureCode(error);
    }

    // Classification happens outside the try/catch: the try/catch only
    // captures network/SDK-level failures. A successful call that returned a
    // non-terminal payment status must throw here, BEFORE the audit insert
    // below, so nothing is recorded for this attempt.
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
            "; no outcome recorded, next run re-checks with the same idempotency key"
        );
      }

      succeeded = classification.kind === "succeeded";
      failureCode =
        classification.kind === "failed" ? classification.failureCode : null;
    }
  }

  // Record the audit row and the coverage it bought in ONE call
  // (docs/sql/billing_04_atomic_charge_record.sql). They are written by a
  // single SECURITY DEFINER function so they land together or not at all.
  //
  // Why not two statements in this file: coverage completeness is money. The
  // licence-activation route reads vehicle_cycle_coverage to decide whether a
  // mid-cycle vehicle needs a pro-rata charge, so a lost coverage row bills
  // the customer again for something this cycle already paid for. Sequencing
  // the two writes here is wrong in either order. Audit first with coverage
  // errors swallowed can lose coverage permanently, and the prior-success
  // early return above then stops any rerun from repairing it. Coverage first
  // with a throw on failure leaves the card route's first-time-setup path
  // charged with no platform_charges row and no company_billing row, which is
  // precisely the state its orphan recovery cannot detect.
  //
  // Folding coverage into the audit insert's own statement adds NO new failure
  // mode: that insert already threw on error before this change, so coverage
  // now shares a fate it could not previously escape.
  //
  // p_vehicle_ids is empty for a failed charge, and the function additionally
  // refuses to write coverage unless p_status is 'succeeded', so the rule
  // ("a failed charge covers nothing") is enforced in one place rather than
  // duplicated here. A zero-vehicle cycle passes an empty array and writes no
  // coverage rows.
  //
  // The old 23505 (unique_violation) tolerance is gone: the function's
  // `on conflict (company_id, cycle_date, attempt) do nothing` absorbs a
  // rerun of an already-recorded attempt inside the database, so there is no
  // duplicate error left for this code to classify.
  //
  // A throw here means Square has the money and the database does not. The
  // rerun path is the same as it has always been: the prior-success check
  // finds no row, this attempt number is recomputed identically, and the same
  // idempotency key goes back to Square. That replays the original payment
  // rather than taking a second one ONLY while the request body is unchanged.
  // The body carries amountMoney and a note containing the vehicle count, so
  // if the fleet changed between runs Square answers IDEMPOTENCY_KEY_REUSED
  // instead, which is handled above as PAYMENT_INDETERMINATE and needs a
  // human.
  const { error: recordError } = await admin.rpc("record_cycle_charge", {
    p_company_id: args.companyId,
    p_cycle_date: args.cycleDate,
    p_attempt: args.attempt,
    p_vehicle_count: vehicleCount,
    p_net_pence: amounts.netPence,
    p_vat_pence: amounts.vatPence,
    p_gross_pence: amounts.grossPence,
    p_vat_rate: amounts.vatRate,
    p_currency: "GBP",
    p_square_payment_id: squarePaymentId,
    p_receipt_url: receiptUrl,
    p_status: succeeded ? "succeeded" : "failed",
    p_failure_code: failureCode,
    p_vehicle_ids: succeeded ? [...vehicleIds] : [],
  });

  if (recordError) {
    throw new Error(
      `Charge recorded at Square but the platform_charges/coverage record failed for company ${args.companyId} cycle ${args.cycleDate}: ${recordError.message}`
    );
  }

  return {
    companyId: args.companyId,
    cycleDate: args.cycleDate,
    attempt: args.attempt,
    vehicleCount,
    netPence: amounts.netPence,
    vatPence: amounts.vatPence,
    grossPence: amounts.grossPence,
    succeeded,
    failureCode,
    squarePaymentId,
    receiptUrl,
  };
}
