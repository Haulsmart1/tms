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
            // Existing session cookies are enough
            // for this API route.
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

export async function POST(
  request: NextRequest
) {
  try {
    // --------------------------------------------------------
    // 1. Authenticate the caller using their normal session.
    // --------------------------------------------------------

    const authenticatedClient =
      await createAuthenticatedClient();

    const {
      data: { user },
      error: authError,
    } =
      await authenticatedClient.auth.getUser();

    if (authError || !user) {
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

    // --------------------------------------------------------
    // 2. Validate request body.
    // --------------------------------------------------------

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

    if (!email || !isValidEmail(email)) {
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

    // --------------------------------------------------------
    // 3. Create service-role client.
    //
    // memberships is deliberately not readable directly by
    // authenticated users, so the server performs the check.
    // --------------------------------------------------------

    const admin =
      createAdminClient();

    // --------------------------------------------------------
    // 4. Verify caller belongs to this tenant and is admin.
    // --------------------------------------------------------

    const {
      data: inviterMembership,
      error: inviterMembershipError,
    } = await admin
      .from("memberships")
      .select(
        "id, tenant_id, user_id, role"
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (inviterMembershipError) {
      console.error(
        "Invite membership lookup failed:",
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

    // --------------------------------------------------------
    // 5. Check whether the email already belongs to an Auth
    // user.
    //
    // Supabase's admin list endpoint is paginated, so search
    // through the returned users.
    // --------------------------------------------------------

    let existingAuthUserId:
      | string
      | null = null;

    let page = 1;
    const perPage = 1000;

    while (
      existingAuthUserId === null
    ) {
      const {
        data: userPage,
        error: listUsersError,
      } =
        await admin.auth.admin.listUsers({
          page,
          perPage,
        });

      if (listUsersError) {
        throw new Error(
          `Unable to check existing users: ${listUsersError.message}`
        );
      }

      const matchingUser =
        userPage.users.find(
          (candidate) =>
            candidate.email
              ?.trim()
              .toLowerCase() === email
        );

      if (matchingUser) {
        existingAuthUserId =
          matchingUser.id;
        break;
      }

      if (
        userPage.users.length <
        perPage
      ) {
        break;
      }

      page += 1;
    }

    let invitedUserId: string;
    let inviteWasSent = false;

    // --------------------------------------------------------
    // 6A. Existing Auth account:
    // do not send another new-user invitation.
    // --------------------------------------------------------

    if (existingAuthUserId) {
      invitedUserId =
        existingAuthUserId;
    } else {
      // ------------------------------------------------------
      // 6B. New Auth account:
      // send a real Supabase invitation.
      // ------------------------------------------------------

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
                  user.id,
              },
            }
          );

      if (inviteError) {
        console.error(
          "Supabase invite failed:",
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
              "Supabase sent the invitation but did not return a user ID.",
          },
          {
            status: 500,
          }
        );
      }

      invitedUserId =
        inviteData.user.id;

      inviteWasSent = true;
    }

    // --------------------------------------------------------
    // 7. Check existing tenant membership.
    // --------------------------------------------------------

    const {
      data: existingMembership,
      error:
        existingMembershipError,
    } = await admin
      .from("memberships")
      .select("id, role")
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
        `Unable to check invited user's membership: ${existingMembershipError.message}`
      );
    }

    // --------------------------------------------------------
    // 8. Create or update membership.
    // --------------------------------------------------------

    if (existingMembership) {
      const {
        error:
          updateMembershipError,
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
        updateMembershipError
      ) {
        throw new Error(
          `Unable to update tenant membership: ${updateMembershipError.message}`
        );
      }
    } else {
      const {
        error:
          insertMembershipError,
      } = await admin
        .from("memberships")
        .insert({
          tenant_id: tenantId,
          user_id:
            invitedUserId,
          role,
        });

      if (
        insertMembershipError
      ) {
        throw new Error(
          `Unable to create tenant membership: ${insertMembershipError.message}`
        );
      }
    }

    // --------------------------------------------------------
    // 9. Ensure profiles row exists / has a tenant.
    //
    // Do not overwrite an existing tenant_id because a user
    // may eventually belong to more than one tenant.
    // --------------------------------------------------------

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

    if (profileReadError) {
      throw new Error(
        `Unable to check invited user's profile: ${profileReadError.message}`
      );
    }

    if (!existingProfile) {
      const {
        error:
          profileInsertError,
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
          `Unable to create invited user's profile: ${profileInsertError.message}`
        );
      }
    } else if (
      !existingProfile.tenant_id
    ) {
      const {
        error:
          profileUpdateError,
      } = await admin
        .from("profiles")
        .update({
          tenant_id: tenantId,
        })
        .eq(
          "id",
          invitedUserId
        );

      if (
        profileUpdateError
      ) {
        throw new Error(
          `Unable to link invited user's profile to the tenant: ${profileUpdateError.message}`
        );
      }
    }

    // --------------------------------------------------------
    // 10. Return success.
    // --------------------------------------------------------

    return NextResponse.json(
      {
        ok: true,

        message: inviteWasSent
          ? `Invite sent to ${email}.`
          : `${email} already had a TMS account and has now been added to this tenant.`,

        userId:
          invitedUserId,

        tenantId,

        role,

        inviteSent:
          inviteWasSent,
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