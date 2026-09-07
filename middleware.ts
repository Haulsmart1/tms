import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isApiPath, isPublicPath } from "./lib/auth/publicRoutes";

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

export async function middleware(request: NextRequest) {
  /* Held in a mutable binding because setAll below has to rebuild it. Returning
     a response created BEFORE the cookie writes silently discards the refreshed
     session, and the symptom is users being logged out every hour with nothing
     in the logs. */
  let response = NextResponse.next({ request });

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
     refresh-and-setAll above, so it runs on public paths too. */
  let user = null;

  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  if (isPublicPath(request.nextUrl.pathname)) return response;

  if (!user) return unauthenticated(request, response);

  return response;
}

export const config = {
  /* Everything except static assets. Each matched request costs one auth
     validation, so letting /_next/static or an image through would add a
     round trip per asset for no benefit. The final alternation skips anything
     with a file extension (favicon.ico, icon.svg, /public/* files). */
  matcher: [
    "/((?!_next/static|_next/image|.*\.[^/]+$).*)",
  ],
};
