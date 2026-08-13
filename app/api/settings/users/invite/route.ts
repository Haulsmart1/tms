import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_INVITE_ROLES = new Set([
  "admin",
  "staff",
  "driver",
]);

function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://tmswizard.cloud"
  );
}

async function createAuthenticatedClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Supabase public environment variables are missing."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {
                cookieStore.set(
                  name,
                  value,
                  options
                );
              }
            );
          } catch {
            // Existing session cookies are sufficient here.
          }
        },
      },
    }
  );
}

function createAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase server environment variables are missing."
    );
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
) {
  const perPage = 1000;
  let page = 1;

  while (true) {
    const {
      data,
      error,
    } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(
        `Unable to check existing Auth users: ${error.message}`
      );
    }

    const match = data.users.find(
      (candidate) =>
        candidate.email
          ?.trim()
          .toLowerCase() === email
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

export async function POST(
  request: NextRequest
) {
  try {
    // ========================================================
    // 1. Authenticate current TMS user
    // ========================================================

    const authenticatedClient =
      await createAuthenticatedClient();

    const {
      data: { user: currentUser },
      error: authError,
    } =
      await authenticatedClient.auth.getUser();

    if (
      authError ||
      !currentUser
    ) {
      return NextResponse.json(
        {
          error:
            "You must be signed in to invite users.",
        },
        {
          status: 401,
        }
      );
    }

    // ========================================================
    // 2. Validate request
    // ========================================================

    const body =
      (await request.json()) as {
        email?: string;
        role?: string;
        tenantId?: string;
      };

    const email =
      body.email
        ?.trim()
        .toLowerCase() ?? "";

    const tenantId =
      body.tenantId?.trim() ?? "";

    const role =
      body.role
        ?.trim()
        .toLowerCase() || "staff";

    if (
      !email ||
      !isValidEmail(email)
    ) {
      return NextResponse.json(
        {
          error:
            "Enter a valid email address.",
        },
        {
          status: 400,
        }
      );
    }

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "A tenant must be selected.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !ALLOWED_INVITE_ROLES.has(role)
    ) {
      return NextResponse.json(
        {
          error: "Invalid role.",
        },
        {
          status: 400,
        }
      );
    }

    const admin =
      createAdminClient();

    // ========================================================
    // 3. Verify inviter is an admin of selected tenant
    //
    // memberships is intentionally service-role protected.
    // ========================================================

    const {
      data: inviterMembership,
      error: inviterMembershipError,
    } = await admin
      .from("memberships")
      .select(
        "id, tenant_id, user_id, role"
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .eq(
        "user_id",
        currentUser.id
      )
      .maybeSingle();

    if (
      inviterMembershipError
    ) {
      console.error(
        "Inviter membership lookup failed:",
        inviterMembershipError
      );

      return NextResponse.json(
        {
          error:
            "Unable to verify your tenant permissions.",
        },
        {
          status: 500,
        }
      );
    }

    if (!inviterMembership) {
      return NextResponse.json(
        {
          error:
            "You do not belong to the selected tenant.",
        },
        {
          status: 403,
        }
      );
    }

    if (
      ![
        "admin",
        "super_admin",
      ].includes(
        inviterMembership.role
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only a tenant admin can invite users.",
        },
        {
          status: 403,
        }
      );
    }

    // ========================================================
    // 4. Find existing Supabase Auth user
    // ========================================================

    const existingAuthUser =
      await findAuthUserByEmail(
        admin,
        email
      );

    let invitedUserId: string;
    let inviteSent = false;

    if (existingAuthUser) {
      invitedUserId =
        existingAuthUser.id;
    } else {
      // ======================================================
      // 5. Send real Supabase invitation
      // ======================================================

      const redirectTo =
        `${getSiteUrl()}` +
        "/api/auth/callback" +
        "?next=/dashboard";

      const {
        data: inviteData,
        error: inviteError,
      } =
        await admin.auth.admin
          .inviteUserByEmail(
            email,
            {
              redirectTo,

              data: {
                tenant_id:
                  tenantId,

                role,

                invited_by:
                  currentUser.id,
              },
            }
          );

      if (inviteError) {
        console.error(
          "Supabase invitation failed:",
          inviteError
        );

        return NextResponse.json(
          {
            error:
              inviteError.message,
          },
          {
            status: 400,
          }
        );
      }

      if (!inviteData.user?.id) {
        return NextResponse.json(
          {
            error:
              "Supabase created the invitation but did not return a user ID.",
          },
          {
            status: 500,
          }
        );
      }

      invitedUserId =
        inviteData.user.id;

      inviteSent = true;
    }

    // ========================================================
    // 6. IMPORTANT:
    // Ensure PUBLIC.USERS exists before MEMBERSHIPS.
    //
    // memberships.user_id FK -> public.users.id
    // ========================================================

    const {
      data: publicUser,
      error: publicUserReadError,
    } = await admin
      .from("users")
      .select(
        "id, email"
      )
      .eq(
        "id",
        invitedUserId
      )
      .maybeSingle();

    if (
      publicUserReadError
    ) {
      throw new Error(
        `Unable to check public user record: ${publicUserReadError.message}`
      );
    }

    if (!publicUser) {
      const {
        error: publicUserInsertError,
      } = await admin
        .from("users")
        .insert({
          id: invitedUserId,
          email,
        });

      if (
        publicUserInsertError
      ) {
        throw new Error(
          `Unable to create public user record: ${publicUserInsertError.message}`
        );
      }
    } else if (
      publicUser.email !== email
    ) {
      const {
        error: publicUserUpdateError,
      } = await admin
        .from("users")
        .update({
          email,
        })
        .eq(
          "id",
          invitedUserId
        );

      if (
        publicUserUpdateError
      ) {
        throw new Error(
          `Unable to update public user email: ${publicUserUpdateError.message}`
        );
      }
    }

    // ========================================================
    // 7. Ensure profile exists
    // ========================================================

    const {
      data: existingProfile,
      error: profileReadError,
    } = await admin
      .from("profiles")
      .select(
        "id, tenant_id"
      )
      .eq(
        "id",
        invitedUserId
      )
      .maybeSingle();

    if (
      profileReadError
    ) {
      throw new Error(
        `Unable to check profile: ${profileReadError.message}`
      );
    }

    if (!existingProfile) {
      const {
        error: profileInsertError,
      } = await admin
        .from("profiles")
        .insert({
          id: invitedUserId,
          tenant_id: tenantId,
        });

      if (
        profileInsertError
      ) {
        throw new Error(
          `Unable to create profile: ${profileInsertError.message}`
        );
      }
    } else if (
      !existingProfile.tenant_id
    ) {
      const {
        error: profileUpdateError,
      } = await admin
        .from("profiles")
        .update({
          tenant_id:
            tenantId,
        })
        .eq(
          "id",
          invitedUserId
        );

      if (
        profileUpdateError
      ) {
        throw new Error(
          `Unable to link profile to tenant: ${profileUpdateError.message}`
        );
      }
    }

    // ========================================================
    // 8. Ensure membership exists
    //
    // Now safe because public.users exists.
    // ========================================================

    const {
      data: existingMembership,
      error: existingMembershipError,
    } = await admin
      .from("memberships")
      .select(
        "id, role"
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .eq(
        "user_id",
        invitedUserId
      )
      .maybeSingle();

    if (
      existingMembershipError
    ) {
      throw new Error(
        `Unable to check membership: ${existingMembershipError.message}`
      );
    }

    if (
      existingMembership
    ) {
      const {
        error:
          membershipUpdateError,
      } = await admin
        .from("memberships")
        .update({
          role,
        })
        .eq(
          "id",
          existingMembership.id
        );

      if (
        membershipUpdateError
      ) {
        throw new Error(
          `Unable to update membership: ${membershipUpdateError.message}`
        );
      }
    } else {
      const {
        error:
          membershipInsertError,
      } = await admin
        .from("memberships")
        .insert({
          tenant_id:
            tenantId,

          user_id:
            invitedUserId,

          role,
        });

      if (
        membershipInsertError
      ) {
        throw new Error(
          `Unable to create tenant membership: ${membershipInsertError.message}`
        );
      }
    }

    // ========================================================
    // 9. Success
    // ========================================================

    return NextResponse.json(
      {
        ok: true,

        message: inviteSent
          ? `Invite sent to ${email}.`
          : `${email} already had a TMS account and has now been added to this tenant.`,

        inviteSent,

        userId:
          invitedUserId,

        tenantId,

        role,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "User invite API failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to invite user.",
      },
      {
        status: 500,
      }
    );
  }
}