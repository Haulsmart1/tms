import { NextRequest, NextResponse } from "next/server";
import {
  createAdminClient,
  createUserClient,
} from "../../../../../lib/accounts/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "staff", "driver"]);
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

async function requireTenantAdmin(tenantId: string) {
  const userClient = await createUserClient();

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      ),
    };
  }

  const admin = createAdminClient();

  const { data: membership, error } = await admin
    .from("memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return {
      error: NextResponse.json(
        { error: "Unable to verify tenant permissions." },
        { status: 500 }
      ),
    };
  }

  if (!membership) {
    return {
      error: NextResponse.json(
        { error: "You do not belong to this tenant." },
        { status: 403 }
      ),
    };
  }

  if (!ADMIN_ROLES.has(String(membership.role))) {
    return {
      error: NextResponse.json(
        { error: "Only a tenant admin can manage users." },
        { status: 403 }
      ),
    };
  }

  return {
    admin,
    currentUser: user,
  };
}

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      userId: string;
    }>;
  }
) {
  try {
    const { userId } = await context.params;

    const body = (await request.json()) as {
      tenantId?: string;
      fullName?: string;
      phone?: string;
      role?: string;
    };

    const tenantId = body.tenantId?.trim() ?? "";
    const fullName = body.fullName?.trim() ?? "";
    const phone = body.phone?.trim() ?? "";
    const role = body.role?.trim().toLowerCase() ?? "";

    if (!tenantId) {
      return NextResponse.json(
        { error: "A tenant must be selected." },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: "A user must be selected." },
        { status: 400 }
      );
    }

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { error: "Invalid role." },
        { status: 400 }
      );
    }

    const access = await requireTenantAdmin(tenantId);

    if ("error" in access) {
      return access.error;
    }

    const { admin } = access;

    const { data: targetMembership, error: membershipError } = await admin
      .from("memberships")
      .select("id, user_id, tenant_id, role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      throw new Error(
        `Unable to load tenant membership: ${membershipError.message}`
      );
    }

    if (!targetMembership) {
      return NextResponse.json(
        { error: "That user does not belong to this tenant." },
        { status: 404 }
      );
    }

    const currentlyAdmin = ADMIN_ROLES.has(
      String(targetMembership.role)
    );

    const willRemainAdmin = ADMIN_ROLES.has(role);

    if (currentlyAdmin && !willRemainAdmin) {
      const { data: memberships, error: adminsError } = await admin
        .from("memberships")
        .select("id, role")
        .eq("tenant_id", tenantId);

      if (adminsError) {
        throw new Error(
          `Unable to count tenant admins: ${adminsError.message}`
        );
      }

      const adminCount = (memberships ?? []).filter((membership) =>
        ADMIN_ROLES.has(String(membership.role))
      ).length;

      if (adminCount <= 1) {
        return NextResponse.json(
          {
            error:
              "You cannot demote the final administrator for this tenant.",
          },
          { status: 409 }
        );
      }
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      throw new Error(
        `Unable to load user profile: ${profileError.message}`
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "The user's TMS profile does not exist." },
        { status: 409 }
      );
    }

    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({
        full_name: fullName || null,
        phone: phone || null,
      })
      .eq("id", userId);

    if (profileUpdateError) {
      throw new Error(
        `Unable to update profile: ${profileUpdateError.message}`
      );
    }

    const { error: membershipUpdateError } = await admin
      .from("memberships")
      .update({
        role,
      })
      .eq("id", targetMembership.id);

    if (membershipUpdateError) {
      throw new Error(
        `Unable to update tenant role: ${membershipUpdateError.message}`
      );
    }

    if (profile.tenant_id === tenantId) {
      const { data: matchingRole, error: roleError } = await admin
        .from("roles")
        .select("id")
        .eq("name", role)
        .maybeSingle();

      if (roleError) {
        throw new Error(
          `Unable to load role: ${roleError.message}`
        );
      }

      if (matchingRole) {
        const { error: profileRoleError } = await admin
          .from("profiles")
          .update({
            role_id: matchingRole.id,
          })
          .eq("id", userId);

        if (profileRoleError) {
          throw new Error(
            `Unable to synchronize profile role: ${profileRoleError.message}`
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      userId,
      tenantId,
      fullName: fullName || null,
      phone: phone || null,
      role,
    });
  } catch (error) {
    console.error("Tenant user update failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update tenant user.",
      },
      { status: 500 }
    );
  }
}