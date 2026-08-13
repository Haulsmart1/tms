import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "subcontractor_admin",
  "dispatcher",
  "driver",
  "accounts",
]);

function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://tmswizard.cloud"
  );
}

async function createAuthenticatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public environment variables are missing.");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Existing request cookies are enough for auth checks.
        }
      },
    },
  });
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are missing.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
) {
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(`Unable to check Auth users: ${error.message}`);
    }

    const match = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email
    );

    if (match) {
      return match;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

export async function POST(request: NextRequest) {
  try {
    const userClient = await createAuthenticatedClient();

    const {
      data: { user: currentUser },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !currentUser) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      employeeId?: string;
      role?: string;
    };

    const employeeId = body.employeeId?.trim();
    const role = body.role?.trim().toLowerCase();

    if (!employeeId || !role) {
      return NextResponse.json(
        { error: "Employee and role are required." },
        { status: 400 }
      );
    }

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { error: "Invalid subcontractor role." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Caller can be either:
    // 1) ADR tenant admin, or
    // 2) subcontractor_admin for this subcontractor.
    const { data: targetEmployee, error: employeeError } = await admin
      .from("subcontractor_employees")
      .select(
        "id, tenant_id, subcontractor_id, full_name, email, directly_employed, active, employment_end_date"
      )
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError) {
      throw new Error(employeeError.message);
    }

    if (!targetEmployee) {
      return NextResponse.json(
        { error: "Employee not found." },
        { status: 404 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    if (
      targetEmployee.directly_employed !== true ||
      targetEmployee.active !== true ||
      (targetEmployee.employment_end_date &&
        targetEmployee.employment_end_date < today)
    ) {
      return NextResponse.json(
        {
          error:
            "Only active, directly employed subcontractor employees can receive portal access.",
        },
        { status: 409 }
      );
    }

    if (!targetEmployee.email) {
      return NextResponse.json(
        { error: "This employee needs an email address before they can be invited." },
        { status: 400 }
      );
    }

    const [tenantMembershipResult, subcontractorUserResult] = await Promise.all([
      admin
        .from("memberships")
        .select("id, role")
        .eq("tenant_id", targetEmployee.tenant_id)
        .eq("user_id", currentUser.id)
        .maybeSingle(),

      admin
        .from("subcontractor_users")
        .select("id, role, active")
        .eq("subcontractor_id", targetEmployee.subcontractor_id)
        .eq("user_id", currentUser.id)
        .maybeSingle(),
    ]);

    if (tenantMembershipResult.error || subcontractorUserResult.error) {
      throw new Error(
        tenantMembershipResult.error?.message ||
          subcontractorUserResult.error?.message ||
          "Unable to verify permissions."
      );
    }

    const isTenantAdmin =
      tenantMembershipResult.data &&
      ["admin", "super_admin"].includes(tenantMembershipResult.data.role);

    const isSubcontractorAdmin =
      subcontractorUserResult.data?.active === true &&
      subcontractorUserResult.data.role === "subcontractor_admin";

    if (!isTenantAdmin && !isSubcontractorAdmin) {
      return NextResponse.json(
        { error: "You are not allowed to invite subcontractor users." },
        { status: 403 }
      );
    }

    const email = targetEmployee.email.trim().toLowerCase();
    const existingAuthUser = await findAuthUserByEmail(admin, email);

    let userId: string;
    let inviteSent = false;

    if (existingAuthUser) {
      userId = existingAuthUser.id;
    } else {
      const redirectTo =
        role === "driver"
          ? `${getSiteUrl()}/api/auth/callback?next=/driver/dashboard`
          : `${getSiteUrl()}/api/auth/callback?next=/subcontractor/dashboard`;

      const { data: inviteData, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(email, {
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
        return NextResponse.json(
          { error: inviteError.message },
          { status: 400 }
        );
      }

      if (!inviteData.user?.id) {
        throw new Error("Supabase did not return the invited user ID.");
      }

      userId = inviteData.user.id;
      inviteSent = true;
    }

    // public.users is required by subcontractor_users.user_id FK.
    const { data: publicUser, error: publicUserReadError } = await admin
      .from("users")
      .select("id, email")
      .eq("id", userId)
      .maybeSingle();

    if (publicUserReadError) {
      throw new Error(publicUserReadError.message);
    }

    if (!publicUser) {
      const { error: insertPublicUserError } = await admin
        .from("users")
        .insert({
          id: userId,
          email,
        });

      if (insertPublicUserError) {
        throw new Error(insertPublicUserError.message);
      }
    }

    const { data: existingPortalUser, error: portalUserReadError } = await admin
      .from("subcontractor_users")
      .select("id")
      .eq("subcontractor_id", targetEmployee.subcontractor_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (portalUserReadError) {
      throw new Error(portalUserReadError.message);
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
        throw new Error(updateError.message);
      }
    } else {
      const { error: insertError } = await admin
        .from("subcontractor_users")
        .insert({
          tenant_id: targetEmployee.tenant_id,
          subcontractor_id: targetEmployee.subcontractor_id,
          employee_id: targetEmployee.id,
          user_id: userId,
          role,
          active: true,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    return NextResponse.json({
      ok: true,
      inviteSent,
      userId,
      message: inviteSent
        ? `Portal invitation sent to ${email}.`
        : `${email} already had an account and now has subcontractor portal access.`,
    });
  } catch (error) {
    console.error("Subcontractor invite failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to invite subcontractor user.",
      },
      { status: 500 }
    );
  }
}
