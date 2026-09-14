// The only path by which a vehicle may become billable.
//
// ORDERING RULE, which is the heart of this route: charge FIRST, write the
// licence LAST. The whole scheme rests on "an active licence implies this
// vehicle has been paid for", so a decline must leave no active licence
// behind. Failing the other way round is the safe direction: if the charge
// succeeds and the licence write then fails, the charge is recorded, so the
// retry takes a free path and the customer is never charged twice.
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
import { loadV1AddonDecision } from "../../../../lib/billing/addonResolve";
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
// codebase. Validated here so "banana" gives a clean 400.
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
// `undefined` to a customer who has just been refused.
const BLOCKED_MESSAGE: Record<
  "past_due" | "canceled" | "dunning" | "inactive_subscription" | "renewal_due",
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
  renewal_due:
    "Your subscription renewal is being processed today, so vehicles cannot be added until it has gone through. Try again later today.",
};

const PERIOD_BLOCKED_MESSAGE: Record<
  | "past_due"
  | "canceled"
  | "inactive_subscription"
  | "no_payment_method"
  | "payment_settling"
  | "dunning",
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
  dunning:
    "Your last billing period's payment failed and is being retried, so vehicles cannot be added until it clears. Update your payment card on the billing page.",
};

const PAYMENT_SETTLING_MESSAGE =
  "A payment on your account is still settling, so the vehicle was not added. Try again shortly, and contact support if this persists.";

// upper(replace(registration, ' ', '')), with the vehicle id as the fallback.
// Mirrors billing_07; if the two ever disagree, grace stops matching.
function normaliseVrn(
  registration: string | null,
  vehicleId: string
): string {
  const normalised = (registration ?? "").toUpperCase().replace(/ /g, "");
  return normalised.length > 0 ? normalised : vehicleId;
}

class ConflictError extends Error {}

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

    // The company's tenant scope. `vehicles` is keyed by tenant_id only, and
    // rows written before tenants existed carry the company id in tenant_id.
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

    let vehicleId: string;
    let existingLicence: {
      active: boolean | null;
      superseded_by: string | null;
    } | null = null;

    if (body.action === "create") {
      if (!scopeIds.includes(body.tenantId)) {
        return NextResponse.json(
          { error: "That tenant does not belong to your company." },
          { status: 403 }
        );
      }
      vehicleId = body.vehicleId;
    } else {
      let licenceRes = await admin
        .from("vehicle_licences")
        .select("id, vehicle_id, tenant_id, active, superseded_by")
        .eq("id", body.licenceId)
        .maybeSingle();
      // 42703: billing_07 is not applied, so there is no superseded_by and no
      // v2 company; read without it.
      if (licenceRes.error?.code === "42703") {
        licenceRes = (await admin
          .from("vehicle_licences")
          .select("id, vehicle_id, tenant_id, active")
          .eq("id", body.licenceId)
          .maybeSingle()) as typeof licenceRes;
      }
      if (licenceRes.error) {
        throw new Error(licenceRes.error.message);
      }
      if (!licenceRes.data) {
        return NextResponse.json(
          { error: "Licence not found." },
          { status: 404 }
        );
      }
      if (!scopeIds.includes(licenceRes.data.tenant_id as string)) {
        return NextResponse.json(
          { error: "That licence does not belong to your company." },
          { status: 403 }
        );
      }
      vehicleId = licenceRes.data.vehicle_id as string;
      existingLicence = {
        active: (licenceRes.data.active as boolean | null) ?? null,
        superseded_by:
          ((licenceRes.data as { superseded_by?: string | null }).superseded_by ??
            null),
      };

      // BILL2-11. A superseded row is history. Writing to it from a stale tab
      // either did nothing while reporting success (deactivating it left its
      // successor billable) or reactivated a hidden row that then billed
      // forever.
      if (existingLicence.superseded_by) {
        return NextResponse.json(
          {
            error:
              "This licence has been replaced by a newer record. Reload the page and try again.",
          },
          { status: 409 }
        );
      }
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

    if (
      body.action === "create" &&
      body.tenantId !== (vehicleRes.data.tenant_id as string)
    ) {
      return NextResponse.json(
        { error: "That vehicle belongs to a different tenant." },
        { status: 403 }
      );
    }

    // DELETE is only available for a licence that was NEVER activated. Under
    // arrears the invoice is computed from these rows (billing_07 STEP 2).
    if (body.action === "delete") {
      const isPeriodBilling = await isPeriodBillingCompany(admin, companyId);

      const licence = await admin
        .from("vehicle_licences")
        .select("id, active, activated_at, deactivated_at")
        .eq("id", body.licenceId)
        .single();

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

    const writeBody: Exclude<typeof body, { action: "delete" }> = body;

    // BILL2-11. Activating a licence that is already active is a no-op. It
    // used to go through the v2 writer, insert a second active row and hide
    // the first, which then billed indefinitely after the visible one was
    // deactivated.
    if (
      writeBody.action === "setActive" &&
      writeBody.active &&
      existingLicence?.active === true
    ) {
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "already_active",
      });
    }

    // Under v2, reactivating an existing licence creates a NEW row rather than
    // clearing deactivated_at on the old one, so a gap in service stays
    // representable in the history the invoice is computed from.
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

      // Point the old row at its successor, ONLY if nothing else already did.
      // Two tabs reactivating the same row used to leave two active copies
      // (BILL2-11). The loser's insert is rolled back.
      const superseded = await admin
        .from("vehicle_licences")
        .update({ superseded_by: inserted.data.id })
        .eq("id", licenceId)
        .is("superseded_by", null)
        .select("id");
      if (superseded.error) throw new Error(superseded.error.message);
      if ((superseded.data ?? []).length === 0) {
        const rolledBack = await admin
          .from("vehicle_licences")
          .delete()
          .eq("id", inserted.data.id);
        if (rolledBack.error) throw new Error(rolledBack.error.message);
        throw new ConflictError(
          "This licence was just reactivated from another window. Reload the page to see it."
        );
      }
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

    async function writeV2Licence(graceUntil: string | null) {
      if (writeBody.action === "create") {
        await writeLicence(graceUntil);
        return;
      }
      await writeLicenceAsNewActivation(writeBody.licenceId, graceUntil);
    }

    async function v2GraceUntil(graceDays: number) {
      const vehicleIds = await fetchCompanyVehicleIds(admin, companyId);
      return computeGraceUntil(admin, {
        companyId,
        vehicleIds,
        vrnNormalised: normaliseVrn(
          vehicleRes.data!.registration as string | null,
          vehicleId
        ),
        graceDays,
        nowISO: new Date().toISOString(),
      });
    }

    // Deactivations and inactive drafts cannot make a vehicle billable.
    if (!writeBody.active) {
      await writeLicence();
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "not_active",
      });
    }

    // ---------------------------------------------------------------------
    // v2: period billing. resolveActivation returns `legacy` for v1.
    // ---------------------------------------------------------------------
    const todayISO = londonDateISO(new Date());
    const activation = await resolveActivation(admin, companyId, todayISO);
    const isPeriodBilling = activation.action.kind !== "legacy";

    const billableIds = await fetchBillableVehicles(admin, companyId);
    const alreadyBillable = billableIds.has(vehicleId);

    // BILL2-14: one structured line per v2 activation, so "no charge happened"
    // can always be told apart from "no charge was due".
    if (isPeriodBilling) {
      console.info(
        "[billing] v2 activation",
        JSON.stringify({
          companyId,
          vehicleId,
          action: activation.action.kind,
          reason:
            activation.action.kind === "blocked"
              ? activation.action.reason
              : undefined,
          periodId:
            activation.action.kind === "join_open_period"
              ? activation.action.periodId
              : undefined,
          alreadyBillable,
        })
      );
    }

    // Already billable means the vehicle carries another active licence and
    // is paid for. A second compliance document costs nothing, and refusing
    // it would block a change that moves no money, so this bypasses the
    // suspension gates. It still uses the v2 writer under v2.
    //
    // EXCEPT when the company has no period to bill that vehicle in (BILL1-2):
    // a fleet made billable before the first card, or by SQL, was otherwise
    // never billed, because every further licence took this free exit. Such an
    // activation goes through the opening below instead.
    if (
      alreadyBillable &&
      activation.action.kind !== "open_period_and_charge"
    ) {
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
        {
          error: PERIOD_BLOCKED_MESSAGE[activation.action.reason],
          reason: activation.action.reason,
        },
        { status: 402 }
      );
    }

    // RULE 10. Inside a running period a vehicle addition moves no money.
    if (activation.action.kind === "join_open_period") {
      const settings = activation.settings!;
      await writeV2Licence(await v2GraceUntil(settings.grace_days));
      return NextResponse.json({
        ok: true,
        charged: false,
        reason: "period_billing",
        periodId: activation.action.periodId,
      });
    }

    if (activation.action.kind === "open_period_and_charge") {
      const settings = activation.settings!;

      let charged;
      try {
        charged = await openPeriodAndChargeMinimum(
          admin,
          createSquarePeriodPaymentProvider(admin),
          {
            companyId,
            periodStartISO: activation.action.periodStartISO,
            settings,
            minimumPence: activation.action.amountPence,
          }
        );
      } catch (chargeError) {
        if (
          chargeError instanceof Error &&
          chargeError.message.startsWith("PAYMENT_INDETERMINATE")
        ) {
          console.error("Period minimum indeterminate", chargeError.message);
          return NextResponse.json(
            { error: PAYMENT_SETTLING_MESSAGE, reason: "payment_settling" },
            { status: 409 }
          );
        }
        throw chargeError;
      }

      if (!charged.ok) {
        return NextResponse.json(
          {
            error:
              charged.failureCode === "PAYMENT_SETTLING"
                ? PAYMENT_SETTLING_MESSAGE
                : charged.failureCode === "NO_PAYMENT_METHOD"
                  ? PERIOD_BLOCKED_MESSAGE.no_payment_method
                  : "Your card was declined, so the vehicle was not added. Update your payment card on the billing page and try again.",
            failureCode: charged.failureCode,
          },
          { status: 402 }
        );
      }

      await writeV2Licence(
        alreadyBillable ? null : await v2GraceUntil(settings.grace_days)
      );
      return NextResponse.json({
        ok: true,
        charged: charged.charged,
        reason: "period_opened",
        periodId: charged.periodId,
        netPence: charged.netPence,
        // From the charge itself (BILL1-15, BILL2-19), not a VAT formula
        // recomputed here. 0 when nothing left the card in this request.
        grossPence: charged.charged ? charged.grossPence : 0,
      });
    }

    // ---------------------------------------------------------------------
    // v1: charge in advance.
    // ---------------------------------------------------------------------
    const decision = await loadV1AddonDecision(admin, {
      companyId,
      vehicleId,
      todayISO,
      billableIds,
    });
    const action = decision.action;

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

    const { squareCustomerId, squareCardId } = decision;
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

    let result;
    try {
      result = await chargeVehicleAddon(admin, {
        companyId,
        vehicleId,
        cycleDate: action.cycleDate,
        days: action.days,
        baselineCount: decision.baselineCount,
        squareCustomerId,
        squareCardId,
      });
    } catch (chargeError) {
      if (
        chargeError instanceof Error &&
        chargeError.message.startsWith("PAYMENT_INDETERMINATE")
      ) {
        console.error("Add-on charge indeterminate", chargeError.message);
        return NextResponse.json(
          {
            error:
              "A previous payment attempt is still settling with Square. The vehicle was not added. Please wait a few minutes and try again.",
          },
          { status: 409 }
        );
      }
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
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const mapped = errorResponse(error);
    // errorResponse passes anything that is not UNAUTHENTICATED/FORBIDDEN
    // through verbatim, and the throws reachable from here name internals.
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
