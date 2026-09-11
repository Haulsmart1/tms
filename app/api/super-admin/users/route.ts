import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { withSuperAdmin } from "../../../../lib/superAdmin/guard";
import { buildUserRows, type ProfileForJoin } from "../../../../lib/superAdmin/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Exists for exactly one reason: email lives in auth.users, which no RLS policy
   exposes to the browser, and a user whose full_name is null is otherwise
   identified on screen only by a UUID. Everything else here could have stayed a
   client query; keeping it in one place means the page makes one request, not four. */

/* withSuperAdmin, not a manual resolveSuperAdmin/superAdminDenial check
   inlined here. This handler never reads the actor id, so with a manual
   check, deleting it would still typecheck and would hand an anonymous
   caller the service-role client. The wrapper has no code path into the
   handler that skips the check. */
export const GET = withSuperAdmin(async () => {
  // createAdminClient() throws when SUPABASE_SERVICE_ROLE_KEY is missing.
  // Left uncaught, Next's boundary turns that into its own HTML error page
  // instead of JSON, which breaks the one-shape-of-error contract this route
  // otherwise holds and makes the page's response.json() throw on a server
  // that was in fact reached, just misconfigured. The thrown message names
  // env var keys, not values, so it is safe to log.
  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("super-admin users: Supabase admin client unavailable", err);
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  /* The three tables are read separately, not as one embedded PostgREST
     select, because the legacy fallback below has to probe `companies` by a
     tenant_id that turned out not to be a tenant at all, which an embedded
     select cannot express: there is no way to ask PostgREST to join a column
     against "whichever of two tables this id belongs to". Collapsing this
     into one query would look like a tidy-up but would silently delete that
     fallback.

     listUsers is started in the same Promise.all rather than after these
     reads: it does not depend on their results, and serialising it behind
     three table reads means waiting through several sequential GoTrue round
     trips for nothing once the platform has a few thousand users. */
  const [profilesResult, tenantsResult, companiesResult, emailById] = await Promise.all([
    // Deliberately unbounded: no .range() or .limit(). This is the
    // authoritative set of platform users, and it depends on PostgREST's
    // db-max-rows staying unset for this project. listUsers below is
    // carefully paged because auth.users has no such guarantee; if
    // db-max-rows is ever configured, this select needs the same treatment
    // or users will silently disappear from the super-admin view with no
    // error to say why.
    admin
      .from("profiles")
      .select("id, tenant_id, full_name, roles ( name )")
      .order("created_at", { ascending: false, nullsFirst: false }),
    admin.from("tenants").select("id, name, company_id"),
    admin.from("companies").select("id, name"),
    listAllUserEmails(admin),
  ]);

  if (profilesResult.error || tenantsResult.error || companiesResult.error) {
    // Supabase error messages can name tables and columns, which is
    // implementation detail a client has no business seeing. Log the real
    // error for whoever reads the server logs and send back something generic.
    console.error(
      "super-admin users lookup failed:",
      profilesResult.error ?? tenantsResult.error ?? companiesResult.error,
    );
    return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
  }

  if (emailById instanceof Error) {
    console.error("super-admin users listUsers failed:", emailById);
    return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
  }

  const rows = buildUserRows({
    profiles: (profilesResult.data ?? []) as ProfileForJoin[],
    tenants: tenantsResult.data ?? [],
    companies: companiesResult.data ?? [],
    emailById,
  });

  return NextResponse.json({ users: rows });
});

/* listUsers is paginated and caps out at 1000 per page, so a single call
   silently truncates once the platform passes that. Paging here keeps the
   list honest rather than quietly dropping the oldest accounts. The 20-page
   ceiling (20000 users) is a safety valve against an infinite loop if the
   API ever stopped reporting a short final page; the platform is nowhere
   near that scale today.

   Returns a Map on success or an Error on failure, rather than the usual
   { data, error } shape, so it can sit next to the three PostgREST reads in
   one Promise.all and still be told apart by the caller afterwards. */
async function listAllUserEmails(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string | null> | Error> {
  const emailById = new Map<string, string | null>();
  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return error;
    for (const user of data.users) emailById.set(user.id, user.email ?? null);
    if (data.users.length < perPage) break;
  }

  return emailById;
}
