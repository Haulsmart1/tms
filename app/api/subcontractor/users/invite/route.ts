import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createUserClient } from "../../../../../lib/accounts/server";
import { GENERIC_ERROR_MESSAGE } from "../../../../../lib/accounts/errors";
import { authorizeTenant, isUuid, TenantAccessError } from "../../../../../lib/auth/serverTenantAccess";
import { normalizeEmail } from "../../../../../lib/accounts/recipients";
import { checkRateLimit, RATE_LIMITS } from "../../../../../lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "subcontractor_admin",
  "dispatcher",
  "driver",
  "accounts",
]);

const NOT_FOUND = { error: "Employee not found." };

const EXISTING_ACCOUNT_MESSAGE =
  "This person could not be invited automatically. Contact support to grant portal access to an existing account.";

function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://tmswizard.cloud"
  );
}

type Employee = {
  id: string;
  tenant_id: string;
  subcontractor_id: string;
  full_name: string | null;
  email: string | null;
  directly_employed: boolean | null;
  active: boolean | null;
  employment_end_date: string | null;
};

/*
  Review ACC-11 / AUTH-10 (audit M5), ACC-18, ACC-2.

  1. Authorization happens before any response can reveal whether an employee
     exists, is eligible or has an email: "no such employee" and "not allowed"
     are the same 404.
  2. Tenant admin rights come from profiles (can_manage_tenant), not memberships.
  3. An address that already belongs to an account is never silently bound to
     this subcontractor. Only a person already linked to this subcontractor can
     have their access re-activated; anyone else is refused with a generic
     message. There is no scan of every auth user.
  4. Invites are rate limited per caller.
*/
export async function POST(request: NextRequest) {
  try {
    const userClient = await createUserClient();

    const {
      data: { user: currentUser },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !currentUser) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    let body: { employeeId?: unknown; role?: unknown };
    try {
      body = (await request.json()) as { employeeId?: unknown; role?: unknown };
    } catch {
      return NextResponse.json({ error: "Employee and role are required." }, { status: 400 });
    }

    const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
    const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";

    if (!employeeId || !role) {
      return NextResponse.json({ error: "Employee and role are required." }, { status: 400 });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid subcontractor role." }, { status: 400 });
    }

    const admin = createAdminClient();

    const limit = await checkRateLimit(admin, RATE_LIMITS.invitePerUser, currentUser.id);

    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many invitations have been sent recently. Please wait before sending more." },
        { status: 429 }
      );
    }

    if (!isUuid(employeeId)) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const { data: employeeRow, error: employeeError } = await admin
      .from("subcontractor_employees")
      .select("id, tenant_id, subcontractor_id, full_name, email, directly_employed, active, employment_end_date")
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError) {
      throw new Error(`employee lookup failed: ${employeeError.code ?? ""}`);
    }

    const targetEmployee = employeeRow as Employee | null;

    if (!targetEmployee) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    let isTenantAdmin = false;
    try {
      await authorizeTenant(admin, currentUser.id, targetEmployee.tenant_id, "manage");
      isTenantAdmin = true;
    } catch (error) {
      if (!(error instanceof TenantAccessError) || error.status !== 403) {
        throw error;
      }
    }

    let isSubcontractorAdmin = false;
    if (!isTenantAdmin) {
      const { data: callerLink, error: callerLinkError } = await admin
        .from("subcontractor_users")
        .select("id")
        .eq("tenant_id", targetEmployee.tenant_id)
        .eq("subcontractor_id", targetEmployee.subcontractor_id)
        .eq("user_id", currentUser.id)
        .eq("active", true)
        .eq("role", "subcontractor_admin")
        .limit(1);

      if (callerLinkError) {
        throw new Error(`caller link lookup failed: ${callerLinkError.code ?? ""}`);
      }

      isSubcontractorAdmin = (callerLink ?? []).length > 0;
    }

    if (!isTenantAdmin && !isSubcontractorAdmin) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Only an authorized caller reaches the eligibility messages below.
    const today = new Date().toISOString().slice(0, 10);

    if (
      targetEmployee.directly_employed !== true ||
      targetEmployee.active !== true ||
      (targetEmployee.employment_end_date && targetEmployee.employment_end_date < today)
    ) {
      return NextResponse.json(
        { error: "Only active, directly employed subcontractor employees can receive portal access." },
        { status: 409 }
      );
    }

    const email = normalizeEmail(targetEmployee.email);

    if (!email) {
      return NextResponse.json(
        { error: "This employee needs a valid email address before they can be invited." },
        { status: 400 }
      );
    }

    const { data: existingUsers, error: existingUserError } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .limit(2);

    if (existingUserError) {
      throw new Error(`users lookup failed: ${existingUserError.code ?? ""}`);
    }

    let userId: string | null = (existingUsers ?? [])[0]?.id ?? null;
    let inviteSent = false;

    if (userId) {
      const { data: priorLink, error: priorLinkError } = await admin
        .from("subcontractor_users")
        .select("id")
        .eq("subcontractor_id", targetEmployee.subcontractor_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (priorLinkError) {
        throw new Error(`portal link lookup failed: ${priorLinkError.code ?? ""}`);
      }

      if (!priorLink) {
        return NextResponse.json({ error: EXISTING_ACCOUNT_MESSAGE }, { status: 409 });
      }
    } else {
      const nextPath = role === "driver" ? "/driver/dashboard" : "/subcontractor/dashboard";
      const redirectTo = `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(nextPath)}`;

      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          portal: "subcontractor",
          subcontractor_id: targetEmployee.subcontractor_id,
          tenant_id: targetEmployee.tenant_id,
          employee_id: targetEmployee.id,
          role,
        },
      });

      if (inviteError) {
        const text = `${inviteError.code ?? ""} ${inviteError.message ?? ""}`.toLowerCase();
        console.error("[subcontractor invite] invite failed", inviteError.status, inviteError.code);

        if (text.includes("already") || text.includes("exists") || inviteError.status === 422) {
          return NextResponse.json({ error: EXISTING_ACCOUNT_MESSAGE }, { status: 409 });
        }

        return NextResponse.json({ error: "Unable to send the invitation. Please try again." }, { status: 502 });
      }

      if (!inviteData.user?.id) {
        throw new Error("Supabase did not return the invited user ID.");
      }

      userId = inviteData.user.id;
      inviteSent = true;

      // public.users is required by subcontractor_users.user_id FK.
      const { data: publicUser, error: publicUserReadError } = await admin
        .from("users")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (publicUserReadError) {
        throw new Error(`users read failed: ${publicUserReadError.code ?? ""}`);
      }

      if (!publicUser) {
        const { error: insertPublicUserError } = await admin.from("users").insert({ id: userId, email });

        if (insertPublicUserError) {
          throw new Error(`users insert failed: ${insertPublicUserError.code ?? ""}`);
        }
      }
    }

    const { data: existingPortalUser, error: portalUserReadError } = await admin
      .from("subcontractor_users")
      .select("id")
      .eq("subcontractor_id", targetEmployee.subcontractor_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (portalUserReadError) {
      throw new Error(`portal link read failed: ${portalUserReadError.code ?? ""}`);
    }

    if (existingPortalUser) {
      const { error: updateError } = await admin
        .from("subcontractor_users")
        .update({
          employee_id: targetEmployee.id,
          tenant_id: targetEmployee.tenant_id,
          role,
          active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingPortalUser.id);

      if (updateError) {
        throw new Error(`portal link update failed: ${updateError.code ?? ""}`);
      }
    } else {
      const { error: insertError } = await admin.from("subcontractor_users").insert({
        tenant_id: targetEmployee.tenant_id,
        subcontractor_id: targetEmployee.subcontractor_id,
        employee_id: targetEmployee.id,
        user_id: userId,
        role,
        active: true,
      });

      if (insertError) {
        throw new Error(`portal link insert failed: ${insertError.code ?? ""}`);
      }
    }

    return NextResponse.json({
      ok: true,
      inviteSent,
      message: inviteSent
        ? `Portal invitation sent to ${email}.`
        : `Portal access for ${email} has been updated.`,
    });
  } catch (error) {
    console.error("Subcontractor invite failed:", error);

    return NextResponse.json({ error: GENERIC_ERROR_MESSAGE, code: "internal_error" }, { status: 500 });
  }
}
