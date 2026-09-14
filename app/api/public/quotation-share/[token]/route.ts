import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createAdminClient,
} from "../../../../../lib/accounts/server";

import {
  RATE_LIMITS,
  checkRateLimit,
  clientIp,
} from "../../../../../lib/rateLimit";

import {
  INVALID_REQUEST,
  evidenceIp,
  parseQuotationDecision,
} from "../../../../../lib/quotations/publicDecision";

import {
  loadQuotationShare,
  markQuotationShareViewed,
} from "../../../../../lib/quotations/publicShare";

import {
  SHARE_MESSAGES,
  publicRpcErrorMessage,
  publicShareError,
  type ShareMessageCode,
} from "../../../../../lib/quotations/shareStatus";

/*
  Anonymous accept / decline / view for a shared quotation.

  - Rate limited per client IP (INV-7).
  - Body validated and bounded before anything else runs (INV-19).
  - Refuses a quotation that is cancelled, declined, expired or already
    decided, checked here from the quotation row and again inside the v2 RPCs
    (INV-6).
  - Acceptance must carry the hash of the prices the page showed; a changed
    quotation is refused, and the v2 RPC stores that snapshot on the
    acceptance record (INV-4).
  - Only fixed messages reach the caller; detail is logged (INV-18).
  - Every RPC here runs through the service-role client, which is the only
    role left with EXECUTE after docs/sql/prodfix_50 (SQL-6).
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES =
  16 * 1024;

const MISSING_FUNCTION_CODES =
  new Set(["42883", "PGRST202"]);

const PRODFIX_50_WARNING =
  "Apply docs/sql/prodfix_50_quotation_share_acceptance.sql so decisions are re-checked in the database and accepted prices are recorded.";

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

function codeResponse(
  code: ShareMessageCode,
  status: number
) {
  return errorResponse(
    SHARE_MESSAGES[code],
    status
  );
}

function isMissingFunction(
  error: { code?: string } | null
): boolean {
  return Boolean(
    error?.code &&
      MISSING_FUNCTION_CODES.has(error.code)
  );
}

async function readJsonBody(
  request: NextRequest
): Promise<unknown> {
  const text =
    await request.text();

  if (text.length > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }

  return JSON.parse(text);
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
    const admin =
      createAdminClient();

    const {
      allowed,
    } = await checkRateLimit(
      admin,
      RATE_LIMITS.quoteSharePerIp,
      clientIp(request.headers)
    );

    if (!allowed) {
      return codeResponse(
        "rateLimited",
        429
      );
    }

    const { token } =
      await context.params;

    let rawToken: string;

    try {
      rawToken =
        decodeURIComponent(token);
    }
    catch {
      return codeResponse(
        "invalid",
        404
      );
    }

    let body: unknown;

    try {
      body =
        await readJsonBody(request);
    }
    catch {
      return errorResponse(
        INVALID_REQUEST
      );
    }

    const parsed =
      parseQuotationDecision(body);

    if (!parsed.ok) {
      return errorResponse(
        parsed.error
      );
    }

    const decisionInput =
      parsed.value;

    const loaded =
      await loadQuotationShare(
        rawToken
      );

    if (decisionInput.action === "view") {
      await markQuotationShareViewed(
        loaded.share.id
      );

      return NextResponse.json({
        ok: true,
        action: "viewed",
      });
    }

    const state =
      loaded.decision;

    if (state.state === "accepted") {
      return codeResponse(
        "alreadyAccepted",
        409
      );
    }

    if (state.state === "declined") {
      return codeResponse(
        "alreadyDeclined",
        409
      );
    }

    if (state.state === "closed") {
      return codeResponse(
        state.reason,
        410
      );
    }

    if (decisionInput.action === "accept") {
      if (
        decisionInput.snapshotHash !==
        loaded.snapshotHash
      ) {
        return codeResponse(
          "changed",
          409
        );
      }

      const legacyArgs = {
        p_share_link_id:
          loaded.share.id,
        p_name:
          decisionInput.name,
        p_email:
          decisionInput.email,
        p_company_name:
          decisionInput.companyName,
        p_position:
          decisionInput.position,
        p_clause_keys:
          decisionInput.clauseKeys,
        p_adr_accepted:
          decisionInput.adrAccepted,
        p_ip_address:
          evidenceIp(request.headers),
        p_user_agent:
          request.headers
            .get("user-agent")
            ?.slice(0, 512) ?? null,
      };

      let result =
        await admin.rpc(
          "accept_quotation_share_v2",
          {
            ...legacyArgs,
            p_token_hash:
              loaded.tokenHash,
            p_expected_snapshot:
              loaded.snapshot,
          }
        );

      if (isMissingFunction(result.error)) {
        /* The route has already verified the token, the quotation state and
           the price snapshot, so the legacy RPC is no weaker than before
           this change; it just cannot store the snapshot. */
        console.warn(
          `[quotation-share] accept_quotation_share_v2 is not installed; using the legacy RPC. ${PRODFIX_50_WARNING}`
        );

        result =
          await admin.rpc(
            "accept_quotation_share_with_business_identity",
            legacyArgs
          );
      }

      if (result.error) {
        console.error(
          "Public quotation acceptance failed:",
          result.error.code,
          result.error.message
        );

        return errorResponse(
          publicRpcErrorMessage(
            result.error.message
          )
        );
      }

      return NextResponse.json({
        ok: true,
        action: "accepted",
        acceptanceId: result.data,
      });
    }

    let declineResult =
      await admin.rpc(
        "decline_quotation_share_v2",
        {
          p_share_link_id:
            loaded.share.id,
          p_token_hash:
            loaded.tokenHash,
          p_name:
            decisionInput.name,
          p_email:
            decisionInput.email,
        }
      );

    if (isMissingFunction(declineResult.error)) {
      console.warn(
        `[quotation-share] decline_quotation_share_v2 is not installed; using the legacy RPC. ${PRODFIX_50_WARNING}`
      );

      declineResult =
        await admin.rpc(
          "decline_quotation_share",
          {
            p_share_link_id:
              loaded.share.id,
            p_name:
              decisionInput.name,
            p_email:
              decisionInput.email,
          }
        );
    }

    if (declineResult.error) {
      console.error(
        "Public quotation decline failed:",
        declineResult.error.code,
        declineResult.error.message
      );

      return errorResponse(
        publicRpcErrorMessage(
          declineResult.error.message
        )
      );
    }

    return NextResponse.json({
      ok: true,
      action: "declined",
    });
  }
  catch (error) {
    const mapped =
      publicShareError(
        error,
        "genericDecision"
      );

    if (mapped.status >= 500) {
      console.error(
        "Public quotation decision failed:",
        error
      );
    }

    return errorResponse(
      mapped.message,
      mapped.status
    );
  }
}
