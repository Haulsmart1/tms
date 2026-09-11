import { extractRoleName } from "../roles";

/* Joins the three super-admin /api/super-admin/users reads (profiles,
   tenants, companies) plus the auth.users email map into the rows the users
   page renders. Pulled out of the route so it can be unit tested at all:
   vitest only reaches lib/, and the legacy tenant_id-holds-a-company-id
   fallback below is a data quirk that exists nowhere else in code and is
   invisible from the schema, which makes it exactly the kind of logic that
   needs a test rather than a read-through. */

export type ProfileForJoin = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  roles: { name: string }[] | { name: string } | null;
};

export type TenantForJoin = {
  id: string;
  name: string | null;
  company_id: string | null;
};

export type CompanyForJoin = {
  id: string;
  name: string | null;
};

export type SuperAdminUserRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  tenantId: string | null;
  tenantName: string | null;
  companyId: string | null;
  companyName: string | null;
};

export function buildUserRows(args: {
  profiles: readonly ProfileForJoin[];
  tenants: readonly TenantForJoin[];
  companies: readonly CompanyForJoin[];
  emailById: ReadonlyMap<string, string | null>;
}): SuperAdminUserRow[] {
  const { profiles, tenants, companies, emailById } = args;

  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const rows = profiles.map((profile) => {
    const tenant = profile.tenant_id ? tenantById.get(profile.tenant_id) : null;

    /* A profile's tenant_id sometimes holds a company id directly, on rows
       written before tenants existed. Falling back that way is what stops
       those users rendering with a blank company. */
    const companyId =
      tenant?.company_id ??
      (profile.tenant_id && companyById.has(profile.tenant_id) ? profile.tenant_id : null);

    return {
      id: profile.id,
      email: emailById.get(profile.id) ?? null,
      fullName: profile.full_name,
      role: extractRoleName(profile.roles),
      tenantId: profile.tenant_id,
      tenantName: tenant?.name ?? null,
      companyId,
      companyName: companyId ? companyById.get(companyId)?.name ?? null : null,
    };
  });

  /* profiles drives this join, so an auth.users row with no profiles row is
     otherwise invisible in the result. That is not hypothetical:
     app/api/settings/users/invite/route.ts creates the auth user first and
     only then does separate, non-transactional inserts into users, profiles
     and memberships, with no rollback and no deleteUser cleanup if one of
     those throws. A half-completed invite leaves exactly this orphan, and an
     admin diagnostic that hides broken accounts is worse than no tool. These
     rows carry only an id and email; Task 14's page renders the email as the
     display name for them. */
  const seenProfileIds = new Set(profiles.map((profile) => profile.id));
  const orphanRows: SuperAdminUserRow[] = [];
  for (const [id, email] of emailById) {
    if (seenProfileIds.has(id)) continue;
    orphanRows.push({
      id,
      email,
      fullName: null,
      role: null,
      tenantId: null,
      tenantName: null,
      companyId: null,
      companyName: null,
    });
  }

  return [...rows, ...orphanRows];
}
