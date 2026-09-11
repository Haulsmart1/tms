import { NextResponse } from "next/server";
import {
  authClient,
  requireOperator,
} from "../../../../lib/tomtom/server";
import {
  getTachographProvider,
} from "../../../../lib/tachograph/provider";
import {
  requireTachographTenantAdmin,
} from "../../../../lib/tachograph/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncBody = {
  tenantId?: unknown;
  providerId?: unknown;
  mode?: unknown;
};

export async function POST(request: Request) {
  try {
    const client = await authClient();
    const operator = await requireOperator(client);

    if (!operator) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    if (!operator.companyId) {
      return NextResponse.json(
        { error: "You do not have console access." },
        { status: 403 }
      );
    }

    const body =
      (await request.json().catch(() => null)) as
        | SyncBody
        | null;

    const tenantId =
      typeof body?.tenantId === "string"
        ? body.tenantId.trim()
        : "";

    const providerId =
      typeof body?.providerId === "string"
        ? body.providerId.trim()
        : "";

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "Choose a tenant before using a tachograph provider.",
        },
        { status: 400 }
      );
    }

    try {
      await requireTachographTenantAdmin(
        operator.userId,
        tenantId
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "TACHOGRAPH_FORBIDDEN"
      ) {
        return NextResponse.json(
          {
            error:
              "Only a tenant administrator can synchronise tachograph data.",
          },
          { status: 403 }
        );
      }

      throw error;
    }

    const provider =
      getTachographProvider(providerId);

    if (!provider) {
      return NextResponse.json(
        {
          error:
            "No tachograph API provider is configured for this id.",
        },
        { status: 404 }
      );
    }

    if (!provider.descriptor.configured) {
      return NextResponse.json(
        {
          error:
            "This tachograph provider is not configured.",
        },
        { status: 409 }
      );
    }

    if (body?.mode === "test") {
      await provider.testConnection();

      return NextResponse.json({
        ok: true,
        message: "Connection successful.",
      });
    }

    return NextResponse.json(
      {
        error:
          "Provider is registered, but driver mapping/synchronisation is not enabled until its vendor adapter is installed.",
      },
      { status: 501 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Tachograph provider request failed.",
      },
      { status: 500 }
    );
  }
}
