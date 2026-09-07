// The only path by which a vehicle may become billable.
//
// ORDERING RULE, which is the heart of this route: charge FIRST, write the
// licence LAST. The whole scheme rests on "an active licence implies this
// vehicle has been paid for in this cycle", so a decline must leave no active
// licence behind. Failing the other way round is the safe direction: if the
// charge succeeds and the licence write then fails, the company has paid for a
// vehicle that is not active, but the coverage row is already written, so their
// retry takes the already_covered free path and they are never charged twice.
//
// A migration (docs/sql/billing_03_mid_cycle_charges.sql) revokes the browser's
// INSERT/UPDATE on vehicle_licences and adds a trigger, so this route cannot be
// bypassed from devtools.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import {
  fetchBillableVehicles,
  requireCompanyAdmin,
} from "../../../../lib/billing/server";
import {
  currentCycleDate,
  selectAddonAction,
} from "../../../../lib/billing/addon";
import type { AddonBillingRow } from "../../../../lib/billing/addon";
import { chargeVehicleAddon } from "../../../../lib/billing/addonServer";
import { londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    tenantId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    licenceType: z.string().min(1),
    issueDate: z.string().nullable(),
    expiryDate: z.string().nullable(),
    active: z.boolean(),
    notes: z.string().nullable(),
  }),
  z.object({
    action: z.literal("setActive"),
    licenceId: z.string().uuid(),
    active: z.boolean(),
  }),
]);

// Every blocked reason needs its own line here. A missing key would render
// `undefined` to a customer who has just been refused, which is the worst
// moment for a blank error.
const BLOCKED_MESSAGE: Record<
  "past_due" | "canceled" | "dunning" | "inactive_subscription",
  string
> = {
  past_due:
    "Your subscription is past due, so vehicles cannot be added. Update your payment card on the billing page and try again.",
  canceled:
    "Your subscription has been canceled, so vehicles cannot be added. Contact support to reactivate it.",
  dunning:
    "A payment on your account has failed and is being retried, so vehicles cannot be added until it clears. Update your payment card on the billing page.",
  inactive_subscription:
    "Your subscription is not active, so vehicles cannot be added. Contact support.",
};

export async function POST(request: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body." },
        { status: 400 }
      );
    }

    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const { admin, companyId } = await requireCompanyAdmin();

    // The company's tenant scope. `vehicles` is keyed by tenant_id only, with
    // no company_id column (filtering on one answers 42703 and fails the whole
    // request), and rows written before tenants existed carry the company id in
    // tenant_id directly, so companyId is part of the scope. This mirrors
    // fetchBillableVehicles deliberately: if the two disagreed, a vehicle could
    // be activated here that the cron never counts, which is a free vehicle.
    const tenantsRes = await admin
      .from("tenants")
      .select("id")
      .eq("company_id", companyId);
    if (tenantsRes.error) {
      throw new Error(tenantsRes.error.message);
    }
    const scopeIds = [
      ...(tenantsRes.data ?? []).map((t) => t.id as string),
      companyId,
    ];

    // requireCompanyAdmin proves who the caller is; it says nothing about the
    // vehicle. Without the ownership checks below, an admin of company A could
    // activate a licence on company B's vehicle: A's card would be charged for
    // it, and B would silently gain a billable vehicle.
    let vehicleId: string;
    if (body.action === "create") {
      if (!scopeIds.includes(body.tenantId)) {
        return NextResponse.json(
          { error: "That tenant does not belong to your company." },
          { status: 403 }
        );
      }
      vehicleId = body.vehicleId;
    } else {
      const licenceRes = await admin
        .from("vehicle_licences")
        .select("id, vehicle_id")
        .eq("id", body.licenceId)
        .maybeSingle();
      if (licenceRes.error) {
        throw new Error(licenceRes.error.message);
      }
      if (!licenceRes.data) {
        return NextResponse.json(
          { error: "Licence not found." },
          { status: 404 }
        );
      }
      // The licence's own tenant_id is not taken as the ownership proof. The
      // vehicle is what gets billed, so the vehicle is what must be checked,
      // and the vehicle check below is the same one the create path gets.
      vehicleId = licenceRes.data.vehicle_id as string;
    }

    const vehicleRes = await admin
      .from("vehicles")
      .select("id, tenant_id")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vehicleRes.error) {
      throw new Error(vehicleRes.error.message);
    }
    if (
      !vehicleRes.data ||
      !scopeIds.includes(vehicleRes.data.tenant_id as string)
    ) {
      return NextResponse.json(
        { error: "That vehicle does not belong to your company." },
        { status: 403 }
      );
    }

    // The single place in this file where a licence can become active. Called
    // only once every money question has been settled.
    async function writeLicence() {
      if (body.action === "create") {
        const { error } = await admin.from("vehicle_licences").insert({
          tenant_id: body.tenantId,
          vehicle_id: body.vehicleId,
          licence_type: body.licenceType,
          issue_date: body.issueDate,
          expiry_date: body.expiryDate,
          active: body.active,
          notes: body.notes,
        });
        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await admin
          .from("vehicle_licences")
          .update({ active: body.active })
          .eq("id", body.licenceId);
        if (error) {
          throw new Error(error.message);
        }
      }
    }

    // Deactivations and inactive drafts cannot make a vehicle billable, so
    // there is nothing to charge. Removals get no refund and no credit: the
    // cycle is already paid for, and the coverage row stays behind, so putting
    // the vehicle back before the next charge is free.
    if (!body.active) {
      await writeLicence();
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "not_active",
      });
    }

    // Already billable means the vehicle carries another active licence and has
    // therefore already been paid for. A second licence on one vehicle must
    // never be charged for: the fleet is billed per vehicle, not per licence.
    const billableIds = await fetchBillableVehicles(admin, companyId);
    if (billableIds.has(vehicleId)) {
      await writeLicence();
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "already_billable",
      });
    }

    // retry_at is load-bearing, not decoration. A company mid-dunning has
    // status "active" with next_charge_on in the past, so without it
    // selectAddonAction cannot tell a healthy subscription from a failing card
    // and would hand out free vehicles for the whole dunning window. Omitting
    // the column yields undefined, which fails closed to blocked for every
    // company: safe, but a total outage of vehicle addition.
    const billingRes = await admin
      .from("company_billing")
      .select(
        "status, next_charge_on, retry_at, square_customer_id, square_card_id"
      )
      .eq("company_id", companyId)
      .maybeSingle();
    if (billingRes.error) {
      throw new Error(billingRes.error.message);
    }
    const billing = billingRes.data;

    const billingRow: AddonBillingRow | null = billing
      ? {
          status: billing.status as AddonBillingRow["status"],
          next_charge_on: billing.next_charge_on as string,
          retry_at: (billing.retry_at as string | null) ?? null,
        }
      : null;

    // The cycle already PAID FOR started CYCLE_DAYS before next_charge_on.
    // Derive it from next_charge_on and never by subtracting from today, so
    // that this lookup and the coverage write inside chargeVehicleAddon always
    // name the same cycle.
    let alreadyCovered = false;
    if (billingRow) {
      const cycleDate = currentCycleDate(billingRow.next_charge_on);
      const coverageRes = await admin
        .from("vehicle_cycle_coverage")
        .select("vehicle_id")
        .eq("company_id", companyId)
        .eq("cycle_date", cycleDate)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (coverageRes.error) {
        throw new Error(coverageRes.error.message);
      }
      alreadyCovered = Boolean(coverageRes.data);
    }

    const action = selectAddonAction({
      billingRow,
      todayISO: londonDateISO(new Date()),
      alreadyCovered,
    });

    if (action.kind === "blocked") {
      return NextResponse.json(
        { error: BLOCKED_MESSAGE[action.reason], reason: action.reason },
        { status: 402 }
      );
    }

    if (action.kind === "free") {
      await writeLicence();
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: action.reason,
      });
    }

    // A charge needs a card. Reaching here without one means company_billing
    // says "active" while holding no Square ids, which is a broken subscription
    // rather than a licence to add vehicles for nothing.
    const squareCustomerId = billing?.square_customer_id as string | null;
    const squareCardId = billing?.square_card_id as string | null;
    if (!squareCustomerId || !squareCardId) {
      return NextResponse.json(
        {
          error:
            "No payment card is on file, so vehicles cannot be added. Add a card on the billing page and try again.",
          reason: "no_card",
        },
        { status: 402 }
      );
    }

    // Graduated pricing means the baseline decides which band the added vehicle
    // falls into, so the baseline must not be gameable. The live count alone
    // would let a company deactivate vehicles to drop into a cheaper band
    // before adding one, a quieter version of the very exploit this feature
    // closes. Coverage alone would misprice a company that has grown since its
    // last cycle charge. Whichever is larger is the honest floor.
    const coveredCountRes = await admin
      .from("vehicle_cycle_coverage")
      .select("vehicle_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("cycle_date", action.cycleDate);
    if (coveredCountRes.error) {
      throw new Error(coveredCountRes.error.message);
    }
    const baselineCount = Math.max(billableIds.size, coveredCountRes.count ?? 0);

    let result;
    try {
      result = await chargeVehicleAddon(admin, {
        companyId,
        vehicleId,
        cycleDate: action.cycleDate,
        days: action.days,
        baselineCount,
        squareCustomerId,
        squareCardId,
      });
    } catch (chargeError) {
      if (
        chargeError instanceof Error &&
        chargeError.message.startsWith("PAYMENT_INDETERMINATE")
      ) {
        return NextResponse.json(
          {
            error:
              "A previous payment attempt is still settling with Square. The vehicle was not added. Please wait a few minutes and try again.",
          },
          { status: 409 }
        );
      }
      // Any other throw means the payment outcome is unknown, or the charge
      // landed but coverage could not be recorded. Activating the licence in
      // either state would break the invariant this route exists to hold, so
      // the error goes out to the catch below and the licence is left alone.
      throw chargeError;
    }

    if (!result.succeeded) {
      return NextResponse.json(
        {
          error:
            "Your card was declined, so the vehicle was not added. Update your payment card on the billing page and try again.",
          failureCode: result.failureCode,
        },
        { status: 402 }
      );
    }

    // Money is confirmed and coverage is recorded. Only now does the licence
    // become active.
    await writeLicence();

    return NextResponse.json({
      ok: true,
      charged: true,
      cycleDate: result.cycleDate,
      days: result.days,
      grossPence: result.grossPence,
      receiptUrl: result.receiptUrl,
      alreadyPaid: result.alreadyPaid,
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
