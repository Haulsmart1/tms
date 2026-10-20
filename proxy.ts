import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { isApiPath, isPublicPath } from "./lib/auth/publicRoutes";
import { isTransientAuthFailure } from "./lib/auth/authAvailability";

const SESSION_ENTRY_PATHS = new Set([
  "/login",
  "/auth/confirm",
  "/api/auth/magic-link",
  "/api/auth/callback",
]);

/* Edge auth gate.

   This is defence in depth, NOT the security boundary. RLS in Postgres remains
   the isolation boundary (see CLAUDE.md): this file has no notion of tenants
   and cannot stop a signed-in user asking for another tenant's rows. What it
   does do is keep anonymous requests off authenticated surfaces, and refresh
   the Supabase session cookie so server components stop rendering against a
   token that expired while the tab was idle.

   It replaces nothing. app/super-admin/layout.tsx still owns the role check,
   and TenantGate still owns the client-side signed-out redirect. */

function unauthenticated(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const { pathname, search } = request.nextUrl;

  /* An API caller is a fetch(), not a browser following redirects. Sending it
     to an HTML login page produces a 200 full of markup where JSON was
     expected, which surfaces as a JSON parse error far from the real cause. */
  if (isApiPath(pathname)) {
    const json = NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );

    /* Carry over any refreshed auth cookies rather than dropping them. */
    for (const cookie of response.cookies.getAll()) {
      json.cookies.set(cookie);
    }

    return json;
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";

  /* Only ever a same-origin path+query. The consuming side runs this back
     through safeAuthNextPath (lib/auth/confirm.ts), which rejects anything
     off-origin, so this value is never trusted on the return trip either. */
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", pathname + search);
  }

  const redirect = NextResponse.redirect(loginUrl);

  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }

  return redirect;
}

/* A server outage must not be mistaken for an expired session. The page
   stays protected (503), and refreshing it retries the auth check without
   clearing cookies or IndexedDB driver evidence. An actual missing/revoked
   session still gets the existing 401 or /login redirect. */
function temporarilyUnavailable(request: NextRequest, response: NextResponse): NextResponse {
  const retry = isApiPath(request.nextUrl.pathname)
    ? NextResponse.json({ error: "auth_temporarily_unavailable" }, { status: 503 })
    : new NextResponse(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TMS Wizard - Try again</title></head><body><main><h1>Sign-in check temporarily unavailable</h1><p>Your session could not be verified right now. No work has been cleared.</p><p><a href="">Retry this page</a></p></main></body></html>',
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
  retry.headers.set("Cache-Control", "private, no-store");
  retry.headers.set("Retry-After", "5");
  for (const cookie of response.cookies.getAll()) retry.cookies.set(cookie);
  return retry;
}

export async function proxy(request: NextRequest) {
  /* Held in a mutable binding because setAll below has to rebuild it. Returning
     a response created BEFORE the cookie writes silently discards the refreshed
     session, and the symptom is users being logged out every hour with nothing
     in the logs. */
  let response = NextResponse.next({ request });

  /* Recovery and session creation must not refresh the session being replaced.
     An old cookie can contain an already-used refresh token. Refreshing it here
     can race the callback's fresh session cookies and needlessly contacts Auth
     before a visitor can request a new link. These exact routes already own
     their validation, rate limits and same-origin checks; protected routes
     below still require getUser(). No offline or application storage is reset. */
  if (SESSION_ENTRY_PATHS.has(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /* Fail closed. A missing env var must not degrade into an open door; /login
     and the landing page are public, so the app stays reachable enough to
     diagnose. The service-role key is never read here: this runs at the edge on
     every request, and only lib/supabase/admin.ts may hold that key. */
  if (!url || !anonKey) {
    if (isPublicPath(request.nextUrl.pathname)) return response;

    return unauthenticated(request, response);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /* getUser(), never getSession(). getSession() decodes whatever is in the
     cookie without verifying it against the auth server, so a forged cookie
     passes. getUser() validates the token. This call is also what triggers the
     refresh-and-setAll above, so it runs on other public paths too. */
  let user = null;
  let verificationUnavailable = false;

  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    verificationUnavailable = Boolean(error && (
      isAuthRetryableFetchError(error) || isTransientAuthFailure(error)
    ));
  } catch {
    // A failed verification is NOT proof that the user signed out.
    verificationUnavailable = true;
  }

  if (isPublicPath(request.nextUrl.pathname)) return response;

  if (!user) {
    return verificationUnavailable
      ? temporarilyUnavailable(request, response)
      : unauthenticated(request, response);
  }

  return response;
}

export const config = {
  /* Everything except static assets. Each matched request costs one auth
     validation, so letting /_next/static or an image through would add a
     round trip per asset for no benefit. The final alternation skips anything
     with a file extension (favicon.ico, icon.svg, /public/* files), but
     never under /api/ (N-8): a route handler reached as /api/x/<id>.json
     still runs the gate. */
  matcher: [
    "/((?!_next/static|_next/image|(?!api/).*\\.[^/]+$).*)",
  ],
};
