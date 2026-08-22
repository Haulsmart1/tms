import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";

import {
  getStripe,
} from "../../../../../../lib/payments/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectionStatus(
  values: {
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    disabledReason: string | null;
  }
): string {
  if (
    values.chargesEnabled &&
    values.payoutsEnabled &&
    values.detailsSubmitted
  ) {
    return "connected";
  }

  if (
    values.disabledReason
  ) {
    return "restricted";
  }

  return "onboarding";
}

export async function GET(
  request: NextRequest
) {
  try {
    const tenantId =
      new URL(
        request.url
      ).searchParams
        .get("tenantId")
        ?.trim() ??
      "";

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
    } =
      await requireTenantAccess(
        tenantId
      );

    const {
      data: connection,
      error: connectionError,
    } = await admin
      .from(
        "tenant_stripe_connections"
      )
      .select(`
        tenant_id,
        stripe_account_id,
        connection_status,
        charges_enabled,
        payouts_enabled,
        details_submitted,
        country,
        default_currency,
        requirements_currently_due,
        last_synced_at
      `)
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (connectionError) {
      throw new Error(
        connectionError.message
      );
    }

    if (
      !connection?.stripe_account_id
    ) {
      return NextResponse.json({
        ok: true,

        connected:
          false,

        connectionStatus:
          "not_connected",

        stripeAccountId:
          null,

        chargesEnabled:
          false,

        payoutsEnabled:
          false,

        detailsSubmitted:
          false,

        country:
          null,

        defaultCurrency:
          null,

        requirementsCurrentlyDue:
          [],
      });
    }

    const stripe =
      getStripe();

    const account =
      await stripe.accounts.retrieve(
        connection.stripe_account_id
      );

    const disabledReason =
      account.requirements
        ?.disabled_reason ??
      null;

    const status =
      connectionStatus({
        chargesEnabled:
          Boolean(
            account.charges_enabled
          ),

        payoutsEnabled:
          Boolean(
            account.payouts_enabled
          ),

        detailsSubmitted:
          Boolean(
            account.details_submitted
          ),

        disabledReason,
      });

    const requirementsCurrentlyDue =
      account.requirements
        ?.currently_due ??
      [];

    const syncedAt =
      new Date()
        .toISOString();

    const {
      error: updateError,
    } = await admin
      .from(
        "tenant_stripe_connections"
      )
      .update({
        connection_status:
          status,

        charges_enabled:
          Boolean(
            account.charges_enabled
          ),

        payouts_enabled:
          Boolean(
            account.payouts_enabled
          ),

        details_submitted:
          Boolean(
            account.details_submitted
          ),

        country:
          account.country ??
          null,

        default_currency:
          account.default_currency ??
          null,

        requirements_currently_due:
          requirementsCurrentlyDue,

        last_synced_at:
          syncedAt,

        updated_at:
          syncedAt,
      })
      .eq(
        "tenant_id",
        tenantId
      )
      .eq(
        "stripe_account_id",
        account.id
      );

    if (updateError) {
      throw new Error(
        updateError.message
      );
    }

    return NextResponse.json({
      ok: true,

      connected:
        status === "connected",

      connectionStatus:
        status,

      stripeAccountId:
        account.id,

      chargesEnabled:
        Boolean(
          account.charges_enabled
        ),

      payoutsEnabled:
        Boolean(
          account.payouts_enabled
        ),

      detailsSubmitted:
        Boolean(
          account.details_submitted
        ),

      country:
        account.country ??
        null,

      defaultCurrency:
        account.default_currency ??
        null,

      requirementsCurrentlyDue,

      disabledReason,

      lastSyncedAt:
        syncedAt,
    });
  }
  catch (error) {
    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status:
          result.status,
      }
    );
  }
}