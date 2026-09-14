import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, RATE_LIMITS } from "../../../../../lib/rateLimit";
import {
  buildListedUsers,
  inviteResponse,
  isValidEmail,
  MIGRATION_MISSING_MESSAGE,
  parseInvitableRole,
  parseProvisionOutcome,
  userAdminErrorResponse,
  type ProfileListRow,
} from "../../../../../lib/tenant/userAdmin";
import { json, requireUserAdmin } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "https://tmswizard.cloud";
}

/*
  An account that already existed (for example someone who typed their email
  on /login before being invited) gets no invite email from Supabase, so send
  them an ordinary sign-in link instead. Uses the anon key and
  shouldCreateUser:false, exactly like the login page, so it can never create
  an account. Failures are logged only: the response must not differ.
*/
async function sendSignInLink(email: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return;

  try {
    const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/dashboard` },
    });
    if (error) console.warn("[settings/users/invite] sign-in link not sent", error.status);
  } catch (error) {
    console.warn("[settings/users/invite] sign-in link not sent", error);
  }
}

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() ?? "";
  const access = await requireUserAdmin(tenantId);
  if (!access.ok) return access.response;

  const { admin } = access.ctx;

  try {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, full_name, phone, tenant_id, company_id, role_id, roles(name)")
      .eq("tenant_id", tenantId);

    if (profilesError) throw new Error("profiles");

    const rows = (profiles ?? []) as unknown as ProfileListRow[];
    const ids = rows.map((row) => row.id);
    const emailById = new Map<string, string | null>();

    if (ids.length > 0) {
      const { data: publicUsers, error: usersError } = await admin.from("users").select("id, email").in("id", ids);
      if (usersError) throw new Error("users");
      for (const row of publicUsers ?? []) emailById.set(String(row.id), row.email ?? null);

      // Accounts provisioned outside the invite flow may have no public.users row.
      const missing = ids.filter((id) => !emailById.get(id)).slice(0, 50);
      await Promise.all(
        missing.map(async (id) => {
          const { data } = await admin.auth.admin.getUserById(id);
          if (data?.user?.email) emailById.set(id, data.user.email);
        }),
      );
    }

    return NextResponse.json({ users: buildListedUsers(tenantId, rows, emailById) });
  } catch (error) {
    console.error("[settings/users] list failed", error);
    return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; role?: unknown; tenantId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const role = parseInvitableRole(body.role ?? "staff");

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const access = await requireUserAdmin(tenantId);
  if (!access.ok) return access.response;

  const { admin, user } = access.ctx;

  const limit = await checkRateLimit(admin, RATE_LIMITS.invitePerUser, user.id);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many invitations. Try again later." }, { status: 429 });
  }

  // Look the address up first. If the migration is missing, stop before any
  // side effect (no auth user, no email).
  const lookup = await admin.rpc("find_auth_user_id_by_email", { p_email: email });
  if (lookup.error) {
    if (lookup.error.code && MISSING_FUNCTION_CODES.has(lookup.error.code)) {
      return NextResponse.json({ error: MIGRATION_MISSING_MESSAGE }, { status: 503 });
    }
    console.error("[settings/users/invite] lookup failed", lookup.error.code);
    return NextResponse.json({ error: "Unable to send the invitation right now." }, { status: 500 });
  }

  let userId: string | null = typeof lookup.data === "string" ? lookup.data : null;
  let createdUserId: string | null = null;

  if (!userId) {
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      // Invite links land on the scanner-safe confirm page (AUTH-6).
      redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent("/dashboard")}`,
      data: { tenant_id: tenantId, role, invited_by: user.id },
    });

    if (inviteError || !inviteData.user?.id) {
      // A concurrent invite for the same address may have won the race.
      const retry = await admin.rpc("find_auth_user_id_by_email", { p_email: email });
      if (!retry.error && typeof retry.data === "string") {
        userId = retry.data;
      } else {
        console.error("[settings/users/invite] invite failed", inviteError?.status, inviteError?.code);
        return NextResponse.json(
          { error: "Unable to send the invitation. Check the address and try again." },
          { status: 400 },
        );
      }
    } else {
      userId = inviteData.user.id;
      createdUserId = userId;
    }
  }

  const provision = await admin.rpc("provision_tenant_user", {
    p_user_id: userId,
    p_email: email,
    p_tenant_id: tenantId,
    p_role: role,
  });

  const outcome = provision.error ? null : parseProvisionOutcome(provision.data);

  if (!outcome) {
    console.error("[settings/users/invite] provisioning failed", provision.error?.code, provision.error?.message);
    // Compensate: an account this request created must not be left behind
    // with an emailed invite and no profile.
    if (createdUserId) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(createdUserId);
      if (deleteError) console.error("[settings/users/invite] cleanup of new auth user failed", createdUserId);
    }
    return json(userAdminErrorResponse(provision.error ?? null));
  }

  if (!createdUserId && (outcome === "created" || outcome === "repaired")) {
    await sendSignInLink(email);
  }

  return json(inviteResponse(outcome, email));
}
