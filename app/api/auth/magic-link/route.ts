import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { RATE_LIMITS, checkRateLimit, clientIp } from "../../../../lib/rateLimit";
import {
  MAGIC_LINK_SENT_MESSAGE,
  confirmRedirectUrl,
  normalizeLoginEmail,
} from "../../../../lib/auth/magicLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Sends the sign-in email (AUTH-7, SQL-13, AUTH-12).

   This used to run in the browser, straight against Supabase, with
   shouldCreateUser left at its default of true. That let anyone create an
   auth.users row for any address and spend the project's shared email quota.
   Here:
     - shouldCreateUser is false, so this route never creates an account.
       Accounts come from invites or admin setup only.
     - it is rate limited per IP and per email, durably (lib/rateLimit.ts).
     - it answers identically whether or not the address has an account, and
       never surfaces a Supabase error, because "Signups not allowed" and
       "email rate limit exceeded" would each tell a caller the address exists.

   Note this does not stop a bot calling Supabase's /auth/v1/otp directly with
   the public anon key. That needs "Allow new users to sign up" turned off and
   captcha enabled in the Supabase Auth settings (manual step).

   The email template is unchanged: it still links to /auth/confirm with
   token_hash, and the OTP request carries no PKCE verifier (this client runs
   the implicit flow), so the link works in whichever browser opens it. */

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = normalizeLoginEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("magic-link: Supabase admin client unavailable", err);
    return NextResponse.json({ error: "Sign-in is not available right now." }, { status: 500 });
  }

  if (!supabaseUrl || !anonKey) {
    console.error("magic-link: missing Supabase public environment variables");
    return NextResponse.json({ error: "Sign-in is not available right now." }, { status: 500 });
  }

  /* IP first: it is the cheaper abuse to stop, and it keeps a flood of distinct
     addresses from each getting their own allowance. The per-email check is
     independent of whether the account exists, so a 429 reveals nothing. */
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(admin, RATE_LIMITS.loginPerIp, clientIp(request.headers)),
    checkRateLimit(admin, RATE_LIMITS.loginPerEmail, email),
  ]);

  if (!ipLimit.allowed || !emailLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: confirmRedirectUrl(origin, body.next),
    },
  });

  if (error) {
    // Logged, never returned: see the enumeration note at the top. Status and
    // code only, so the address itself does not land in the logs.
    console.warn("magic-link: signInWithOtp did not send", { status: error.status, code: error.code });
  }

  return NextResponse.json({ ok: true, message: MAGIC_LINK_SENT_MESSAGE });
}
