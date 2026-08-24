import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { EmailOtpType } from "@supabase/supabase-js";
import { decideAuthCallbackVerification } from "../../../../lib/auth/callback";

function safeNextPath(raw: string | null, origin: string): string {
  if (!raw) {
    return "/dashboard";
  }

  try {
    const resolved = new URL(raw, origin);

    if (resolved.origin === origin) {
      return resolved.pathname + resolved.search + resolved.hash;
    }
  } catch {
    // Fall back to the normal dashboard.
  }

  return "/dashboard";
}

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    }
  );
}

async function resolvePortalDestination(
  userId: string
): Promise<string | null> {
  const admin = createAdminClient();

  if (!admin) {
    console.error(
      "Portal redirect lookup skipped: SUPABASE_SERVICE_ROLE_KEY is missing."
    );

    return null;
  }

  // ----------------------------------------------------------
  // 1. ADR-employed driver
  // ----------------------------------------------------------

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
      directDriverError.message
    );
  } else if (directDriver) {
    return "/driver/dashboard";
  }

  // ----------------------------------------------------------
  // 2. Subcontractor portal user
  // ----------------------------------------------------------

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
      subcontractorUserError.message
    );

    return null;
  }

  if (!subcontractorUser) {
    return null;
  }

  if (subcontractorUser.role === "driver") {
    return "/driver/dashboard";
  }

  return "/subcontractor/dashboard";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const tokenHash = url.searchParams.get("token_hash");

  const type =
    url.searchParams.get("type") as EmailOtpType | null;

  const code = url.searchParams.get("code");

  const requestedNext = safeNextPath(
    url.searchParams.get("next"),
    url.origin
  );

  if (!tokenHash && !code) {
    return NextResponse.redirect(
      new URL(
        "/login?error=missing_code",
        url.origin
      )
    );
  }

  /*
   * Create the response first because Supabase writes the new
   * authenticated session cookies directly onto this response.
   */
  const response = NextResponse.redirect(
    new URL(requestedNext, url.origin)
  );

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error(
      "Auth callback missing Supabase public environment variables."
    );

    return NextResponse.redirect(
      new URL(
        "/login?error=auth_config",
        url.origin
      )
    );
  }

  const supabase = createServerClient(
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
                options
              );
            }
          );
        },
      },
    }
  );

  // ----------------------------------------------------------
  // Verify the magic link / PKCE callback.
  // ----------------------------------------------------------

  const { error: verificationError } =
    tokenHash
      ? await supabase.auth.verifyOtp({
          type: type ?? "email",
          token_hash: tokenHash,
        })
      : await supabase.auth.exchangeCodeForSession(
          code!
        );

  /*
   * Magic-link tokens are single use. Mail scanners, browser
   * prefetchers or duplicate navigation can replay the same
   * callback after the first request has already established a
   * valid session.
   *
   * An expired token is NEVER accepted by itself. Recovery is
   * allowed only when Supabase independently confirms that this
   * request already carries a valid authenticated session.
   */
  const {
    data: {
      user: existingUser,
    },
    error: existingUserError,
  } = verificationError
    ? await supabase.auth.getUser()
    : {
        data: {
          user: null,
        },
        error: null,
      };

  const verificationDecision =
    decideAuthCallbackVerification(
      Boolean(verificationError),
      Boolean(
        existingUser &&
          !existingUserError
      ),
    );

  if (verificationDecision === "reject") {
    console.error(
      "Magic link verification failed:",
      verificationError?.message ??
        "Unknown verification error"
    );

    return NextResponse.redirect(
      new URL(
        "/login?error=auth",
        url.origin
      )
    );
  }

  let user = existingUser;

  if (verificationDecision === "verified") {
    const {
      data: {
        user: verifiedUser,
      },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !verifiedUser) {
      console.error(
        "Auth callback could not resolve authenticated user:",
        userError?.message ?? "No user returned"
      );

      return NextResponse.redirect(
        new URL(
          "/login?error=user",
          url.origin
        )
      );
    }

    user = verifiedUser;
  }

  if (!user) {
    return NextResponse.redirect(
      new URL(
        "/login?error=user",
        url.origin
      )
    );
  }

  // ----------------------------------------------------------
  // Portal-aware routing.
  //
  // ADR driver:
  //     /driver/dashboard
  //
  // Subcontractor driver:
  //     /driver/dashboard
  //
  // Subcontractor admin/dispatcher/accounts:
  //     /subcontractor/dashboard
  //
  // Normal TMS user:
  //     preserve requested next path
  // ----------------------------------------------------------

  try {
    const portalDestination =
      await resolvePortalDestination(
        user.id
      );

    if (portalDestination) {
      response.headers.set(
        "Location",
        new URL(
          portalDestination,
          url.origin
        ).toString()
      );
    }
  } catch (portalError) {
    /*
     * A portal lookup problem must not destroy a successful
     * normal TMS authentication.
     */
    console.error(
      "Portal destination resolution failed:",
      portalError
    );
  }

  return response;
}
