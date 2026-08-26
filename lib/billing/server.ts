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
import { countBillableVehicles } from "./vehicleCount";

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

export async function fetchBillableVehicleCount(
  admin: SupabaseClient,
  companyId: string
): Promise<number> {
  const tenantsRes = await admin
    .from("tenants")
    .select("id")
    .eq("company_id", companyId);

  if (tenantsRes.error) {
    throw new Error(`Unable to load billing data: ${tenantsRes.error.message}`);
  }

  const tenantIds = (tenantsRes.data ?? []).map((t) => t.id as string);

  // Scope vehicles to this company's tenants (or a direct company_id match,
  // the legacy data shape countBillableVehicles also supports). companyId is
  // always in the list, so `in.(...)` is never empty even with zero tenants.
  const idList = [...tenantIds, companyId];
  const vehiclesRes = await admin
    .from("vehicles")
    .select("id, tenant_id, company_id")
    .or(`tenant_id.in.(${idList.join(",")}),company_id.eq.${companyId}`);

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
    return 0;
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

  return countBillableVehicles({
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

  const vehicleCount = await fetchBillableVehicleCount(admin, args.companyId);
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

  const { error: insertError } = await admin.from("platform_charges").insert({
    company_id: args.companyId,
    cycle_date: args.cycleDate,
    attempt: args.attempt,
    vehicle_count: vehicleCount,
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

  // 23505 = Postgres unique_violation. A rerun of the same (company, cycle,
  // attempt) after a crash reuses the same idempotency key, so Square
  // returns the SAME payment and the recomputed outcome matches the row
  // already recorded: treat the duplicate as already-recorded, not an error.
  // Any other insert error keeps the loud throw (the payment, if any, went
  // through, so pretending the cycle did not happen would be worse).
  if (insertError && insertError.code !== "23505") {
    throw new Error(
      `Charge recorded at Square but platform_charges insert failed: ${insertError.message}`
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
