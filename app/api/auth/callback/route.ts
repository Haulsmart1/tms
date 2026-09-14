import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  createServerClient,
} from "@supabase/ssr";
import type {
  EmailOtpType,
} from "@supabase/supabase-js";
import {
  authCallbackRedirectStatus,
  decideAuthCallbackVerification,
  decideLegacyCallbackAction,
  decidePostLoginDestination,
  type PortalLookup,
} from "../../../../lib/auth/callback";
import {
  isMagicLinkEmailType,
  isValidMagicLinkTokenHash,
  safeAuthNextPath,
} from "../../../../lib/auth/confirm";
import {
  createAdminClient,
} from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

/* The single service-role entry point (lib/supabase/admin.ts), not a local
   copy of it (AUTH-14). Returns null rather than throwing when the key is
   missing, so the caller can report the failure instead of crashing. */
function adminClientOrNull() {
  try {
    return createAdminClient();
  } catch (error) {
    console.error(
      "Auth callback: Supabase admin client unavailable:",
      error,
    );

    return null;
  }
}

type Admin = NonNullable<ReturnType<typeof adminClientOrNull>>;

async function lookupPortal(
  admin: Admin,
  userId: string,
): Promise<PortalLookup> {
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

    return { ok: false };
  }

  if (directDriver) {
    return { ok: true, destination: "/driver/dashboard" };
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

    return { ok: false };
  }

  if (!subcontractorUser) {
    return { ok: true, destination: null };
  }

  return {
    ok: true,
    destination:
      subcontractorUser.role === "driver"
        ? "/driver/dashboard"
        : "/subcontractor/dashboard",
  };
}

/* A console profile is one that places the user in the operator console:
   a home tenant or a role. Read from profiles, the single source of truth for
   roles and tenancy (the same columns RLS and get_tenant_context() use). */
async function lookupHasConsoleProfile(
  admin: Admin,
  userId: string,
): Promise<boolean | "unknown"> {
  const { data, error } = await admin
    .from("profiles")
    .select("tenant_id, role_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      "Console profile lookup failed:",
      error.message,
    );

    return "unknown";
  }

  return Boolean(data?.tenant_id || data?.role_id);
}

async function resolveDestination(
  userId: string,
  requestedNext: string,
): Promise<string> {
  const admin = adminClientOrNull();

  if (!admin) {
    return decidePostLoginDestination({
      requestedNext,
      portal: { ok: false },
      hasConsoleProfile: "unknown",
    });
  }

  try {
    const portal = await lookupPortal(admin, userId);

    /* Only a user with a portal link needs the profile read. */
    const hasConsoleProfile =
      portal.ok && portal.destination
        ? await lookupHasConsoleProfile(admin, userId)
        : "unknown";

    return decidePostLoginDestination({
      requestedNext,
      portal,
      hasConsoleProfile,
    });
  } catch (error) {
    console.error(
      "Portal destination resolution failed:",
      error,
    );

    return decidePostLoginDestination({
      requestedNext,
      portal: { ok: false },
      hasConsoleProfile: "unknown",
    });
  }
}

type VerificationInput =
  | {
      tokenHash: string;
      type: EmailOtpType;
      code: null;
      requestedNext: string;
    }
  | {
      tokenHash: null;
      type: null;
      code: string;
      requestedNext: string;
    };

async function completeAuthentication(
  request: NextRequest,
  input: VerificationInput,
) {
  /* 303 after a POST, on EVERY branch (AUTH-13). A 307 re-POSTs the form body,
     token_hash included, to /login, which is a page and answers with an error
     instead of the friendly "link expired" prompt. */
  const redirectStatus =
    authCallbackRedirectStatus(
      request.method,
    );
  const url =
    new URL(request.url);

  const redirectTo = (path: string) =>
    NextResponse.redirect(
      new URL(path, url.origin),
      { status: redirectStatus },
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

    return redirectTo("/login?error=auth_config");
  }

  /* Session cookies are collected here and copied onto whichever redirect we
     finally return, so the destination can be decided after verification
     without mutating the Location header of an existing response. */
  const pendingCookies: {
    name: string;
    value: string;
    options: Parameters<NextResponse["cookies"]["set"]>[2];
  }[] = [];

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
            for (const cookie of cookiesToSet) {
              pendingCookies.push(cookie);
            }
          },
        },
      },
    );

  const withCookies = (response: NextResponse) => {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options);
    }

    return response;
  };

  const {
    error: verificationError,
  } =
    input.code === null
      ? await supabase.auth.verifyOtp({
          type: input.type,
          token_hash: input.tokenHash,
        })
      : await supabase.auth
          .exchangeCodeForSession(
            input.code,
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

    return withCookies(redirectTo("/login?error=auth"));
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

      return withCookies(redirectTo("/login?error=user"));
    }

    user =
      verifiedUser;
  }

  if (!user) {
    return withCookies(redirectTo("/login?error=user"));
  }

  const destination =
    await resolveDestination(
      user.id,
      input.requestedNext,
    );

  return withCookies(redirectTo(destination));
}

/*
 * Legacy GET callback (AUTH-6).
 *
 * Never verifies a token_hash: that is forwarded to the scanner-safe
 * /auth/confirm page, so old invite and magic-link emails that still point
 * here keep working, but need a human press of Continue. A PKCE `code` is
 * still exchanged here because it is bound to the browser that started the
 * flow.
 */
export async function GET(
  request: NextRequest,
) {
  const url =
    new URL(request.url);

  const action =
    decideLegacyCallbackAction(
      url.searchParams,
    );

  if (action.kind === "confirm") {
    return NextResponse.redirect(
      new URL(
        action.location,
        url.origin,
      ),
      { status: 303 },
    );
  }

  if (action.kind === "invalid") {
    return NextResponse.redirect(
      new URL(
        "/login?error=missing_code",
        url.origin,
      ),
      { status: 303 },
    );
  }

  return completeAuthentication(
    request,
    {
      tokenHash: null,
      type: null,
      code: action.code,
      requestedNext: safeAuthNextPath(
        url.searchParams.get("next"),
        url.origin,
      ),
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

  let formData: FormData;

  try {
    formData =
      await request.formData();
  } catch {
    // A malformed body used to escape as an unhandled 500 (AUTH-13).
    return NextResponse.redirect(
      new URL(
        "/login?error=invalid_link",
        url.origin,
      ),
      { status: 303 },
    );
  }

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
      { status: 303 },
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
