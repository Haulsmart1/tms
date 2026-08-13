import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_INVITE_ROLES = new Set(["admin", "staff", "driver"]);

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "https://tmswizard.cloud";
}

async function createAuthenticatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase public environment variables are missing.");

  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Supabase server environment variables are missing.");

  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function requireTenantAdmin(request: NextRequest, tenantId: string) {
  const userClient = await createAuthenticatedClient();
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();

  if (error || !user) {
    return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return { error: NextResponse.json({ error: "Unable to verify your tenant permissions." }, { status: 500 }) };
  }

  if (!membership) {
    return { error: NextResponse.json({ error: "You do not belong to the selected tenant." }, { status: 403 }) };
  }

  if (!["admin", "super_admin"].includes(membership.role)) {
    return { error: NextResponse.json({ error: "Only a tenant admin can manage users." }, { status: 403 }) };
  }

  return { admin, user };
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
) {
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Unable to check existing Auth users: ${error.message}`);

    const match = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email
    );
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: "A tenant must be selected." }, { status: 400 });
    }

    const access = await requireTenantAdmin(request, tenantId);
    if ("error" in access) return access.error;

    const { admin } = access;

    const { data: memberships, error: membershipsError } = await admin
      .from("memberships")
      .select("id, user_id, tenant_id, role, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (membershipsError) {
      throw new Error(`Unable to load tenant memberships: ${membershipsError.message}`);
    }

    const userIds = Array.from(
      new Set((memberships ?? []).map((m) => m.user_id).filter((v): v is string => Boolean(v)))
    );

    if (userIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    const [publicUsersResult, profilesResult] = await Promise.all([
      admin.from("users").select("id, email, created_at").in("id", userIds),
      admin.from("profiles").select("id, full_name, phone, tenant_id, company_id, role_id").in("id", userIds),
    ]);

    if (publicUsersResult.error) {
      throw new Error(`Unable to load user emails: ${publicUsersResult.error.message}`);
    }

    if (profilesResult.error) {
      throw new Error(`Unable to load user profiles: ${profilesResult.error.message}`);
    }

    const publicUsersById = new Map((publicUsersResult.data ?? []).map((row) => [row.id, row]));
    const profilesById = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));

    const users = (memberships ?? []).map((membership) => {
      const publicUser = membership.user_id ? publicUsersById.get(membership.user_id) : undefined;
      const profile = membership.user_id ? profilesById.get(membership.user_id) : undefined;

      return {
        membership_id: membership.id,
        user_id: membership.user_id,
        tenant_id: membership.tenant_id,
        role: membership.role,
        membership_created_at: membership.created_at,
        email: publicUser?.email ?? null,
        full_name: profile?.full_name ?? null,
        phone: profile?.phone ?? null,
        company_id: profile?.company_id ?? null,
        role_id: profile?.role_id ?? null,
      };
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("Users GET API failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load users." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      role?: string;
      tenantId?: string;
    };

    const email = body.email?.trim().toLowerCase() ?? "";
    const tenantId = body.tenantId?.trim() ?? "";
    const role = body.role?.trim().toLowerCase() || "staff";

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!tenantId) {
      return NextResponse.json({ error: "A tenant must be selected." }, { status: 400 });
    }
    if (!ALLOWED_INVITE_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const access = await requireTenantAdmin(request, tenantId);
    if ("error" in access) return access.error;

    const { admin, user: currentUser } = access;
    const existingAuthUser = await findAuthUserByEmail(admin, email);

    let invitedUserId: string;
    let inviteSent = false;

    if (existingAuthUser) {
      invitedUserId = existingAuthUser.id;
    } else {
      const redirectTo = `${getSiteUrl()}/api/auth/callback?next=/dashboard`;

      const { data: inviteData, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: {
            tenant_id: tenantId,
            role,
            invited_by: currentUser.id,
          },
        });

      if (inviteError) {
        return NextResponse.json({ error: inviteError.message }, { status: 400 });
      }

      if (!inviteData.user?.id) {
        return NextResponse.json(
          { error: "Supabase created the invitation but did not return a user ID." },
          { status: 500 }
        );
      }

      invitedUserId = inviteData.user.id;
      inviteSent = true;
    }

    const { data: publicUser, error: publicUserReadError } = await admin
      .from("users")
      .select("id, email")
      .eq("id", invitedUserId)
      .maybeSingle();

    if (publicUserReadError) {
      throw new Error(`Unable to check public user record: ${publicUserReadError.message}`);
    }

    if (!publicUser) {
      const { error: insertError } = await admin
        .from("users")
        .insert({ id: invitedUserId, email });

      if (insertError) {
        throw new Error(`Unable to create public user record: ${insertError.message}`);
      }
    } else if (publicUser.email !== email) {
      const { error: updateError } = await admin
        .from("users")
        .update({ email })
        .eq("id", invitedUserId);

      if (updateError) {
        throw new Error(`Unable to update public user email: ${updateError.message}`);
      }
    }

    const { data: existingProfile, error: profileReadError } = await admin
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", invitedUserId)
      .maybeSingle();

    if (profileReadError) {
      throw new Error(`Unable to check profile: ${profileReadError.message}`);
    }

    if (!existingProfile) {
      const { error: profileInsertError } = await admin
        .from("profiles")
        .insert({ id: invitedUserId, tenant_id: tenantId });

      if (profileInsertError) {
        throw new Error(`Unable to create profile: ${profileInsertError.message}`);
      }
    } else if (!existingProfile.tenant_id) {
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({ tenant_id: tenantId })
        .eq("id", invitedUserId);

      if (profileUpdateError) {
        throw new Error(`Unable to link profile to tenant: ${profileUpdateError.message}`);
      }
    }

    const { data: existingMembership, error: existingMembershipError } = await admin
      .from("memberships")
      .select("id, role")
      .eq("tenant_id", tenantId)
      .eq("user_id", invitedUserId)
      .maybeSingle();

    if (existingMembershipError) {
      throw new Error(`Unable to check membership: ${existingMembershipError.message}`);
    }

    if (existingMembership) {
      const { error: membershipUpdateError } = await admin
        .from("memberships")
        .update({ role })
        .eq("id", existingMembership.id);

      if (membershipUpdateError) {
        throw new Error(`Unable to update membership: ${membershipUpdateError.message}`);
      }
    } else {
      const { error: membershipInsertError } = await admin
        .from("memberships")
        .insert({
          tenant_id: tenantId,
          user_id: invitedUserId,
          role,
        });

      if (membershipInsertError) {
        throw new Error(`Unable to create tenant membership: ${membershipInsertError.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: inviteSent
        ? `Invite sent to ${email}.`
        : `${email} already had a TMS account and has now been added to this tenant.`,
      inviteSent,
      userId: invitedUserId,
      tenantId,
      role,
    });
  } catch (error) {
    console.error("User invite API failed:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to invite user." },
      { status: 500 }
    );
  }
}
