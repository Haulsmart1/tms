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
  INTAKE_PREFLIGHT_HEADERS,
  intakeCorsHeaders,
  isHoneypotFilled,
  isIntakeOriginAllowed,
  readPublicToken,
  requestOriginFromHeaders,
} from "../../../../../lib/quoteRequests/intakeSecurity";

import {
  hasUsefulQuoteRequestData,
  hashQuoteRequestToken,
  normaliseQuoteRequest,
  safeRawPayload,
  type PublicQuoteRequestPayload,
} from "../../../../../lib/quoteRequests/publicIntake";

/*
  Public quote-request intake from a haulier's own website form.

  - Only ACTIVE tokens are accepted (INV-21: tokens are still issued by hand;
    see the report for the open decision on a management UI).
  - Rate limited per client IP before any lookup, and per token after it
    (INV-7), whether or not the request carries an Origin.
  - When the token has allowed_origin, Origin (or Referer) must match; a
    request with neither is refused rather than waved through (INV-7).
  - CORS: OPTIONS preflight is answered and responses carry
    Access-Control-Allow-Origin for the configured origin, so browser forms
    can read the result and stop resubmitting (INV-22).
  - A filled honeypot field (_honey or _gotcha) gets a success response and
    is not stored.
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES =
  64 * 1024;

type TokenRecord = {
  id: string;
  tenant_id: string;
  allowed_origin: string | null;
};

function jsonError(
  message: string,
  status: number,
  headers: Record<string, string> = {}
) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
      headers,
    }
  );
}

async function parsePayload(
  request: NextRequest
): Promise<PublicQuoteRequestPayload> {
  const declaredLength =
    Number(
      request.headers.get(
        "content-length"
      ) ??
        0
    );

  if (
    Number.isFinite(
      declaredLength
    ) &&
    declaredLength >
      MAX_BODY_BYTES
  ) {
    throw new Error(
      "PAYLOAD_TOO_LARGE"
    );
  }

  const body =
    await request.arrayBuffer();

  if (
    body.byteLength >
    MAX_BODY_BYTES
  ) {
    throw new Error(
      "PAYLOAD_TOO_LARGE"
    );
  }

  const contentType =
    request.headers
      .get(
        "content-type"
      )
      ?.toLowerCase() ??
    "";

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    const text =
      new TextDecoder()
        .decode(body)
        .trim();

    if (!text) {
      return {};
    }

    const parsed =
      JSON.parse(text);

    if (
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !==
        "object"
    ) {
      throw new Error(
        "INVALID_PAYLOAD"
      );
    }

    return parsed as PublicQuoteRequestPayload;
  }

  if (
    contentType.includes(
      "application/x-www-form-urlencoded"
    )
  ) {
    const text =
      new TextDecoder()
        .decode(body);

    const params =
      new URLSearchParams(
        text
      );

    return Object.fromEntries(
      params.entries()
    );
  }

  if (
    contentType.includes(
      "multipart/form-data"
    )
  ) {
    const reconstructed =
      new Request(
        request.url,
        {
          method:
            "POST",

          headers: {
            "content-type":
              request.headers.get(
                "content-type"
              ) ??
              "",
          },

          body,
        }
      );

    const form =
      await reconstructed
        .formData();

    const result:
      PublicQuoteRequestPayload =
      {};

    for (
      const [
        key,
        value,
      ] of form.entries()
    ) {
      if (
        typeof value ===
        "string"
      ) {
        result[key] =
          value;
      }
      else {
        result[key] =
          `[file:${value.name}]`;
      }
    }

    return result;
  }

  throw new Error(
    "UNSUPPORTED_MEDIA_TYPE"
  );
}

function sourceFromPayload(
  payload: PublicQuoteRequestPayload
): "website" | "formsubmit" | "api" {
  const source =
    String(
      payload.source ??
        ""
    )
      .trim()
      .toLowerCase();

  if (
    source ===
    "formsubmit"
  ) {
    return "formsubmit";
  }

  if (
    source ===
    "api"
  ) {
    return "api";
  }

  return "website";
}

async function findActiveToken(
  admin: ReturnType<typeof createAdminClient>,
  tokenHash: string
): Promise<TokenRecord | null> {
  const {
    data,
    error,
  } = await admin
    .from(
      "quote_request_form_tokens"
    )
    .select(`
      id,
      tenant_id,
      active,
      allowed_origin
    `)
    .eq(
      "token_hash",
      tokenHash
    )
    .eq(
      "active",
      true
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message
    );
  }

  if (!data || data.active !== true) {
    return null;
  }

  return {
    id: data.id,
    tenant_id: data.tenant_id,
    allowed_origin: data.allowed_origin ?? null,
  };
}

export async function OPTIONS(
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

    const publicToken =
      readPublicToken(token);

    if (!publicToken) {
      return new NextResponse(null, {
        status: 204,
        headers: { Vary: "Origin" },
      });
    }

    const tokenRecord =
      await findActiveToken(
        createAdminClient(),
        hashQuoteRequestToken(publicToken)
      );

    const cors =
      intakeCorsHeaders(
        tokenRecord?.allowed_origin,
        request.headers.get("origin")
      );

    return new NextResponse(null, {
      status: 204,
      headers:
        cors["Access-Control-Allow-Origin"]
          ? { ...cors, ...INTAKE_PREFLIGHT_HEADERS }
          : cors,
    });
  }
  catch (error) {
    console.error(
      "Public quote request preflight failed:",
      error
    );

    return new NextResponse(null, {
      status: 204,
      headers: { Vary: "Origin" },
    });
  }
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  let cors: Record<string, string> = {
    Vary: "Origin",
  };

  try {
    const {
      token,
    } =
      await context.params;

    const publicToken =
      readPublicToken(token);

    if (!publicToken) {
      return jsonError(
        "Invalid quote request link.",
        404,
        cors
      );
    }

    const admin =
      createAdminClient();

    const ipLimit =
      await checkRateLimit(
        admin,
        RATE_LIMITS.quoteIntakePerIp,
        clientIp(request.headers)
      );

    if (!ipLimit.allowed) {
      return jsonError(
        "Too many quote requests. Please try again later.",
        429,
        cors
      );
    }

    const tokenHash =
      hashQuoteRequestToken(
        publicToken
      );

    const tokenRecord =
      await findActiveToken(
        admin,
        tokenHash
      );

    if (!tokenRecord) {
      return jsonError(
        "Invalid quote request link.",
        404,
        cors
      );
    }

    cors =
      intakeCorsHeaders(
        tokenRecord.allowed_origin,
        request.headers.get("origin")
      );

    if (
      !isIntakeOriginAllowed(
        tokenRecord.allowed_origin,
        requestOriginFromHeaders(request.headers)
      )
    ) {
      return jsonError(
        "This form origin is not authorised.",
        403,
        cors
      );
    }

    const tokenLimit =
      await checkRateLimit(
        admin,
        RATE_LIMITS.quoteIntakePerToken,
        tokenHash
      );

    if (!tokenLimit.allowed) {
      return jsonError(
        "Too many quote requests. Please try again later.",
        429,
        cors
      );
    }

    let payload:
      PublicQuoteRequestPayload;

    try {
      payload =
        await parsePayload(
          request
        );
    }
    catch (error) {
      const code =
        error instanceof Error
          ? error.message
          : "";

      if (
        code ===
        "PAYLOAD_TOO_LARGE"
      ) {
        return jsonError(
          "Quote request is too large.",
          413,
          cors
        );
      }

      if (
        code ===
        "UNSUPPORTED_MEDIA_TYPE"
      ) {
        return jsonError(
          "Unsupported form content type.",
          415,
          cors
        );
      }

      return jsonError(
        "Invalid quote request payload.",
        400,
        cors
      );
    }

    if (isHoneypotFilled(payload)) {
      /* Look successful so the bot learns nothing; store nothing. */
      return NextResponse.json(
        {
          ok: true,
        },
        {
          status: 201,
          headers: cors,
        }
      );
    }

    const normalised =
      normaliseQuoteRequest(
        payload
      );

    if (
      !hasUsefulQuoteRequestData(
        normalised
      )
    ) {
      return jsonError(
        "Quote request contains no usable details.",
        400,
        cors
      );
    }

    const receivedAt =
      new Date()
        .toISOString();

    const {
      data: created,
      error: insertError,
    } = await admin
      .from(
        "quote_requests"
      )
      .insert({
        tenant_id:
          tokenRecord.tenant_id,

        source:
          sourceFromPayload(
            payload
          ),

        status:
          "new",

        ...normalised,

        raw_payload:
          safeRawPayload(
            payload
          ),

        received_at:
          receivedAt,

        updated_at:
          receivedAt,
      })
      .select(`
        id
      `)
      .single();

    if (insertError) {
      throw new Error(
        insertError.message
      );
    }

    const {
      error: tokenUpdateError,
    } = await admin
      .from(
        "quote_request_form_tokens"
      )
      .update({
        last_used_at:
          receivedAt,

        updated_at:
          receivedAt,
      })
      .eq(
        "id",
        tokenRecord.id
      )
      .eq(
        "tenant_id",
        tokenRecord.tenant_id
      );

    if (
      tokenUpdateError
    ) {
      console.error(
        "Quote request token timestamp update failed:",
        tokenUpdateError.message
      );
    }

    return NextResponse.json(
      {
        ok: true,

        requestId:
          created.id,
      },
      {
        status: 201,
        headers: cors,
      }
    );
  }
  catch (error) {
    console.error(
      "Public quote request intake failed:",
      error
    );

    return jsonError(
      "Unable to submit quote request.",
      500,
      cors
    );
  }
}
