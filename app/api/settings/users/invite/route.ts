import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_INVITE_ROLES = new Set(["admin", "staff", "driver"]);

function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://tmswizard.cloud"
  );
}

async function createUserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase public environment variables are missing.");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, anonKey, {
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
          // Route can still authenticate from existing cookies.
        }
      },
    },
  });
}

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const userClient = await createUserClient();

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in to invite users." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      email?: string;
      role?: string;
      tenantId?: string;
    };

    const email = body.email?.trim().toLowerCase();
    const tenantId = body.tenantId?.trim();
    const role = body.role?.trim().toLowerCase() || "staff";

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 }
      );
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: "A tenant must be selected." },
        { status: 400 }
      );
    }

    if (!ALLOWED_INVITE_ROLES.has(role)) {
      return NextResponse.json(
        { error: "Invalid role." },
        { status: 400 }
      );
    }

    // The inviter must already be an admin/super_admin in this exact tenant.
    const { data: inviterMembership, error: membershipError } =
      await userClient
        .from("memberships")
        .select("id, role")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    if (
      !inviterMembership ||
      !["admin", "super_admin"].includes(inviterMembership.role)
    ) {
      return NextResponse.json(
        { error: "Only a tenant admin can invite users." },
        { status: 403 }
      );
    }

    const admin = createAdminClient();
    const redirectTo =
      `${getSiteUrl()}/api/auth/callback?next=/dashboard`;

    const { data: inviteData, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          tenant_id: tenantId,
          role,
          invited_by: user.id,
        },
      });

    if (inviteError) {
      const lowerMessage = inviteError.message.toLowerCase();

      if (
        lowerMessage.includes("already") &&
        (lowerMessage.includes("registered") ||
          lowerMessage.includes("exists"))
      ) {
        return NextResponse.json(
          {
            error:
              "That email already has a TMS account. Add the existing user to this tenant instead of sending a new-user invite.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: inviteError.message },
        { status: 400 }
      );
    }

    const invitedUser = inviteData.user;

    if (!invitedUser?.id) {
      return NextResponse.json(
        { error: "Supabase sent the invite but did not return a user ID." },
        { status: 500 }
      );
    }

    // Avoid duplicate membership rows if this endpoint is retried.
    const { data: existingMembership, error: existingMembershipError } =
      await admin
        .from("memberships")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", invitedUser.id)
        .maybeSingle();

    if (existingMembershipError) {
      return NextResponse.json(
        {
          error:
            `Invite was sent, but membership lookup failed: ${existingMembershipError.message}`,
        },
        { status: 500 }
      );
    }

    if (!existingMembership) {
      const { error: insertMembershipError } = await admin
        .from("memberships")
        .insert({
          tenant_id: tenantId,
          user_id: invitedUser.id,
          role,
        });

      if (insertMembershipError) {
        return NextResponse.json(
          {
            error:
              `Invite was sent, but tenant membership could not be created: ${insertMembershipError.message}`,
          },
          { status: 500 }
        );
      }
    } else {
      const { error: updateMembershipError } = await admin
        .from("memberships")
        .update({ role })
        .eq("id", existingMembership.id);

      if (updateMembershipError) {
        return NextResponse.json(
          {
            error:
              `Invite was sent, but membership role could not be updated: ${updateMembershipError.message}`,
          },
          { status: 500 }
        );
      }
    }

    // Keep profiles compatible with the existing app without overriding
    // an already-linked tenant for a user who may belong to multiple tenants.
    const { data: profile, error: profileReadError } = await admin
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", invitedUser.id)
      .maybeSingle();

    if (profileReadError) {
      return NextResponse.json(
        {
          error:
            `Invite and membership succeeded, but profile lookup failed: ${profileReadError.message}`,
        },
        { status: 500 }
      );
    }

    if (!profile) {
      const { error: profileInsertError } = await admin
        .from("profiles")
        .insert({
          id: invitedUser.id,
          tenant_id: tenantId,
        });

      if (profileInsertError) {
        return NextResponse.json(
          {
            error:
              `Invite and membership succeeded, but profile creation failed: ${profileInsertError.message}`,
          },
          { status: 500 }
        );
      }
    } else if (!profile.tenant_id) {
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({ tenant_id: tenantId })
        .eq("id", invitedUser.id);

      if (profileUpdateError) {
        return NextResponse.json(
          {
            error:
              `Invite and membership succeeded, but profile tenant linking failed: ${profileUpdateError.message}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Invite sent to ${email}.`,
      userId: invitedUser.id,
      tenantId,
      role,
    });
  } catch (error) {
    console.error("User invite API failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to invite user.",
      },
      { status: 500 }
    );
  }
}
