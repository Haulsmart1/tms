import { NextResponse } from "next/server";
import { createClient } from "../supabase/server";
import { SUPER_ADMIN_ROLE, extractRoleName } from "../roles";

/* The one super-admin check, shared by app/super-admin/layout.tsx and every
   /api/super-admin route. Two copies of an authorization rule drift; this is
   the reason the layout was refactored to call it rather than inline its own. */

export type Denial = { status: 401 | 403; error: string };

/* Pure, so the rule itself is testable without a session. */
export function superAdminDenial(
  userId: string | null | undefined,
  roleName: string | null,
): Denial | null {
  if (!userId) return { status: 401, error: "You must be signed in." };
  if (roleName !== SUPER_ADMIN_ROLE) {
    return { status: 403, error: "Super admin access is required." };
  }
  return null;
}

export type SuperAdminSession = { userId: string; roleName: string | null };

/* Resolves the caller from cookies and reads their role. Reads go through the
   USER's client, not the service role: RLS lets a user read their own profile,
   so no elevated key is needed to answer "who is this". */
export async function resolveSuperAdmin(): Promise<SuperAdminSession> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { userId: "", roleName: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles ( name )")
    .eq("id", user.id)
    .single();

  return { userId: user.id, roleName: extractRoleName(profile?.roles) };
}

/* Route-handler form. Returns either the caller's id or a ready NextResponse.
   The JSON shape matches proxy.ts's { error } so a fetch() sees one shape. */
export async function requireSuperAdmin(): Promise<
  { userId: string; response?: undefined } | { userId?: undefined; response: NextResponse }
> {
  const session = await resolveSuperAdmin();
  const denial = superAdminDenial(session.userId || null, session.roleName);

  if (denial) {
    return {
      response: NextResponse.json({ error: denial.error }, { status: denial.status }),
    };
  }

  return { userId: session.userId };
}

/* Audit trail, such as it is. Field NAMES only, never values: an edit log that
   records postcodes and phone numbers accumulates customer PII in a place
   nobody is auditing for it. A super_admin_audit table is the follow-up. */
export function logSuperAdminEdit(args: {
  actorId: string;
  action: string;
  targetId: string;
  changedFields: readonly string[];
}) {
  console.log(
    JSON.stringify({
      event: "super_admin_edit",
      action: args.action,
      actor_id: args.actorId,
      target_id: args.targetId,
      changed_fields: args.changedFields,
      at: new Date().toISOString(),
    }),
  );
}
