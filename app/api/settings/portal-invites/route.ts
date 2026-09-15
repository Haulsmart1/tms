import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, RATE_LIMITS } from "../../../../lib/rateLimit";
import { operatorDay } from "../../../../lib/time";
import { MIGRATION_MISSING_MESSAGE } from "../../../../lib/tenant/userAdmin";
import { portalInviteMessage, portalLinkDecision } from "../../../../lib/tenant/portalInvite";
import { requireUserAdmin } from "../users/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUB_ROLES = new Set([
  "subcontractor_admin",
  "dispatcher",
  "driver",
  "accounts",
]);

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

class PortalInviteError extends Error {
  constructor(public readonly status: number, public readonly publicMessage: string) {
    super(publicMessage);
  }
}

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://tmswizard.cloud"
  );
}

async function findAuthUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await admin.rpc("find_auth_user_id_by_email", { p_email: email });
  if (error) {
    if (error.code && MISSING_FUNCTION_CODES.has(error.code)) {
      throw new PortalInviteError(503, MIGRATION_MISSING_MESSAGE);
    }
    console.error("[portal-invites] lookup failed", error.code);
    throw new PortalInviteError(500, "Unable to send the invitation right now.");
  }
  return typeof data === "string" ? data : null;
}

/** The company an existing account belongs to, or null when it has none. "super" for a super admin. */
async function accountCompany(admin: SupabaseClient, userId: string): Promise<string | null | "super"> {
  const { data, error } = await admin
    .from("profiles")
    .select("company_id, tenant_id, roles(name)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new PortalInviteError(500, "Unable to send the invitation right now.");
  if (!data) return null;

  const roles = data.roles as { name?: unknown } | { name?: unknown }[] | null;
  const role = Array.isArray(roles) ? roles[0] : roles;
  if (role?.name === "super_admin") return "super";

  if (data.company_id) return String(data.company_id);
  if (!data.tenant_id) return null;

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .select("company_id")
    .eq("id", data.tenant_id)
    .maybeSingle();
  if (tenantError) throw new PortalInviteError(500, "Unable to send the invitation right now.");
  return tenantRow?.company_id ? String(tenantRow.company_id) : null;
}

/*
  The company behind each ACTIVE portal link the account already holds, as the
  third input to portalLinkDecision. A portal-only account has no profile, so
  this is the only record of who it works for. A link on a tenant with no
  company comes back as null, which the decision treats as foreign.
*/
async function portalLinkCompanies(admin: SupabaseClient, userId: string): Promise<(string | null)[]> {
  const [driverLinks, subLinks] = await Promise.all([
    admin.from("driver_users").select("tenant_id").eq("user_id", userId).eq("active", true),
    admin.from("subcontractor_users").select("tenant_id").eq("user_id", userId).eq("active", true),
  ]);
  if (driverLinks.error || subLinks.error) {
    throw new PortalInviteError(500, "Unable to send the invitation right now.");
  }

  const tenantIds = [
    ...new Set(
      [...(driverLinks.data ?? []), ...(subLinks.data ?? [])]
        .map((row) => (row.tenant_id ? String(row.tenant_id) : ""))
        .filter(Boolean),
    ),
  ];
  if (tenantIds.length === 0) return [];

  const { data: tenants, error } = await admin.from("tenants").select("id, company_id").in("id", tenantIds);
  if (error) throw new PortalInviteError(500, "Unable to send the invitation right now.");

  const companyByTenant = new Map((tenants ?? []).map((t) => [String(t.id), t.company_id ? String(t.company_id) : null]));
  return tenantIds.map((id) => companyByTenant.get(id) ?? null);
}

async function linkDecisionFor(admin: SupabaseClient, userId: string, companyId: string | null) {
  const [company, linkCompanies] = await Promise.all([
    accountCompany(admin, userId),
    portalLinkCompanies(admin, userId),
  ]);
  return portalLinkDecision(company, companyId, linkCompanies);
}

async function ensurePublicUser(admin: SupabaseClient, userId: string, email: string) {
  const { data, error } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
  if (error) throw new Error("users lookup failed");
  if (!data) {
    const { error: insertError } = await admin.from("users").insert({ id: userId, email });
    if (insertError) throw new Error("users insert failed");
  }
}

async function sendSignInLink(email: string, next: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return;
  try {
    const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    if (error) console.warn("[portal-invites] sign-in link not sent", error.status);
  } catch (error) {
    console.warn("[portal-invites] sign-in link not sent", error);
  }
}

/*
  Resolves (or creates) the account for a portal invite.

  AUTH-5 / SET-8: an existing account is linked only when it has no company or
  already belongs to the inviting company. An account in another company, or
  a super admin, is never attached without consent; the caller gets the same
  "invitation sent" answer either way, so the response reveals nothing.
*/
async function resolveInvitee(
  admin: SupabaseClient,
  email: string,
  companyId: string | null,
  inviteMetadata: Record<string, unknown>,
  next: string,
): Promise<{ userId: string | null; createdUserId: string | null; existing: boolean }> {
  let userId = await findAuthUserId(admin, email);

  if (userId) {
    const decision = await linkDecisionFor(admin, userId, companyId);
    return { userId: decision === "link" ? userId : null, createdUserId: null, existing: true };
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    // Invite links land on the scanner-safe confirm page (AUTH-6).
    redirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    data: inviteMetadata,
  });

  if (error || !data.user?.id) {
    userId = await findAuthUserId(admin, email);
    if (!userId) {
      console.error("[portal-invites] invite failed", error?.status, error?.code);
      throw new PortalInviteError(400, "Unable to send the invitation. Check the address and try again.");
    }
    const decision = await linkDecisionFor(admin, userId, companyId);
    return { userId: decision === "link" ? userId : null, createdUserId: null, existing: true };
  }

  return { userId: data.user.id, createdUserId: data.user.id, existing: false };
}

async function cleanupCreated(admin: SupabaseClient, createdUserId: string | null) {
  if (!createdUserId) return;
  const { error } = await admin.auth.admin.deleteUser(createdUserId);
  if (error) console.error("[portal-invites] cleanup of new auth user failed", createdUserId);
}

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() ?? "";
  const access = await requireUserAdmin(tenantId);
  if (!access.ok) return access.response;

  const { admin } = access.ctx;

  try {
    const [drivers, subcontractors, employees, driverUsers, subUsers] =
      await Promise.all([
        admin
          .from("drivers")
          .select("id,name,email,phone,active,driver_type")
          .eq("tenant_id", tenantId)
          .order("name"),
        admin
          .from("subcontractors")
          .select("id,name,subcontractor_type,active")
          .eq("tenant_id", tenantId)
          .eq("active", true)
          .order("name"),
        admin
          .from("subcontractor_employees")
          .select(
            "id,subcontractor_id,full_name,email,job_title,directly_employed,active,employment_end_date"
          )
          .eq("tenant_id", tenantId)
          .order("full_name"),
        admin
          .from("driver_users")
          .select("id,driver_id,user_id,active")
          .eq("tenant_id", tenantId),
        admin
          .from("subcontractor_users")
          .select("id,subcontractor_id,employee_id,user_id,role,active")
          .eq("tenant_id", tenantId),
      ]);

    const err =
      drivers.error ||
      subcontractors.error ||
      employees.error ||
      driverUsers.error ||
      subUsers.error;

    if (err) throw new Error(err.code ?? "load failed");

    return NextResponse.json({
      drivers: drivers.data ?? [],
      subcontractors: subcontractors.data ?? [],
      employees: employees.data ?? [],
      driverUsers: driverUsers.data ?? [],
      subcontractorUsers: subUsers.data ?? [],
    });
  } catch (error) {
    console.error("[portal-invites] load failed", error);
    return NextResponse.json({ error: "Unable to load portal access." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const tenantId = String(body.tenantId ?? "").trim();
  const access = await requireUserAdmin(tenantId);
  if (!access.ok) return access.response;

  const { admin, user: inviter, tenant } = access.ctx;

  const limit = await checkRateLimit(admin, RATE_LIMITS.invitePerUser, inviter.id);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many invitations. Try again later." }, { status: 429 });
  }

  let createdUserId: string | null = null;

  try {
    if (body.type === "driver") {
      const driverId = String(body.driverId ?? "").trim();
      if (!driverId) {
        return NextResponse.json({ error: "Choose a driver." }, { status: 400 });
      }

      const { data: driver, error } = await admin
        .from("drivers")
        .select("id,name,email,active")
        .eq("id", driverId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw new Error("driver lookup failed");
      if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
      if (driver.active === false) {
        return NextResponse.json({ error: "Driver is inactive." }, { status: 409 });
      }
      if (!driver.email) {
        return NextResponse.json({ error: "Driver needs an email address." }, { status: 400 });
      }

      const email = driver.email.trim().toLowerCase();

      const { data: existingLink, error: linkError } = await admin
        .from("driver_users")
        .select("id, user_id, active")
        .eq("tenant_id", tenantId)
        .eq("driver_id", driver.id)
        .maybeSingle();

      if (linkError) throw new Error("driver link lookup failed");

      const next = "/driver/dashboard";
      const invitee = await resolveInvitee(
        admin,
        email,
        tenant.companyId,
        { portal: "driver", tenant_id: tenantId, driver_id: driver.id, invited_by: inviter.id },
        next,
      );
      createdUserId = invitee.createdUserId;

      if (invitee.userId) {
        // Never silently repoint an active link to a different account.
        if (existingLink?.active && existingLink.user_id && existingLink.user_id !== invitee.userId) {
          await cleanupCreated(admin, createdUserId);
          return NextResponse.json(
            { error: "This driver's portal access is linked to a different account. Revoke it before inviting again." },
            { status: 409 },
          );
        }

        await ensurePublicUser(admin, invitee.userId, email);

        if (existingLink) {
          const { error: updateError } = await admin
            .from("driver_users")
            .update({ user_id: invitee.userId, active: true, updated_at: new Date().toISOString() })
            .eq("id", existingLink.id);
          if (updateError) throw new Error("driver link update failed");
        } else {
          const { error: insertError } = await admin
            .from("driver_users")
            .insert({ tenant_id: tenantId, driver_id: driver.id, user_id: invitee.userId, active: true });
          if (insertError) throw new Error("driver link insert failed");
        }

        if (invitee.existing) await sendSignInLink(email, next);
      }

      return NextResponse.json({ ok: true, message: portalInviteMessage("driver", email) });
    }

    if (body.type === "subcontractor") {
      const employeeId = String(body.employeeId ?? "").trim();
      const role = String(body.role ?? "").trim().toLowerCase();

      if (!employeeId || !SUB_ROLES.has(role)) {
        return NextResponse.json(
          { error: "Choose an employee and valid portal role." },
          { status: 400 }
        );
      }

      const { data: employee, error } = await admin
        .from("subcontractor_employees")
        .select(
          "id,subcontractor_id,full_name,email,directly_employed,active,employment_end_date"
        )
        .eq("id", employeeId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw new Error("employee lookup failed");
      if (!employee) {
        return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      }

      const today = operatorDay(new Date());
      if (
        employee.directly_employed !== true ||
        employee.active !== true ||
        (employee.employment_end_date && employee.employment_end_date < today)
      ) {
        return NextResponse.json(
          { error: "Only active, directly employed employees can be invited." },
          { status: 409 }
        );
      }

      if (!employee.email) {
        return NextResponse.json({ error: "Employee needs an email address." }, { status: 400 });
      }

      const email = employee.email.trim().toLowerCase();

      const { data: link, error: linkError } = await admin
        .from("subcontractor_users")
        .select("id, user_id, active")
        .eq("tenant_id", tenantId)
        .eq("subcontractor_id", employee.subcontractor_id)
        .eq("employee_id", employee.id)
        .maybeSingle();

      if (linkError) throw new Error("subcontractor link lookup failed");

      const next = role === "driver" ? "/driver/dashboard" : "/subcontractor/dashboard";
      const invitee = await resolveInvitee(
        admin,
        email,
        tenant.companyId,
        {
          portal: "subcontractor",
          tenant_id: tenantId,
          subcontractor_id: employee.subcontractor_id,
          employee_id: employee.id,
          role,
          invited_by: inviter.id,
        },
        next,
      );
      createdUserId = invitee.createdUserId;

      if (invitee.userId) {
        if (link?.active && link.user_id && link.user_id !== invitee.userId) {
          await cleanupCreated(admin, createdUserId);
          return NextResponse.json(
            { error: "This employee's portal access is linked to a different account. Revoke it before inviting again." },
            { status: 409 },
          );
        }

        await ensurePublicUser(admin, invitee.userId, email);

        if (link) {
          const { error: updateError } = await admin
            .from("subcontractor_users")
            .update({ user_id: invitee.userId, role, active: true, updated_at: new Date().toISOString() })
            .eq("id", link.id);
          if (updateError) throw new Error("subcontractor link update failed");
        } else {
          const { error: insertError } = await admin
            .from("subcontractor_users")
            .insert({
              tenant_id: tenantId,
              subcontractor_id: employee.subcontractor_id,
              employee_id: employee.id,
              user_id: invitee.userId,
              role,
              active: true,
            });
          if (insertError) throw new Error("subcontractor link insert failed");
        }

        if (invitee.existing) await sendSignInLink(email, next);
      }

      return NextResponse.json({ ok: true, message: portalInviteMessage("subcontractor", email) });
    }

    return NextResponse.json({ error: "Unknown invite type." }, { status: 400 });
  } catch (error) {
    await cleanupCreated(admin, createdUserId);
    if (error instanceof PortalInviteError) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }
    console.error("[portal-invites] invite failed", error);
    return NextResponse.json({ error: "Invite failed. Nothing was changed; try again." }, { status: 500 });
  }
}
