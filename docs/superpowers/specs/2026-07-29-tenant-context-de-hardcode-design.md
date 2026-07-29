# Tenant context de-hardcode: design

Date: 2026-07-29
Status: approved (brainstorming), revised after adversarial review, pending implementation plan

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
  implicit, and never let an edit relocate a record to another tenant.
- Fail closed everywhere: a missing, broken, or inconsistent profile shows a blocked state and
  never leaks or misfiles data.

## Non-goals (tracked as follow-ups)

- **`pod-files` storage bucket lockdown (HIGH priority, this week, its own spec).** The bucket is
  currently public (`getPublicUrl`, `upsert:true`) and storage objects are not governed by the
  public-schema RLS this design leans on, so POD photos/documents are world-readable by URL and
  any authenticated user can upload or overwrite under any tenant's path prefix. This is a live
  cross-tenant leak that predates and is independent of this work. This spec does NOT fix it and
  does NOT claim the path prefix provides isolation; it only makes POD paths use the correct
  per-row tenant so they are already right when the bucket is locked down. The lockdown (private
  bucket + `storage.objects` tenant policies parsing the first path segment + `createSignedUrl` +
  a harness probe) is a named companion task.
- `middleware.ts` auth gate (session refresh + redirect unauthenticated to `/login`). Separate
  follow-up for security week.
- Cross-tenant *aggregation* dashboards ("where is performing best"). The selector gives the
  filter primitive; analytics on top is later work.
- `defect_reports` / `driver_work_rules` NOT NULL on `tenant_id` (nullable today, but out of the
  11-page scope; the `rls_08` helper hardening already closes the null-write path for them).
- Invite flow, settings guards, and the other deferred RLS items.

## Security model

The tenant-isolation boundary is **RLS in Postgres**, not the client and not middleware. Every
RLS decision keys on the database's own view of `auth.uid() -> profiles`, evaluated by
SECURITY DEFINER helpers (`can_access_tenant`, `can_manage_tenant`) that fail closed: a null or
garbage role/tenant/company makes each branch evaluate to `null`/`false`, and RLS denies
anything not `true`. A tampered client cannot cross tenants for an ordinary user: `WITH CHECK`
rejects a write to a tenant the user cannot manage, and `USING` hides unreadable rows. The
client-side tenant filter and write id are correctness/UX conveniences, not the security control.

**One boundary the design does not cross by itself: `super_admin` writes.** `can_manage_tenant`
and `can_access_tenant` short-circuit to `true` for a super_admin for any argument, so RLS never
constrains which tenant a super writes to. Every super write therefore relies on client
correctness plus the DB constraints below, not on RLS. This is why the create/edit rules and
`rls_08` matter.

Defense layers, each with one job:

| Layer | Job |
| --- | --- |
| Postgres RLS | The isolation boundary for non-super users. Fails closed on null/malformed ids. |
| Guard triggers | Block role/tenant/company self-escalation on writes (already live). |
| `rls_08` hardening | Helpers reject a null target for every role incl super; `drivers.tenant_id` set NOT NULL. Closes the null-write footgun at the DB. |
| `get_tenant_context()` RPC | One trusted server-side resolution + integrity check. Returns an explicit invalid status, never a guess. |
| `TenantProvider` | Mirror the DB posture in the UI: blocked state, no fallback, writes disabled when unresolved, re-resolve on auth change. |
| Create/edit rules | Inserts stamp a specific tenant; updates never touch `tenant_id`; existing-row ops use the row's own tenant. Bounds super writes too. |
| `middleware.ts` (follow-up) | Auth/session gate only. Not tenant safety. |

Residual case: a profile whose `tenant_id` points at a tenant in a different company. A user
cannot reach that state (the `guard_profiles_privileged_columns` trigger blocks them from
changing `tenant_id`), and the `get_tenant_context()` integrity check refuses it. Covered from
both ends.

## Architecture

### `rls_08_null_write_hardening.sql` (new, Ethan runs it)

Closes the null / super_admin write footgun surfaced by the review. Safe to re-run.

```sql
-- (a) Helpers reject a null target for EVERY role, incl super_admin, so a null tenant_id can
--     never pass WITH CHECK nor be read back.
create or replace function public.can_access_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select target_tenant is not null and (
    public.get_my_role() = 'super_admin'
    or target_tenant = public.current_tenant_id()
    or (public.get_my_role() = 'admin'
        and target_tenant in (select t.id from public.tenants t
                              where t.company_id = public.get_my_company_id())));
$$;

create or replace function public.can_manage_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select target_tenant is not null and (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and target_tenant in (select t.id from public.tenants t
                              where t.company_id = public.get_my_company_id())));
$$;

-- (b) Belt: make drivers match every other converted table (fail at the column too).
--     Run the backfill check first; fix any rows before the ALTER.
--   select count(*) from public.drivers where tenant_id is null;
alter table public.drivers alter column tenant_id set not null;
```

All converted-page tables except `drivers` are already `NOT NULL` on `tenant_id`; the ALTER
brings `drivers` in line. The helper change is behavior-neutral for legitimate rows (their
`tenant_id` is never null) and only removes the null path.

### `get_tenant_context()` RPC (`docs/sql/rls_07_tenant_context.sql`)

A SECURITY DEFINER function that resolves and validates identity in one trusted call and returns
only safe fields. `tenants` is already readable by the client via the scoped `tenants_select`
policy (`rls_04_identity_tables.sql`), so this RPC is not needed to make tenants readable; its
value is a single round-trip plus server-side integrity-checking and role normalization.

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

One job: resolve "who is this user, which tenants can they act in, which is active" and hand it
to everything via a `useTenant()` hook. Nothing else in the app resolves tenancy.

It calls `supabase.rpc("get_tenant_context")`, holds the `activeTenantId` (persisted to
`localStorage`, keyed by user id so a different account never inherits a stale selection), and
restores a persisted selection only if it is still a valid option. It **subscribes to
`supabase.auth.onAuthStateChange`** and re-invokes the RPC on `SIGNED_IN` / `SIGNED_OUT` /
`USER_UPDATED`, resetting `status` to `loading`, clearing the cached tenants /
`activeTenantId` / `writeTenantId`, so `TenantGate` re-gates and mounted pages drop stale rows on
sign-out or account switch.

`useTenant()` returns:

```ts
{
  status: "loading" | "ready" | "signed-out" | "no-tenant",
  role: "staff" | "admin" | "super_admin",
  tenants: { id: string; name: string }[],   // staff: just their own
  activeTenantId: string | null,             // null === "All tenants" (admin/super only)
  setActiveTenantId: (id: string | null) => void,
  writeTenantId: string | null,              // tenant to stamp on INSERTS (null when "All")
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

Reads and writes follow different rules. The blunt "swap `TENANT_ID` for the resolved tenant"
transform is NOT sufficient; the review showed it relocates rows and null-stamps paths.

**Reads**

- Every `.eq("tenant_id", TENANT_ID)` list/scope filter becomes `tenant.filterByTenant(query)`.
  Specific tenant active -> `.eq("tenant_id", activeTenantId)`. "All" active -> no client filter,
  RLS scopes the result (admin -> company, super -> everything). Staff always specific.
- Pages that scope reads by a **client-side comparison** rather than a query filter (e.g.
  `maintenance` filters records by `record.vehicles?.tenant_id`) are handled by name, not by token
  replacement: on "All" they show the RLS-scoped company-wide set, on a specific tenant they
  filter to it.
- **Reload on selector change.** Changing `activeTenantId` re-runs each page's data load,
  including FK option sets (customer/vehicle/driver dropdowns), so the visible list and the
  create-form options always match the active tenant. Pages currently load once in
  `useEffect([])`; they gain `activeTenantId` as a dependency.

**Writes (insert)**

- Inserts stamp `tenant_id: tenant.writeTenantId`. When "All" is active, `writeTenantId` is null
  and create is disabled with an inline hint ("pick a specific tenant to create records"). Each
  create handler also early-returns if `writeTenantId` is null. Writing is never defaulted to the
  home tenant.
- Pages whose insert payload has **no** `tenant_id` field today (e.g. `maintenance`) get
  `tenant_id: tenant.writeTenantId` added explicitly; token replacement would miss them and the
  NOT NULL insert would fail.

**Writes (update / existing-row ops)**

- **Updates never include `tenant_id` in the payload.** `drivers` and `customers` share one
  payload object for insert and update; the update path must omit `tenant_id` so an edit can
  never re-stamp or relocate a row. Update scope stays keyed on the row `id` (RLS plus the row's
  own tenant enforce isolation).
- **Existing-row operations use the row's own loaded `tenant_id`, not `writeTenantId`.** POD
  upload/save is an edit of a pre-existing `job_stops` row: the storage path prefix and the update
  scope come from that row's `tenant_id` (selected into `loadJobs`), which is always concrete and
  correct for the row being edited. Upload/save are disabled when the row's tenant is unavailable,
  so a path is never built from a null.

**Create/relocate invariant** (corrected from v1): every creation carries a concrete `tenant_id`
and no edit changes a row's tenant, enforced by:

1. UI disables create when the target is "All" (`writeTenantId` null); updates omit `tenant_id`.
2. Create handlers early-return on null `writeTenantId`.
3. `rls_08`: helpers reject a null target for every role (incl super), and `drivers.tenant_id`
   is NOT NULL like the others, so a null tenant is rejected at the DB regardless of the client.

`WITH CHECK` is the enforcing DB layer for non-super writers; `rls_08` plus the update rule are
what bound super writes, since RLS does not.

## Per-page changes

Uniform transformation on all 11 pages:

- Delete `const TENANT_ID = "2f7cc0dc..."` (Class-A) and the `FALLBACK_TENANT_ID` + local
  `resolveTenantId()` (Class-B).
- Add `const tenant = useTenant();`, wrap the page body in `<TenantGate>`, and add
  `activeTenantId` to the load effect's dependencies.
- Reads -> `tenant.filterByTenant(...)`; inserts -> `tenant_id: tenant.writeTenantId`; updates
  omit `tenant_id`.

Handled by name (not token replacement):

- **`pod/page.tsx`**: select `job_stops.tenant_id` in `loadJobs`; build the storage path
  `${stop.tenant_id}/${stopId}/...` and scope `savePod` updates from that per-row tenant; disable
  upload/save when it is unavailable. Bucket lockdown is the companion task, not here.
- **`maintenance/page.tsx`**: add `tenant_id: tenant.writeTenantId` to the create payload; map the
  client-side `record.vehicles?.tenant_id` read filter to the `filterByTenant` semantics above.
- **`drivers/page.tsx`, `customers/page.tsx`**: split the shared insert/update payload so the
  update omits `tenant_id`.
- **Admin-write pages** (`drivers`; `vehicles` create/delete): staff see create/delete disabled
  via an `isAdmin` check. `vehicles`' staff "toggle active" path is unchanged.
- **`tracking`** is read-only: filter only.

## Files touched

New:

- `app/components/TenantProvider.tsx`
- `app/components/TenantSelector.tsx`
- `app/components/TenantGate.tsx`
- `docs/sql/rls_07_tenant_context.sql`
- `docs/sql/rls_08_null_write_hardening.sql`

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
  - Admin: "All tenants" default shows company-wide; selecting a tenant filters AND reloads lists
    and FK options; create disabled on "All", enabled and stamps the chosen tenant when specific.
  - Super: sees all tenants; selector lists all.
  - Blocked profile: `no-tenant` panel, no data, create disabled.
  - Edit does not move a row: editing a listed record while a different tenant is active leaves
    the row's `tenant_id` unchanged.
  - Sign-out / account switch: stale rows and selection clear without a manual reload.
- RLS backstop, extended in the `rls_09` harness: a write with a null `tenant_id` and a write with
  a foreign `tenant_id` are both rejected after `rls_08` (including as super for the null case).

## Dependencies / order

1. Ethan runs `rls_07_tenant_context.sql`, then `rls_08_null_write_hardening.sql` in Supabase
   (backfill-check `drivers` first).
2. Build `TenantProvider` / `TenantSelector` / `TenantGate`, wire into `layout.tsx` and
   `AppHeader`.
3. Convert the 11 pages (reads, insert vs update rules, per-page special cases, reload-on-change).
4. Verify (matrix + grep + build + harness probes).
5. Companion task (separate, this week): `pod-files` bucket lockdown.

## Review

Revised 2026-07-29 after a 5-adversary / 3-judge adversarial pass over v1. Confirmed findings
folded in: the `pod-files` public-bucket leak (elevated to a named companion, prefix no longer
claimed as isolation), the insert-vs-update relocation hole (updates now omit `tenant_id`,
existing-row ops use the row's own tenant), reload-on-selector-change, the unconstrained
super_admin write path (`rls_08` + create/edit rules), the nullable `drivers.tenant_id` (`rls_08`
NOT NULL + helper null-rejection), the false "no SELECT policy on tenants" claim (corrected: the
scoped `tenants_select` from `rls_04` already exists), and provider re-resolution on auth change.
