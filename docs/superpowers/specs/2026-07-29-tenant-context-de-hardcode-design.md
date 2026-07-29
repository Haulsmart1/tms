# Tenant context de-hardcode: design

Date: 2026-07-29
Status: approved (brainstorming), pending implementation plan

## Problem

Eleven app pages resolve the tenant the wrong way after the RLS overhaul reseeded
per-company tenants:

- **7 pages hardcode** `const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd"` and use it
  for reads (`.eq("tenant_id", TENANT_ID)`) and writes (`tenant_id: TENANT_ID`):
  `customers`, `drivers`, `jobs`, `invoices`, `subcontractors`, `tracking`, `pod`
  (`pod` also embeds it in a storage file path).
- **4 pages resolve then fall back** to the same hardcoded id via a duplicated
  `resolveTenantId()` + `FALLBACK_TENANT_ID`: `vehicles`, `maintenance`,
  `settings/licences`, `settings/users`.

`2f7cc0dc` is the old shared placeholder tenant that no reseeded user belongs to, so the
deployed app shows nothing (or writes into a dead tenant) for real users. The fallback is now
actively wrong and must be removed, not repointed.

## Goals

- Remove the hardcoded tenant id and the fallback from the codebase entirely.
- Resolve the acting tenant from the signed-in user, once, in one place.
- Give company admins a company-wide view by default, with a selector to filter to a specific
  tenant. Super admins see everything. Staff are locked to their own tenant.
- Guarantee every record creation is stamped with a concrete `tenant_id`, never null, never
  implicit.
- Fail closed everywhere: a missing, broken, or inconsistent profile shows a blocked state and
  never leaks or misfiles data.

## Non-goals (tracked as follow-ups)

- `middleware.ts` auth gate (session refresh + redirect unauthenticated to `/login`). Separate
  follow-up for security week.
- The pod-files storage bucket access policy. This spec only fixes the tenant path prefix.
- Cross-tenant *aggregation* dashboards ("where is performing best"). The selector gives the
  filter primitive; analytics on top is later work.
- Invite flow, settings guards, and the other deferred RLS items.

## Security model

The tenant-isolation boundary is **RLS in Postgres**, not the client and not middleware. Every
RLS decision keys on the database's own view of `auth.uid() -> profiles`, evaluated by
SECURITY DEFINER helpers (`can_access_tenant`, `can_manage_tenant`) that fail closed: a null or
garbage role/tenant/company makes each branch evaluate to `null`/`false`, and RLS denies
anything not `true`. A tampered client cannot cross tenants: `WITH CHECK` rejects a write to a
tenant the user cannot manage, and `USING` hides unreadable rows. The client-side tenant filter
and write id are correctness/UX conveniences, not the security control.

Defense layers, each with one job:

| Layer | Job |
| --- | --- |
| Postgres RLS | The isolation boundary. Fails closed on null/malformed ids. |
| Guard triggers | Block role/tenant/company self-escalation on writes (already live). |
| `get_tenant_context()` RPC | One trusted server-side resolution + integrity check. Returns an explicit invalid status, never a guess. |
| `TenantProvider` (client) | Mirror the DB posture in the UI: blocked state, no fallback, writes disabled when unresolved. |
| `middleware.ts` (follow-up) | Auth/session gate only. Not tenant safety. |

Residual case: a profile whose `tenant_id` points at a tenant in a different company. A user
cannot reach that state (the `guard_profiles_privileged_columns` trigger blocks them from
changing `tenant_id`), and the `get_tenant_context()` integrity check refuses it. Covered from
both ends.

## Architecture

### `get_tenant_context()` RPC (`docs/sql/rls_07_tenant_context.sql`)

A SECURITY DEFINER function that resolves and validates identity in one trusted call and returns
only safe fields. Because it reads `tenants` with definer rights, **no SELECT policy is opened on
`tenants`**.

```sql
create or replace function public.get_tenant_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_company uuid; v_home uuid; v_tenants jsonb;
begin
  if v_uid is null then return jsonb_build_object('status','signed-out'); end if;
  v_role := public.get_my_role();
  v_company := public.get_my_company_id();
  v_home := public.current_tenant_id();

  -- integrity: a non-super must have a home tenant that belongs to their company
  if coalesce(v_role,'') <> 'super_admin'
     and (v_home is null
          or not exists (select 1 from public.tenants t
                         where t.id = v_home and t.company_id = v_company)) then
    return jsonb_build_object('status','no-tenant');
  end if;

  if v_role = 'super_admin' then
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
      into v_tenants from public.tenants t;
  elsif v_role = 'admin' then
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
      into v_tenants from public.tenants t where t.company_id = v_company;
  else
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      into v_tenants from public.tenants t where t.id = v_home;
  end if;

  return jsonb_build_object('status','ready',
    'role', case when v_role = 'super_admin' then 'super_admin'
                 when v_role = 'admin' then 'admin' else 'staff' end,
    'company_id', v_company, 'home_tenant_id', v_home, 'tenants', coalesce(v_tenants,'[]'::jsonb));
end $$;

revoke all on function public.get_tenant_context() from public;
grant execute on function public.get_tenant_context() to authenticated;
```

Statuses returned: `signed-out` (no session), `no-tenant` (missing or company-mismatched home
tenant for a non-super), `ready` (valid context). The `role` is normalized to exactly
`staff` | `admin` | `super_admin`, so any other role name (e.g. a `tenant` role, or a null role)
is treated as staff and gets the home-tenant-only list. Ethan runs this in the Supabase SQL
editor.

### `TenantProvider` (`app/components/TenantProvider.tsx`)

One job: resolve "who is this user, which tenants can they act in, which is active" exactly once
and hand it to everything via a `useTenant()` hook. Nothing else in the app resolves tenancy.

On mount it calls `supabase.rpc("get_tenant_context")` once, then holds the `activeTenantId`
(persisted to `localStorage`, keyed by user id so a different account never inherits a stale
selection). It restores a persisted selection only if it is still a valid option.

`useTenant()` returns:

```ts
{
  status: "loading" | "ready" | "signed-out" | "no-tenant",
  role: "staff" | "admin" | "super_admin",
  tenants: { id: string; name: string }[],   // staff: just their own
  activeTenantId: string | null,             // null === "All tenants" (admin/super only)
  setActiveTenantId: (id: string | null) => void,
  writeTenantId: string | null,              // tenant to stamp on inserts (null when "All")
  filterByTenant: <T>(query: T) => T,        // adds .eq("tenant_id", active) unless "All"
}
```

Behaviours:

- **Staff** are locked to `home_tenant_id`. No selector. `activeTenantId` never changes,
  `writeTenantId` is always their tenant.
- **Admin / super** default to `activeTenantId = null` ("All tenants"), landing on the
  company-wide view.
- **No fallback tenant.** `signed-out` and `no-tenant` are surfaced as blocked states; the old
  `2f7cc0dc` fallback is deleted.

### `TenantSelector` (`app/components/TenantSelector.tsx`)

Rendered inside `AppHeader`, only when `role !== "staff"`. Options: "All tenants" (`null`) then
one entry per tenant, sorted by name. Bound to `activeTenantId` / `setActiveTenantId`.

### `TenantGate` (`app/components/TenantGate.tsx`)

A shared wrapper the 11 data pages opt into so the fail-closed UI is written once:

- `loading` -> spinner
- `signed-out` -> redirect to `/login`
- `no-tenant` -> "your account isn't linked to a company, contact an admin" panel
- `ready` -> render children

Public routes (`/`, `/login`, `/super-admin`) do not use the gate; the provider resolves to
`signed-out` there harmlessly.

## Read / write semantics

- **Reads:** every former `.eq("tenant_id", TENANT_ID)` becomes `tenant.filterByTenant(query)`.
  Specific tenant active -> `.eq("tenant_id", activeTenantId)`. "All" active -> no client filter,
  RLS scopes the result (admin -> company, super -> everything). Staff always specific.
- **Writes:** every `tenant_id: TENANT_ID` becomes `tenant_id: tenant.writeTenantId`. When "All"
  is active, `writeTenantId` is null and create is disabled with an inline hint
  ("pick a specific tenant to create records"). Each create handler also early-returns if
  `writeTenantId` is null. Writing is never defaulted to the home tenant, to avoid silently
  misfiling into one depot while viewing the company-wide list.
- **Create invariant:** every creation carries a concrete `tenant_id`, enforced at three layers:
  UI disables create on "All"; the handler early-returns on null; `tenant_id` is `NOT NULL` with
  RLS `WITH CHECK` rejecting any tenant the user cannot write.

## Per-page changes

Uniform transformation on all 11 pages:

- Delete `const TENANT_ID = "2f7cc0dc..."` (Class-A) and the `FALLBACK_TENANT_ID` + local
  `resolveTenantId()` (Class-B).
- Add `const tenant = useTenant();` and wrap the page body in `<TenantGate>`.
- Reads -> `tenant.filterByTenant(...)`; writes -> `tenant_id: tenant.writeTenantId`.

Special cases:

- **`pod/page.tsx:136`** storage path `${TENANT_ID}/${stopId}/...` -> `${tenant.writeTenantId}/...`.
  Reachable only when a specific tenant is active. Bucket policy stays deferred.
- **Admin-write pages** (`drivers`; `vehicles` create/delete): staff see create/delete disabled
  via an `isAdmin` check instead of hitting an RLS rejection. `vehicles`' staff "toggle active"
  path is unchanged.
- **`tracking`** is read-only: filter only.

## Files touched

New:

- `app/components/TenantProvider.tsx`
- `app/components/TenantSelector.tsx`
- `app/components/TenantGate.tsx`
- `docs/sql/rls_07_tenant_context.sql`

Modified:

- `app/layout.tsx` (wrap `AppHeader` + children in `<TenantProvider>`)
- `app/components/AppHeader.tsx` (drop its own identity fetch, consume `useTenant()`, render the
  selector)
- 11 pages: `customers`, `drivers`, `jobs`, `invoices`, `subcontractors`, `tracking`, `pod`,
  `maintenance`, `vehicles`, `settings/licences`, `settings/users`

## Verification

- Build/type passes. `grep 2f7cc0dc` and `grep FALLBACK_TENANT_ID` return zero hits in `app/`
  and `lib/` (the reseed SQL comment may still reference the placeholder; that is fine).
- Functional matrix:
  - Staff: sees only their tenant on every page, no selector, create stamps their tenant.
  - Admin: "All tenants" default shows company-wide; selecting a tenant filters; create disabled
    on "All", enabled and stamps the chosen tenant when specific.
  - Super: sees all tenants; selector lists all.
  - Blocked profile: `no-tenant` panel, no data, create disabled.
- RLS backstop (already proven by the `rls_09` harness) plus one added probe: a write with a
  foreign `tenant_id` is rejected by `WITH CHECK`.
- Adversarial review workflow over this spec, then over the implementation, hunting tenant-leak
  holes (security week).

## Dependencies / order

1. Ethan runs `rls_07_tenant_context.sql` in Supabase.
2. Build `TenantProvider` / `TenantSelector` / `TenantGate`, wire into `layout.tsx` and
   `AppHeader`.
3. Convert the 11 pages.
4. Verify (matrix + grep + build), then the adversarial pass.
