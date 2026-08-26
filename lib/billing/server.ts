// Server-only billing orchestration. Auth, DB reads/writes (service role) and
// Square calls live here; all decisions are delegated to the pure modules.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SquareError } from "square";
import { createAdminClient, createUserClient } from "../accounts/server";
import { extractRoleName } from "../roles";
import { getSquare, getSquareLocationId } from "../payments/square";
import { chargeIdempotencyKey, computeChargeAmounts } from "./money";
import { countBillableVehicles } from "./vehicleCount";

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
    .select("company_id, role_id, roles(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const role = extractRoleName(profile?.roles);

  if (!profile?.company_id || (role !== "admin" && role !== "super_admin")) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user, companyId: profile.company_id as string, role };
}

export async function fetchBillableVehicleCount(
  admin: SupabaseClient,
  companyId: string
): Promise<number> {
  const [tenantsRes, vehiclesRes, licencesRes] = await Promise.all([
    admin.from("tenants").select("id").eq("company_id", companyId),
    admin.from("vehicles").select("id, tenant_id, company_id"),
    admin.from("vehicle_licences").select("vehicle_id, active").eq("active", true),
  ]);

  const firstError =
    tenantsRes.error ?? vehiclesRes.error ?? licencesRes.error;
  if (firstError) {
    throw new Error(`Unable to load billing data: ${firstError.message}`);
  }

  return countBillableVehicles({
    companyId,
    companyTenantIds: (tenantsRes.data ?? []).map((t) => t.id as string),
    vehicles: vehiclesRes.data ?? [],
    licences: licencesRes.data ?? [],
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
  const vehicleCount = await fetchBillableVehicleCount(admin, args.companyId);
  const amounts = computeChargeAmounts(vehicleCount);

  let succeeded = true;
  let failureCode: string | null = null;
  let squarePaymentId: string | null = null;
  let receiptUrl: string | null = null;

  if (amounts.grossPence > 0) {
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

      const payment = response.payment;
      squarePaymentId = payment?.id ?? null;
      receiptUrl = payment?.receiptUrl ?? null;
      succeeded = payment?.status === "COMPLETED";
      if (!succeeded) {
        failureCode = payment?.status ?? "NO_PAYMENT_RETURNED";
      }
    } catch (error) {
      succeeded = false;
      failureCode = extractSquareFailureCode(error);
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

  if (insertError) {
    // The payment (if any) went through; surface the bookkeeping failure
    // loudly rather than pretending the cycle did not happen.
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
