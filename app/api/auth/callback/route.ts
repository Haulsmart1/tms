import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

function safeNextPath(raw: string | null, origin: string): string {
  // Resolve against our own origin, then require the result to stay on it.
  // A string prefix check ("/" and not "//") is NOT enough: for http(s) URLs
  // the URL parser normalizes backslashes and strips tab/CR/LF, so inputs like
  // "/\\evil.com" or "/\t//evil.com" pass a prefix check yet resolve to another
  // origin — an open redirect. Comparing the resolved origin closes all forms.
  if (!raw) return "/dashboard";
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin === origin) {
      return resolved.pathname + resolved.search + resolved.hash;
    }
  } catch {
    // malformed input falls through to the safe default
  }
  return "/dashboard";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), url.origin);

  if (!tokenHash && !code) {
    return NextResponse.redirect(new URL("/?error=missing_code", url.origin));
  }

  const response = NextResponse.redirect(new URL(next, url.origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({ type: type ?? "email", token_hash: tokenHash })
    : await supabase.auth.exchangeCodeForSession(code!);

  if (error) {
    console.error("magic link verification failed", error.message);
    return NextResponse.redirect(new URL("/?error=auth", url.origin));
  }

  return response;
}