import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createAdminClient,
} from "../../../../../lib/accounts/server";

import {
  hasUsefulQuoteRequestData,
  hashQuoteRequestToken,
  normaliseQuoteRequest,
  safeRawPayload,
  type PublicQuoteRequestPayload,
} from "../../../../../lib/quoteRequests/publicIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES =
  64 * 1024;

function jsonError(
  message: string,
  status: number
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

function originAllowed(
  configuredOrigin: string | null,
  requestOrigin: string | null
): boolean {
  if (
    !configuredOrigin
  ) {
    return true;
  }

  if (
    !requestOrigin
  ) {
    return true;
  }

  try {
    const configured =
      new URL(
        configuredOrigin
      ).origin;

    const supplied =
      new URL(
        requestOrigin
      ).origin;

    return (
      configured ===
      supplied
    );
  }
  catch {
    return false;
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
  try {
    const {
      token,
    } =
      await context.params;

    const publicToken =
      decodeURIComponent(
        String(
          token ?? ""
        )
      ).trim();

    if (
      publicToken.length <
      32
    ) {
      return jsonError(
        "Invalid quote request link.",
        404
      );
    }

    const tokenHash =
      hashQuoteRequestToken(
        publicToken
      );

    const admin =
      createAdminClient();

    const {
      data: tokenRecord,
      error: tokenError,
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

    if (tokenError) {
      throw new Error(
        tokenError.message
      );
    }

    if (!tokenRecord) {
      return jsonError(
        "Invalid quote request link.",
        404
      );
    }

    const requestOrigin =
      request.headers.get(
        "origin"
      );

    if (
      !originAllowed(
        tokenRecord.allowed_origin,
        requestOrigin
      )
    ) {
      return jsonError(
        "This form origin is not authorised.",
        403
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
          413
        );
      }

      if (
        code ===
        "UNSUPPORTED_MEDIA_TYPE"
      ) {
        return jsonError(
          "Unsupported form content type.",
          415
        );
      }

      return jsonError(
        "Invalid quote request payload.",
        400
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
        400
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
      500
    );
  }
}