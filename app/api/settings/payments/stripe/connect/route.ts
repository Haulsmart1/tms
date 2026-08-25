import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";

import {
  getStripe,
} from "../../../../../../lib/payments/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
      ).trim();

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
        tenantId,
        ACCOUNTS_ADMIN_ROLES
      );

    const {
      data: tenant,
      error: tenantError,
    } = await admin
      .from("tenants")
      .select(`
        id,
        name
      `)
      .eq(
        "id",
        tenantId
      )
      .maybeSingle();

    if (tenantError) {
      throw new Error(
        tenantError.message
      );
    }

    if (!tenant) {
      return NextResponse.json(
        {
          error:
            "Tenant not found.",
        },
        {
          status: 404,
        }
      );
    }

    const {
      data: existingConnection,
      error: existingError,
    } = await admin
      .from(
        "tenant_stripe_connections"
      )
      .select(`
        tenant_id,
        stripe_account_id,
        connection_status
      `)
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (existingError) {
      throw new Error(
        existingError.message
      );
    }

    const stripe =
      getStripe();

    let stripeAccountId =
      existingConnection?.stripe_account_id ??
      null;

    if (!stripeAccountId) {
      const account =
        await stripe.accounts.create({
          type: "express",

          business_profile: {
            name:
              String(
                tenant.name ?? ""
              ).trim() ||
              undefined,
          },

          capabilities: {
            card_payments: {
              requested: true,
            },

            transfers: {
              requested: true,
            },
          },

          metadata: {
            tms_tenant_id:
              tenantId,
          },
        });

      stripeAccountId =
        account.id;

      const {
        error: saveError,
      } = await admin
        .from(
          "tenant_stripe_connections"
        )
        .upsert(
          {
            tenant_id:
              tenantId,

            stripe_account_id:
              stripeAccountId,

            connection_status:
              "onboarding",

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
              account.requirements
                ?.currently_due ??
              [],

            last_synced_at:
              new Date()
                .toISOString(),

            updated_at:
              new Date()
                .toISOString(),
          },
          {
            onConflict:
              "tenant_id",
          }
        );

      if (saveError) {
        throw new Error(
          saveError.message
        );
      }
    }

    if (!stripeAccountId) {
      throw new Error(
        "Stripe account could not be created."
      );
    }

    const origin =
      new URL(
        request.url
      ).origin;

    const returnUrl =
      `${origin}/settings/company?stripe=return`;

    const refreshUrl =
      `${origin}/settings/company?stripe=refresh`;

    const accountLink =
      await stripe.accountLinks.create({
        account:
          stripeAccountId,

        refresh_url:
          refreshUrl,

        return_url:
          returnUrl,

        type:
          "account_onboarding",
      });

    const {
      error: updateError,
    } = await admin
      .from(
        "tenant_stripe_connections"
      )
      .upsert(
        {
          tenant_id:
            tenantId,

          stripe_account_id:
            stripeAccountId,

          connection_status:
            "onboarding",

          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "tenant_id",
        }
      );

    if (updateError) {
      throw new Error(
        updateError.message
      );
    }

    return NextResponse.json({
      ok: true,

      tenantId,

      stripeAccountId,

      onboardingUrl:
        accountLink.url,

      expiresAt:
        new Date(
          accountLink.expires_at *
            1000
        ).toISOString(),
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