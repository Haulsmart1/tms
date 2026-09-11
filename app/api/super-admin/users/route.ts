import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { withSuperAdmin } from "../../../../lib/superAdmin/guard";
import { extractRoleName } from "../../../../lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Exists for exactly one reason: email lives in auth.users, which no RLS policy
   exposes to the browser, and a user whose full_name is null is otherwise
   identified only by a UUID. Everything else here could have stayed a client
   query; keeping it in one place means the page makes one request, not four. */

type ProfileRow = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  created_at: string | null;
  roles: { name: string }[] | { name: string } | null;
};

/* withSuperAdmin, not a manual requireSuperAdmin check. This handler never
   reads the actor id, so with the manual form, deleting the check would still
   typecheck and would hand an anonymous caller the service-role client. The
   wrapper has no code path into the handler that skips the check. */
export const GET = withSuperAdmin(async () => {
  const admin = createAdminClient();

  const [
    { data: profiles, error: profilesError },
    { data: tenants, error: tenantsError },
    { data: companies, error: companiesError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, tenant_id, full_name, created_at, roles ( name )")
      .order("created_at", { ascending: false }),
    admin.from("tenants").select("id, name, company_id"),
    admin.from("companies").select("id, name"),
  ]);

  // Supabase error messages can name tables and columns, which is
  // implementation detail a client has no business seeing. Log the real
  // error for whoever reads the server logs and send back something generic.
  if (profilesError || tenantsError || companiesError) {
    console.error(
      "super-admin users lookup failed:",
      profilesError ?? tenantsError ?? companiesError,
    );
    return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
  }

  /* listUsers is paginated and caps out at 1000 per page, so a single call
     silently truncates once the platform passes that. Paging here keeps the
     list honest rather than quietly dropping the oldest accounts. The 20-page
     ceiling (20000 users) is a safety valve against an infinite loop if the
     API ever stopped reporting a short final page; the platform is nowhere
     near that scale today. */
  const emailById = new Map<string, string | null>();
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("super-admin users listUsers failed:", error);
      return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
    }
    for (const user of data.users) emailById.set(user.id, user.email ?? null);
    if (data.users.length < perPage) break;
  }

  const tenantById = new Map((tenants ?? []).map((t) => [t.id as string, t]));
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c]));

  const rows = ((profiles ?? []) as ProfileRow[]).map((profile) => {
    const tenant = profile.tenant_id ? tenantById.get(profile.tenant_id) : null;

    /* A profile's tenant_id sometimes holds a company id directly, on rows
       written before tenants existed. Falling back that way is what stops
       those users rendering with a blank company. */
    const companyId =
      (tenant?.company_id as string | null | undefined) ??
      (profile.tenant_id && companyById.has(profile.tenant_id) ? profile.tenant_id : null);

    return {
      id: profile.id,
      email: emailById.get(profile.id) ?? null,
      fullName: profile.full_name,
      role: extractRoleName(profile.roles),
      tenantId: profile.tenant_id,
      tenantName: (tenant?.name as string | null | undefined) ?? null,
      companyId: companyId ?? null,
      companyName: companyId ? (companyById.get(companyId)?.name as string | null) ?? null : null,
      createdAt: profile.created_at,
    };
  });

  return NextResponse.json({ users: rows });
});
