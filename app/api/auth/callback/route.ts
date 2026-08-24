import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  createServerClient,
} from "@supabase/ssr";
import {
  createClient,
} from "@supabase/supabase-js";
import type {
  EmailOtpType,
} from "@supabase/supabase-js";
import {
  decideAuthCallbackVerification,
} from "../../../../lib/auth/callback";
import {
  isMagicLinkEmailType,
  isValidMagicLinkTokenHash,
  safeAuthNextPath,
} from "../../../../lib/auth/confirm";

function createAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

async function resolvePortalDestination(
  userId: string,
): Promise<string | null> {
  const admin =
    createAdminClient();

  if (!admin) {
    console.error(
      "Portal redirect lookup skipped: SUPABASE_SERVICE_ROLE_KEY is missing.",
    );

    return null;
  }

  const {
    data: directDriver,
    error: directDriverError,
  } = await admin
    .from("driver_users")
    .select("id")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (directDriverError) {
    console.error(
      "Driver portal lookup failed:",
      directDriverError.message,
    );
  } else if (directDriver) {
    return "/driver/dashboard";
  }

  const {
    data: subcontractorUser,
    error: subcontractorUserError,
  } = await admin
    .from("subcontractor_users")
    .select("id, role")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (subcontractorUserError) {
    console.error(
      "Subcontractor portal lookup failed:",
      subcontractorUserError.message,
    );

    return null;
  }

  if (!subcontractorUser) {
    return null;
  }

  if (
    subcontractorUser.role === "driver"
  ) {
    return "/driver/dashboard";
  }

  return "/subcontractor/dashboard";
}

type VerificationInput = {
  tokenHash: string | null;
  type: EmailOtpType | null;
  code: string | null;
  requestedNext: string;
};

async function completeAuthentication(
  request: NextRequest,
  input: VerificationInput,
) {
  const url =
    new URL(request.url);

  if (
    !input.tokenHash &&
    !input.code
  ) {
    return NextResponse.redirect(
      new URL(
        "/login?error=missing_code",
        url.origin,
      ),
    );
  }

  const response =
    NextResponse.redirect(
      new URL(
        input.requestedNext,
        url.origin,
      ),
    );

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !anonKey
  ) {
    console.error(
      "Auth callback missing Supabase public environment variables.",
    );

    return NextResponse.redirect(
      new URL(
        "/login?error=auth_config",
        url.origin,
      ),
    );
  }

  const supabase =
    createServerClient(
      supabaseUrl,
      anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },

          setAll(cookiesToSet) {
            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {
                response.cookies.set(
                  name,
                  value,
                  options,
                );
              },
            );
          },
        },
      },
    );

  const {
    error: verificationError,
  } =
    input.tokenHash
      ? await supabase.auth.verifyOtp({
          type:
            input.type ??
            "email",
          token_hash:
            input.tokenHash,
        })
      : await supabase.auth
          .exchangeCodeForSession(
            input.code!,
          );

  const {
    data: {
      user: existingUser,
    },
    error: existingUserError,
  } =
    verificationError
      ? await supabase.auth.getUser()
      : {
          data: {
            user: null,
          },
          error: null,
        };

  const verificationDecision =
    decideAuthCallbackVerification(
      Boolean(
        verificationError,
      ),
      Boolean(
        existingUser &&
          !existingUserError,
      ),
    );

  if (
    verificationDecision ===
    "reject"
  ) {
    console.error(
      "Magic link verification failed:",
      verificationError?.message ??
        "Unknown verification error",
    );

    return NextResponse.redirect(
      new URL(
        "/login?error=auth",
        url.origin,
      ),
    );
  }

  let user =
    existingUser;

  if (
    verificationDecision ===
    "verified"
  ) {
    const {
      data: {
        user: verifiedUser,
      },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !verifiedUser
    ) {
      console.error(
        "Auth callback could not resolve authenticated user:",
        userError?.message ??
          "No user returned",
      );

      return NextResponse.redirect(
        new URL(
          "/login?error=user",
          url.origin,
        ),
      );
    }

    user =
      verifiedUser;
  }

  if (!user) {
    return NextResponse.redirect(
      new URL(
        "/login?error=user",
        url.origin,
      ),
    );
  }

  try {
    const portalDestination =
      await resolvePortalDestination(
        user.id,
      );

    if (portalDestination) {
      response.headers.set(
        "Location",
        new URL(
          portalDestination,
          url.origin,
        ).toString(),
      );
    }
  } catch (portalError) {
    console.error(
      "Portal destination resolution failed:",
      portalError,
    );
  }

  return response;
}

/*
 * Legacy GET callback support.
 *
 * Existing invite/PKCE links can continue to use the old callback,
 * but new email magic links are routed through /auth/confirm first.
 */
export async function GET(
  request: NextRequest,
) {
  const url =
    new URL(request.url);

  const tokenHash =
    url.searchParams.get(
      "token_hash",
    );

  const type =
    url.searchParams.get(
      "type",
    ) as EmailOtpType | null;

  const code =
    url.searchParams.get(
      "code",
    );

  const requestedNext =
    safeAuthNextPath(
      url.searchParams.get(
        "next",
      ),
      url.origin,
    );

  return completeAuthentication(
    request,
    {
      tokenHash,
      type,
      code,
      requestedNext,
    },
  );
}

/*
 * Scanner-safe human confirmation.
 *
 * GET /auth/confirm performs no OTP verification.
 * Only an explicit same-origin POST reaches this handler.
 */
export async function POST(
  request: NextRequest,
) {
  const url =
    new URL(request.url);

  const origin =
    request.headers.get(
      "origin",
    );

  if (
    !origin ||
    origin !== url.origin
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid authentication request origin.",
      },
      {
        status: 403,
      },
    );
  }

  const contentType =
    request.headers.get(
      "content-type",
    ) ?? "";

  if (
    !contentType.startsWith(
      "application/x-www-form-urlencoded",
    ) &&
    !contentType.startsWith(
      "multipart/form-data",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Unsupported authentication request.",
      },
      {
        status: 415,
      },
    );
  }

  const formData =
    await request.formData();

  const rawTokenHash =
    formData.get(
      "token_hash",
    );

  const rawType =
    formData.get(
      "type",
    );

  const rawNext =
    formData.get(
      "next",
    );

  const tokenHash =
    typeof rawTokenHash ===
    "string"
      ? rawTokenHash
      : null;

  const type =
    typeof rawType ===
    "string"
      ? rawType
      : null;

  const next =
    typeof rawNext ===
    "string"
      ? rawNext
      : null;

  if (
    !isValidMagicLinkTokenHash(
      tokenHash,
    ) ||
    !isMagicLinkEmailType(
      type,
    )
  ) {
    return NextResponse.redirect(
      new URL(
        "/login?error=invalid_link",
        url.origin,
      ),
    );
  }

  const requestedNext =
    safeAuthNextPath(
      next,
      url.origin,
    );

  return completeAuthentication(
    request,
    {
      tokenHash,
      type,
      code: null,
      requestedNext,
    },
  );
}
