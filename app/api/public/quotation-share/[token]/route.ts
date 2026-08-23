import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createAdminClient,
} from "../../../../../lib/accounts/server";

import {
  loadQuotationShare,
} from "../../../../../lib/quotations/publicShare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(
  message: string,
  status = 400
) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
    }
  );
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  try {
    const { token } =
      await context.params;

    const rawToken =
      decodeURIComponent(token);

    const body =
      await request.json();

    const action =
      String(body.action ?? "")
        .trim()
        .toLowerCase();

    const name =
      String(body.name ?? "")
        .trim();

    const email =
      String(body.email ?? "")
        .trim();

    const companyName =
      String(body.companyName ?? "")
        .trim();

    const position =
      String(body.position ?? "")
        .trim();

    if (!name) {
      return errorResponse(
        "Your name is required."
      );
    }

    if (!email) {
      return errorResponse(
        "Your email address is required."
      );
    }

    if (
      action === "accept" &&
      !companyName
    ) {
      return errorResponse(
        "Company name is required."
      );
    }

    if (
      action === "accept" &&
      !position
    ) {
      return errorResponse(
        "Position is required."
      );
    }

    if (!email) {
      return errorResponse(
        "Your email address is required."
      );
    }

    const {
      share,
    } = await loadQuotationShare(
      rawToken,
      false
    );

    const admin =
      createAdminClient();

    if (action === "accept") {
      const clauseKeys =
        Array.isArray(body.clauseKeys)
          ? body.clauseKeys
              .map((value: unknown) =>
                String(value).trim()
              )
              .filter(Boolean)
          : [];

      const adrAccepted =
        body.adrAccepted === true;

      const forwardedFor =
        request.headers
          .get("x-forwarded-for")
          ?.split(",")[0]
          ?.trim() ||
        null;

      const userAgent =
        request.headers
          .get("user-agent");

      const {
        data,
        error,
      } = await admin.rpc(
        "accept_quotation_share_with_business_identity",
        {
          p_share_link_id:
            share.id,
          p_name:
            name,
          p_email:
            email || null,
          p_company_name:
            companyName,
          p_position:
            position,
          p_clause_keys:
            clauseKeys,
          p_adr_accepted:
            adrAccepted,
          p_ip_address:
            forwardedFor,
          p_user_agent:
            userAgent,
        }
      );

      if (error) {
        return errorResponse(
          error.message
        );
      }

      return NextResponse.json({
        ok: true,
        action: "accepted",
        acceptanceId: data,
      });
    }

    if (action === "decline") {
      const {
        error,
      } = await admin.rpc(
        "decline_quotation_share",
        {
          p_share_link_id:
            share.id,
          p_name:
            name,
          p_email:
            email || null,
        }
      );

      if (error) {
        return errorResponse(
          error.message
        );
      }

      return NextResponse.json({
        ok: true,
        action: "declined",
      });
    }

    return errorResponse(
      "Invalid quotation action."
    );
  }
  catch (error) {
    console.error(
      "Public quotation decision failed:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to update quotation.",
      500
    );
  }
}