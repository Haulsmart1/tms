// The v1 (charge in advance) half of "what happens if this vehicle is
// activated", shared by the activate route (which then charges) and the
// estimate route (which only quotes). Server-only.
//
// One loader so the quote and the charge cannot disagree. Review BILL1-13: v1
// customers were charged a pro-rata amount on activation with no price shown
// first, because the estimate route had no v1 branch.

import type { SupabaseClient } from "@supabase/supabase-js";

import { currentCycleDate, selectAddonAction } from "./addon";
import type { AddonAction, AddonBillingRow } from "./addon";
import { computeAddonAmounts } from "./prorata";

export type V1AddonDecision = {
  action: AddonAction;
  billingRow: AddonBillingRow | null;
  squareCustomerId: string | null;
  squareCardId: string | null;
  /** Only meaningful for a `charge` action. */
  baselineCount: number;
};

export async function loadV1AddonDecision(
  admin: SupabaseClient,
  args: {
    companyId: string;
    vehicleId: string;
    todayISO: string;
    /** fetchBillableVehicles for the company, already loaded by the caller. */
    billableIds: ReadonlySet<string>;
  }
): Promise<V1AddonDecision> {
  // retry_at is load-bearing: a company mid-dunning has status "active" with
  // next_charge_on in the past, so without it selectAddonAction cannot tell a
  // healthy subscription from a failing card.
  const billingRes = await admin
    .from("company_billing")
    .select("status, next_charge_on, retry_at, square_customer_id, square_card_id")
    .eq("company_id", args.companyId)
    .maybeSingle();
  if (billingRes.error) throw new Error(billingRes.error.message);
  const billing = billingRes.data;

  const billingRow: AddonBillingRow | null = billing
    ? {
        status: billing.status as AddonBillingRow["status"],
        next_charge_on: billing.next_charge_on as string,
        retry_at: (billing.retry_at as string | null) ?? null,
      }
    : null;

  // The cycle already PAID FOR started CYCLE_DAYS before next_charge_on.
  let alreadyCovered = false;
  if (billingRow) {
    const coverageRes = await admin
      .from("vehicle_cycle_coverage")
      .select("vehicle_id")
      .eq("company_id", args.companyId)
      .eq("cycle_date", currentCycleDate(billingRow.next_charge_on))
      .eq("vehicle_id", args.vehicleId)
      .maybeSingle();
    if (coverageRes.error) throw new Error(coverageRes.error.message);
    alreadyCovered = Boolean(coverageRes.data);
  }

  const action = selectAddonAction({
    billingRow,
    todayISO: args.todayISO,
    alreadyCovered,
  });

  // Graduated pricing means the baseline decides which band the added vehicle
  // falls into, so it must not be gameable: whichever of the live count and
  // the paid coverage is larger.
  let baselineCount = args.billableIds.size;
  if (action.kind === "charge") {
    const coveredCountRes = await admin
      .from("vehicle_cycle_coverage")
      .select("vehicle_id", { count: "exact", head: true })
      .eq("company_id", args.companyId)
      .eq("cycle_date", action.cycleDate);
    if (coveredCountRes.error) throw new Error(coveredCountRes.error.message);
    baselineCount = Math.max(baselineCount, coveredCountRes.count ?? 0);
  }

  return {
    action,
    billingRow,
    squareCustomerId: (billing?.square_customer_id as string | null) ?? null,
    squareCardId: (billing?.square_card_id as string | null) ?? null,
    baselineCount,
  };
}

export type V1AdditionQuote =
  | { model: "v1_immediate"; kind: "free"; reason: string }
  | { model: "v1_immediate"; kind: "blocked"; reason: string }
  | {
      model: "v1_immediate";
      kind: "charge";
      days: number;
      netPence: number;
      vatPence: number;
      grossPence: number;
    };

/** The v1 quote, from exactly the inputs the activate route charges from. */
export function quoteFromV1Decision(decision: V1AddonDecision): V1AdditionQuote {
  const { action } = decision;
  if (action.kind === "free") {
    return { model: "v1_immediate", kind: "free", reason: action.reason };
  }
  if (action.kind === "blocked") {
    return { model: "v1_immediate", kind: "blocked", reason: action.reason };
  }
  const amounts = computeAddonAmounts(decision.baselineCount, action.days);
  return {
    model: "v1_immediate",
    kind: "charge",
    days: amounts.days,
    netPence: amounts.netPence,
    vatPence: amounts.vatPence,
    grossPence: amounts.grossPence,
  };
}
