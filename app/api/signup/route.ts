import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicAppOrigin } from "../../../lib/accounts/appUrl";
import { createAdminClient } from "../../../lib/supabase/admin";
import { RATE_LIMITS, checkRateLimit, clientIp } from "../../../lib/rateLimit";
import { leadClientKey } from "../../../lib/auth/leadIntake";
import { confirmRedirectUrl } from "../../../lib/auth/magicLink";
import {
  invalidBodyResponse,
  runSignup,
  signupFailedResponse,
  type SignupDeps,
} from "../../../lib/auth/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Self-serve signup (decisions 1, 3, 7 and 8 in
   docs/superpowers/specs/2026-09-16-self-serve-signup-design.md).

   The decisions live in lib/auth/signup.ts; this file only builds the
   dependencies from real clients. Shape copied from app/api/auth/magic-link
   and app/api/request-access:
     - runs on the service role, which creates auth users whether or not
       "Allow new users to sign up" is on (it must stay OFF: AUTH-7, SQL-13);
     - never calls supabase.auth.signUp, and never puts tenant, company or role
       in user metadata (`data:`). Provisioning is the create_company_with_admin
       RPC, whose arguments only this route supplies;
     - answers the same body whether or not the address has an account;
     - the emailed link is built from publicAppOrigin, never the request host
       (lib/accounts/publicLinks.test.ts), and lands on the scanner-safe
       /auth/confirm page as type=invite. */

export async function POST(request: NextRequest) {
  const origin = publicAppOrigin(request.url);

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("signup: Supabase admin client unavailable", err);
    return NextResponse.json(signupFailedResponse().body, { status: signupFailedResponse().status });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error("signup: missing Supabase public environment variables");
    return NextResponse.json(signupFailedResponse().body, { status: signupFailedResponse().status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const invalid = invalidBodyResponse();
    return NextResponse.json(invalid.body, { status: invalid.status });
  }

  const redirectTo = confirmRedirectUrl(origin, "/dashboard");

  const deps: SignupDeps = {
    checkIpLimit: async (key) => (await checkRateLimit(admin, RATE_LIMITS.signupPerIp, key)).allowed,
    checkEmailLimit: async (email) => (await checkRateLimit(admin, RATE_LIMITS.signupPerEmail, email)).allowed,

    findUserIdByEmail: async (email) => {
      const { data, error } = await admin.rpc("find_auth_user_id_by_email", { p_email: email });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },

    getUserConfirmed: async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) throw error;
      return Boolean(data.user?.email_confirmed_at);
    },

    /* email_confirm:false and no `data`: an unconfirmed user, no email sent
       yet, no metadata for a trigger or a policy to trust. */
    createUser: async (email) => {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: false });
      if (error) throw error;
      if (!data.user?.id) throw new Error("createUser returned no id");
      return data.user.id;
    },

    deleteUser: async (userId) => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },

    createCompany: async ({ userId, email, companyName, contactName }) => {
      const { data, error } = await admin.rpc("create_company_with_admin", {
        p_user_id: userId,
        p_email: email,
        p_company_name: companyName,
        p_contact_name: contactName,
      });
      if (error) throw error;
      return typeof data === "string" ? data : "";
    },

    /* GoTrue accepts an invite for an existing UNCONFIRMED user and sends it,
       which is what makes "email last" possible after createUser. */
    sendInvite: async (email) => {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) throw error;
    },

    /* Exactly what /api/auth/magic-link does: anon key, implicit flow,
       shouldCreateUser false, so this can never create an account. */
    sendMagicLink: async (email) => {
      const anon = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
      });
      const { error } = await anon.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },

    log: {
      warn: (message, meta) => console.warn(`[signup] ${message}`, meta ?? ""),
      error: (message, meta) => console.error(`[signup] ${message}`, meta ?? ""),
    },
  };

  const response = await runSignup(deps, {
    body,
    ipKey: leadClientKey(request.headers, clientIp),
  });

  return NextResponse.json(response.body, { status: response.status });
}
