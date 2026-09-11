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

export type SuperAdminSession = { userId: string | null; roleName: string | null };

/* Resolves the caller from cookies and reads their role. Reads go through the
   USER's client, not the service role: RLS lets a user read their own profile,
   so no elevated key is needed to answer "who is this".

   userId is typed string | null rather than defaulted to "" for a signed-out
   caller. A truthiness check treats "" and null the same, but a later,
   stricter rewrite of superAdminDenial's caller (say, `if (userId == null)`)
   would treat "" as present and turn a signed-out caller into an allow. Not
   having the sentinel in the type at all is what makes that mistake
   impossible to write rather than merely unlikely. */
export async function resolveSuperAdmin(): Promise<SuperAdminSession> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { userId: null, roleName: null };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("roles ( name )")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // A signed-in caller whose profile lookup failed for infrastructure
    // reasons (RLS misconfigured, a connection blip) gets denied the same
    // as a genuine non-super-admin, and that is the right call: fail closed
    // either way. Warn anyway, so the outage shows up somewhere instead of
    // looking identical to an ordinary 403 in the logs.
    console.warn("super-admin profile lookup failed", error);
  }

  return { userId: user.id, roleName: extractRoleName(profile?.roles) };
}

/* Route-handler form. Returns either the caller's id or a ready NextResponse.
   The JSON shape matches proxy.ts's { error } so a fetch() sees one shape.

   Task 16's layout needs the raw session (it redirects rather than returning
   JSON), so this stays exported alongside withSuperAdmin below instead of
   being replaced by it. */
export async function requireSuperAdmin(): Promise<
  { userId: string; response?: undefined } | { userId?: undefined; response: NextResponse }
> {
  const session = await resolveSuperAdmin();
  const denial = superAdminDenial(session.userId, session.roleName);

  if (denial) {
    return {
      response: NextResponse.json({ error: denial.error }, { status: denial.status }),
    };
  }

  // superAdminDenial only returns null when userId is truthy, so a null
  // userId never reaches this line: it falls through the !userId branch and
  // returns a denial above instead.
  return { userId: session.userId as string };
}

/* Wraps a route handler so the check cannot be forgotten. requireSuperAdmin's
   union only protects a route that actually reads userId in a string
   position: a read-only GET that checks `response` and then goes straight to
   createAdminClient() never touches userId, so deleting the check compiles
   clean and hands an anonymous caller the service-role key. A route written
   as withSuperAdmin(handler) has no code path into the handler that skips
   the check, because the wrapper is the only way in. */
export function withSuperAdmin<T extends unknown[]>(
  handler: (actorId: string, ...args: T) => Promise<NextResponse>,
): (...args: T) => Promise<NextResponse> {
  return async (...args: T) => {
    const result = await requireSuperAdmin();
    if (result.response) return result.response;
    return handler(result.userId, ...args);
  };
}

/* Pure half of the audit line: builds the JSON string with no I/O, so its
   contract (exactly these fields, changed_fields holding names and nothing
   else) can be asserted directly without mocking console. */
export function superAdminEditLine(args: {
  actorId: string;
  action: string;
  targetId: string;
  changedFields: readonly string[];
  result: "ok" | "partial";
}): string {
  return JSON.stringify({
    event: "super_admin_edit",
    action: args.action,
    actor_id: args.actorId,
    target_id: args.targetId,
    changed_fields: args.changedFields,
    result: args.result,
    at: new Date().toISOString(),
  });
}

/* Audit trail, such as it is. This lands in Vercel's runtime logs, which are
   a short rolling buffer and not queryable after the fact: a breadcrumb, not
   a durable audit trail. A super_admin_audit table is the follow-up that
   would make it one.

   Field NAMES only, never values: an edit log that records postcodes and
   phone numbers accumulates customer PII in a place nobody is auditing for
   it. `result` is explicit at the call site, not inferred, so a partial
   write (the company name lands but the linked profile write fails) still
   gets logged instead of falling through an early return unaudited. */
export function logSuperAdminEdit(args: {
  actorId: string;
  action: string;
  targetId: string;
  changedFields: readonly string[];
  result: "ok" | "partial";
}) {
  console.log(superAdminEditLine(args));
}
