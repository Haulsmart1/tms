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
import {
  computeGraceUntil,
  fetchCompanyVehicleIds,
  isPeriodBillingCompany,
  openPeriodAndChargeMinimum,
  resolveActivation,
} from "../../../../lib/billing/periodServer";
import { createSquarePeriodPaymentProvider } from "../../../../lib/billing/periodPaymentServer";
import { selectLicenceDeleteAction } from "../../../../lib/billing/licenceDelete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dates are plain calendar days, matching every other billing date in this
// codebase. Validated here so "banana" gives a clean 400 rather than reaching
// Postgres and coming back as a raw 22007 at 500.
const DateISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.")
  .nullable();

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    tenantId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    licenceType: z.string().min(1),
    issueDate: DateISO,
    expiryDate: DateISO,
    active: z.boolean(),
    notes: z.string().nullable(),
  }),
  z.object({
    action: z.literal("setActive"),
    licenceId: z.string().uuid(),
    active: z.boolean(),
  }),
  z.object({
    action: z.literal("delete"),
    licenceId: z.string().uuid(),
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

// Every v2 blocked reason needs its own line, same discipline as
// BLOCKED_MESSAGE above: a missing key renders `undefined` to a customer who
// has just been refused.
const PERIOD_BLOCKED_MESSAGE: Record<
  "past_due" | "canceled" | "inactive_subscription" | "no_payment_method" | "payment_settling",
  string
> = {
  past_due:
    "Your subscription is past due, so vehicles cannot be added. Update your payment card on the billing page and try again.",
  canceled:
    "Your subscription has been canceled, so vehicles cannot be added. Contact support to reactivate it.",
  inactive_subscription:
    "Your subscription is not active, so vehicles cannot be added. Contact support.",
  no_payment_method:
    "Add a payment card on the billing page before adding your first vehicle.",
  payment_settling:
    "A payment on your account is still settling, so vehicles cannot be added yet. Try again shortly, and contact support if this persists.",
};

const PAYMENT_SETTLING_MESSAGE =
  "A payment on your account is still settling, so the vehicle was not added. Try again shortly, and contact support if this persists.";

// upper(replace(registration, ' ', '')), with the vehicle id as the fallback
// for a vehicle with no plate recorded. Mirrors the backfill and the trigger
// in docs/sql/billing_07_licence_lifecycle.sql; if the three ever disagree,
// grace stops matching its own history.
function normaliseVrn(
  registration: string | null,
  vehicleId: string
): string {
  const normalised = (registration ?? "").toUpperCase().replace(/ /g, "");
  return normalised.length > 0 ? normalised : vehicleId;
}

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
        .select("id, vehicle_id, tenant_id")
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
      // Both halves are checked, mirroring create. The vehicle is what gets
      // billed, so the vehicle check below is the one that guards the money;
      // the licence's own tenant is checked too so a row whose two halves
      // disagree cannot be toggled from either side.
      if (!scopeIds.includes(licenceRes.data.tenant_id as string)) {
        return NextResponse.json(
          { error: "That licence does not belong to your company." },
          { status: 403 }
        );
      }
      vehicleId = licenceRes.data.vehicle_id as string;
    }

    const vehicleRes = await admin
      .from("vehicles")
      .select("id, tenant_id, registration")
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

    // Both halves in scope is not enough on create: the licence's tenant must
    // be the vehicle's own tenant. Otherwise an admin can file a licence under
    // tenant A for a vehicle owned by tenant B in the same company, and the
    // licences page (which lists by tenant) never shows it to the tenant whose
    // vehicle it certifies. The old browser path could not produce that shape,
    // and this route is about to be the only writer, so it should not start
    // accepting it. Legacy rows carrying the company id in tenant_id satisfy
    // this naturally, since both sides then hold the company id.
    if (
      body.action === "create" &&
      body.tenantId !== (vehicleRes.data.tenant_id as string)
    ) {
      return NextResponse.json(
        { error: "That vehicle belongs to a different tenant." },
        { status: 403 }
      );
    }

    // DELETE is only available for a licence that was NEVER activated.
    //
    // billing_03 kept the browser's delete grant on the reasoning that removing
    // a licence can only reduce a bill under prepayment. Under arrears that
    // inverts: the invoice is computed at close from these rows, so deleting
    // one that was ever live destroys the evidence and a vehicle silently
    // vanishes from an invoice it belonged on. billing_07 STEP 2 revokes the
    // grant for that reason, and this is the replacement.
    //
    // Not a blanket ban, because the case that actually happens is a typo. A
    // licence created inactive has bought nothing and can go. One that was ever
    // active is deactivated instead and stays as a record, which is also the
    // right answer for a compliance document.
    //
    // The test is deactivated_at = activated_at exactly, which is the shape the
    // sync trigger and the billing_07 backfill both produce for a row that was
    // never live. Anything that ran for even a second has deactivated_at
    // strictly greater.
    if (body.action === "delete") {
      const isPeriodBilling = await isPeriodBillingCompany(admin, companyId);

      const licence = await admin
        .from("vehicle_licences")
        .select("id, active, activated_at, deactivated_at")
        .eq("id", body.licenceId)
        .single();

      // 42703 means billing_07 STEP 1 has not been applied, so the lifecycle
      // columns do not exist yet. No company can be on v2 in that world
      // either, so the v1 rule applies and the delete stands.
      if (licence.error && licence.error.code !== "42703") {
        throw new Error(licence.error.message);
      }

      const decision = licence.error
        ? ({ kind: "delete" } as const)
        : selectLicenceDeleteAction({
            isPeriodBilling,
            active: licence.data.active as boolean | null,
            activatedAtISO: licence.data.activated_at as string | null,
            deactivatedAtISO: licence.data.deactivated_at as string | null,
          });

      if (decision.kind === "blocked") {
        return NextResponse.json(
          {
            error:
              "This licence has been active, so it is part of the current period's invoice and cannot be deleted. Deactivate it instead: it stays on this invoice and will not renew.",
          },
          { status: 409 }
        );
      }

      const removed = await admin
        .from("vehicle_licences")
        .delete()
        .eq("id", body.licenceId);
      if (removed.error) throw new Error(removed.error.message);

      return NextResponse.json({ ok: true, charged: false, reason: "deleted" });
    }

    // `delete` has returned by here, so what remains is the write path.
    // Narrowed into its own const because TypeScript does not carry
    // control-flow narrowing into the closures declared below: `writeLicence`
    // could in principle be called later, so inside it `body` is still the
    // full union and `body.active` does not exist on the delete member.
    const writeBody: Exclude<typeof body, { action: "delete" }> = body;

    // The single place in this file where a licence can become active. Called
    // only once every money question has been settled.
    // Under v2, reactivating an existing licence must create a NEW row rather
    // than clear deactivated_at on the old one.
    //
    // In-place reactivation destroys the history the invoice is computed from.
    // A licence active in January, off in February and back in March would end
    // up as one row reading "activated 1 Jan, still active", which overlaps
    // February and bills the customer for a month they ran nothing. The brief's
    // "one row per activation" is not a stylistic preference; it is what makes
    // a gap in service representable at all.
    //
    // v1 companies keep the in-place toggle: they bill from `active`, never
    // from the lifecycle columns, so a row with no history costs them nothing.
    async function writeLicenceAsNewActivation(
      licenceId: string,
      graceUntil: string | null
    ) {
      const source = await admin
        .from("vehicle_licences")
        .select("tenant_id, vehicle_id, licence_type, issue_date, expiry_date, notes")
        .eq("id", licenceId)
        .single();
      if (source.error) throw new Error(source.error.message);

      const inserted = await admin
        .from("vehicle_licences")
        .insert({
          tenant_id: source.data.tenant_id,
          vehicle_id: source.data.vehicle_id,
          licence_type: source.data.licence_type,
          issue_date: source.data.issue_date,
          expiry_date: source.data.expiry_date,
          notes: source.data.notes,
          active: true,
          grace_until: graceUntil,
        })
        .select("id")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);

      // Point the old row at its successor. Without this it stays in the list
      // looking like a duplicate AND still toggleable, so toggling it again
      // inserted a third row, and so on without bound. The row itself is kept:
      // it is the record of what was billable when.
      const superseded = await admin
        .from("vehicle_licences")
        .update({ superseded_by: inserted.data.id })
        .eq("id", licenceId);
      if (superseded.error) throw new Error(superseded.error.message);
    }

    async function writeLicence(graceUntil: string | null = null) {
      if (writeBody.action === "create") {
        const { error } = await admin.from("vehicle_licences").insert({
          tenant_id: writeBody.tenantId,
          vehicle_id: writeBody.vehicleId,
          licence_type: writeBody.licenceType,
          issue_date: writeBody.issueDate,
          expiry_date: writeBody.expiryDate,
          active: writeBody.active,
          notes: writeBody.notes,
          // Rule 7. Null for every v1 company and for any vehicle whose
          // registration has been licensed here before, which is what stops
          // grace being recycled by deleting and re-adding a vehicle.
          grace_until: graceUntil,
        });
        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await admin
          .from("vehicle_licences")
          .update({ active: writeBody.active })
          .eq("id", writeBody.licenceId);
        if (error) {
          throw new Error(error.message);
        }
      }
    }

    // A v2 write is a create (insert, as usual) or a reactivation (insert a
    // fresh row, see above). Reaching here with active false is impossible:
    // the deactivation branch below returns before the v2 block runs.
    async function writeV2Licence(graceUntil: string | null) {
      if (writeBody.action === "create") {
        await writeLicence(graceUntil);
        return;
      }
      await writeLicenceAsNewActivation(writeBody.licenceId, graceUntil);
    }

    // Deactivations and inactive drafts cannot make a vehicle billable, so
    // there is nothing to charge. Removals get no refund and no credit: the
    // cycle is already paid for, and the coverage row stays behind, so putting
    // the vehicle back before the next charge is free.
    if (!writeBody.active) {
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
    // ---------------------------------------------------------------------
    // v2: period billing.
    // ---------------------------------------------------------------------
    //
    // resolveActivation returns `legacy` for any company that is not on
    // v2_period, so everything below is untouched for them.
    const todayISO = londonDateISO(new Date());
    const activation = await resolveActivation(admin, companyId, todayISO);
    const isPeriodBilling = activation.action.kind !== "legacy";

    // Already billable means the vehicle carries another active licence and is
    // therefore already paid for. A second licence on one vehicle is never
    // charged: the fleet is billed per vehicle, not per licence.
    //
    // This deliberately bypasses the suspension gates. A vehicle that is
    // already paid for can always take another compliance document (an ADR
    // certificate alongside its O-licence), and refusing that would block a
    // change that costs nothing.
    //
    // It must still use the v2 WRITER. Using the v1 in-place toggle here let
    // the sync trigger rewrite activated_at and clear deactivated_at on a
    // closed row, which is exactly the history rewrite
    // writeLicenceAsNewActivation exists to prevent, and it applied to the one
    // path that skipped it. Grace is null rather than computed: a billable
    // vehicle has a prior licence by definition, so rule 7 would return null
    // anyway.
    const billableIds = await fetchBillableVehicles(admin, companyId);
    if (billableIds.has(vehicleId)) {
      if (isPeriodBilling) {
        await writeV2Licence(null);
      } else {
        await writeLicence();
      }
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "already_billable",
      });
    }

    if (activation.action.kind === "blocked") {
      return NextResponse.json(
        { error: PERIOD_BLOCKED_MESSAGE[activation.action.reason] },
        { status: 402 }
      );
    }

    // RULE 10. Inside a running period a vehicle addition moves no money at
    // all: no Square call, no coverage row, no pro-rata arithmetic. It is an
    // insert, and the vehicle is billed when the period closes.
    if (activation.action.kind === "join_open_period") {
      const settings = activation.settings!;
      const vehicleIds = await fetchCompanyVehicleIds(admin, companyId);
      const graceUntil = await computeGraceUntil(admin, {
        companyId,
        vehicleIds,
        vrnNormalised: normaliseVrn(
          vehicleRes.data.registration as string | null,
          vehicleId
        ),
        graceDays: settings.grace_days,
        nowISO: new Date().toISOString(),
      });

      await writeV2Licence(graceUntil);
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "period_billing",
        periodId: activation.action.periodId,
      });
    }

    if (activation.action.kind === "open_period_and_charge") {
      const settings = activation.settings!;

      // Same ordering rule as the v1 path below, for the same reason: take the
      // money FIRST, write the licence LAST, so a decline can never leave a
      // billable vehicle behind.
      const charged = await openPeriodAndChargeMinimum(
        admin,
        createSquarePeriodPaymentProvider(admin),
        {
          companyId,
          periodStartISO: activation.action.periodStartISO,
          settings,
          minimumPence: activation.action.amountPence,
        }
      );

      if (!charged.ok) {
        return NextResponse.json(
          {
            error:
              charged.failureCode === "PAYMENT_SETTLING"
                ? PAYMENT_SETTLING_MESSAGE
                : "Your card was declined, so the vehicle was not added. Update your payment card on the billing page and try again.",
            failureCode: charged.failureCode,
          },
          { status: 402 }
        );
      }

      const vehicleIds = await fetchCompanyVehicleIds(admin, companyId);
      const graceUntil = await computeGraceUntil(admin, {
        companyId,
        vehicleIds,
        vrnNormalised: normaliseVrn(
          vehicleRes.data.registration as string | null,
          vehicleId
        ),
        graceDays: settings.grace_days,
        nowISO: new Date().toISOString(),
      });

      await writeV2Licence(graceUntil);
      return NextResponse.json({
        ok: true,
        // False when a concurrent activation had already collected the
        // minimum for this period.
        charged: charged.charged,
        reason: "period_opened",
        periodId: charged.periodId,
        // Net and gross both, and named honestly. This previously reported
        // amountPence (the NET minimum) under the name grossPence, so any
        // caller rendering it told the customer GBP 129.00 when GBP 154.80 had
        // left their account.
        netPence: activation.action.amountPence,
        grossPence: charged.charged
          ? activation.action.amountPence +
            Math.floor((activation.action.amountPence * 20 + 50) / 100)
          : 0,
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
    //
    // This is the one state the header designs for, so it gets its own answer
    // rather than a raw Postgres message at 500. The customer has paid and has
    // no vehicle; the coverage row is already written, so a retry takes the
    // already_covered free path and cannot charge them a second time. It will
    // not repair itself, so the message asks them to try again.
    try {
      await writeLicence();
    } catch (writeError) {
      console.error(
        "Licence activation charged but not written",
        JSON.stringify({
          companyId,
          vehicleId,
          cycleDate: result.cycleDate,
          squarePaymentId: result.squarePaymentId,
          message:
            writeError instanceof Error ? writeError.message : String(writeError),
        })
      );
      return NextResponse.json(
        {
          error:
            "Your payment succeeded but the vehicle could not be activated. Please try again; you will not be charged a second time. Contact support if it keeps failing.",
          charged: true,
          grossPence: result.grossPence,
          receiptUrl: result.receiptUrl,
        },
        { status: 500 }
      );
    }

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
    const mapped = errorResponse(error);
    // errorResponse passes anything that is not UNAUTHENTICATED/FORBIDDEN
    // through verbatim, and the throws reachable from here name internals:
    // fetchBillableVehicles reports the company id and the 1000-row cap,
    // chargeVehicleAddon names tables. Log the detail, hand back a generic
    // message.
    if (mapped.status === 500) {
      console.error(
        "Licence activation failed",
        error instanceof Error ? error.stack ?? error.message : String(error)
      );
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
