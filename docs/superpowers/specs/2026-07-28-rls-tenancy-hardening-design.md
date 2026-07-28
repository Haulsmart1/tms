# RLS Tenancy Hardening — Design (Phase 1)

Status: draft for review
Date: 2026-07-28
Scope: A (database enforcement layer). App-layer work is named but deferred.

## 1. Problem and context

TMS Wizzard is multi-tenant, and today tenant isolation rests entirely on Postgres
Row Level Security. RLS is enabled on every table (verified), so the database is not
wide open. But an audit of the live policies and functions found three problems:

1. **A confirmed privilege-escalation hole** (already patched by the `profiles`
   guard trigger, see `docs/sql/profiles_privileged_columns_guard.sql`): any
   authenticated user could set their own `profiles.role_id` to super_admin.
2. **The base isolation is keyed at the wrong level.** Every data-table policy is
   `tenant_id = get_my_company_id()`, and `get_my_company_id()` returns
   `profiles.company_id`. But operational data is keyed on `tenant_id`, which is a
   different value. Proven from live data: the single `jobs` row is currently
   invisible to every logged-in user, because its `tenant_id` matches a user's
   `tenant_id` while the policy compares against `company_id`.
3. **Naming is inverted across tables**, which is the root cause of #2. "Tenant"
   means the operational data partition in some tables and the parent company in
   others (`company_profiles.tenant_id` actually holds a company id).

The system is early-stage: 7 seeded companies, one shared placeholder tenant
(`2f7cc0dc...`, the app's hardcoded constant), one job, and roles unassigned on 7
of 8 profiles. It is not customer-facing. So we can fix the model correctly now,
with no meaningful data migration.

## 2. Goals and non-goals

**Goals (Phase 1):**
- Re-key base isolation so a user sees only their own tenant's data.
- Implement the three access levels correctly: tenant, company admin, platform super_admin.
- Establish an authoritative tenant-to-company mapping.
- Keep all write/provisioning paths closed to the public API (service-role only).
- Fold in the cheap hygiene win (`TO authenticated`, not `TO public`) on every policy we rewrite.

**Non-goals (deferred, tracked):**
- **Phase 2 (RLS cleanup):** consolidate the overlapping policy stacks on `profiles`
  (4) and `company_profiles` (9); drop `public.users` after its FK dependencies are
  mapped.
- **App-layer follow-on spec:** remove the hardcoded `TENANT_ID` so the app uses the
  user's real tenant; replace the unauthenticated `signInWithOtp` invite with a
  service-role route; add route guards / middleware; build the director-invites-staff
  onboarding flow.

## 3. The tenant model (canonical vocabulary)

- **Company** = the parent organisation. Identified by `company_id`. Its record is a
  `company_profiles` row (whose column is confusingly named `tenant_id`; renaming is
  Phase 2).
- **Tenant** = one operating dataset. Identified by `tenant_id`. Its record lives in
  the `tenants` table. Every operational data table carries `tenant_id`.
- A **company owns one or more tenants**. A **user belongs to one tenant** (their
  `profiles.tenant_id`) and, through it, to one company.

Access levels (confirmed with the product owner):
- **tenant** (regular staff, and the default when `role_id` is null): sees only their own tenant.
- **admin** (company-wide): sees every tenant under their company.
- **super_admin** (platform / whole-site): sees everything.

## 4. Structural changes

1. **Add `company_id` to `tenants`.** Each operational tenant belongs to one company.
   This is the single authoritative tenant-to-company link, replacing the current
   inference from per-user profile rows. Nothing in the app reads `tenants` today, so
   this is low risk.
2. **Identity model:** standardise on `auth.users` (Supabase-managed identity) plus
   `public.profiles` (app data, `id = auth.users.id`). `public.users` and its dependent
   `memberships` table are a **legacy identity cluster** from before `profiles` existed
   (`memberships.user_id` foreign-keys to `public.users`, not `profiles`), unused by the
   app. Deprecate both together in Phase 2 once FK dependencies are mapped. We are
   deliberately NOT adopting the many-tenants-per-user model that `memberships` implied:
   a regular user belongs to one tenant via `profiles.tenant_id`, and cross-tenant reach
   is the `admin` role over a company.
3. **`profiles` keeps** `tenant_id`, `company_id`, and `role_id`. The privileged-column
   guard trigger is already in place.

## 5. Helper functions

All are `SECURITY DEFINER` with a pinned `search_path`, so they read identity tables
without tripping those tables' own RLS. Two exist already (`get_my_company_id`,
`get_my_role`); we add two.

```sql
-- New: the user's own tenant (base isolation key).
create or replace function public.get_my_tenant_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select tenant_id from public.profiles where id = auth.uid() limit 1
$$;

-- New: the whole three-level decision, in one place. Every data-table policy calls this.
create or replace function public.can_access_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    public.get_my_role() = 'super_admin'                       -- platform: everything
    or target_tenant = public.get_my_tenant_id()               -- own tenant
    or (public.get_my_role() = 'admin'                         -- company admin: any tenant in their company
        and target_tenant in (
          select t.id from public.tenants t
          where t.company_id = public.get_my_company_id()
        ));
$$;
```

`get_my_role()` returns null when `role_id` is null; both role comparisons above are
then false, so a null-role user correctly falls through to "own tenant only". That is
the safe default.

## 6. Policy design

**Standard data tables** (every table carrying a `tenant_id` column, per the schema
inventory: jobs, job_stops, drivers, customers, subcontractors, vehicles and the
vehicle_* family, invoices, invoice_items, maintenance_*, assets and asset_*,
assignments, defect_reports, driver_* logs, gps_events, tachograph_*, telematics_*,
pod_files, pod_records, rate_cards, accounting_exports, addresses, audit_logs,
billing, integration_connections, job_documents, subscriptions, tyres).

Each gets one policy, replacing the mis-keyed `Tenant ID Matches`:

```sql
drop policy if exists "Tenant ID Matches" on public.<table>;
create policy tenant_access on public.<table>
  for all to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));
```

`TO authenticated` (not `public`) and the `with check` mean anon is denied outright
and writes can only land in a tenant the caller may access. Implementation applies
this by iterating over every table that has a `tenant_id` column, with the special
tables below excluded from the loop and handled explicitly.

**Special tables:**
- **profiles:** self-visible, plus admins see profiles in their company, plus
  super_admin sees all. Writes stay guarded (the INSERT+UPDATE trigger) and closed to
  self-service for privileged columns; no INSERT/DELETE policy for authenticated. The
  policy stack is consolidated in Phase 1 (per the adversarial review).
- **company_profiles:** read by any company member (`tenant_id`-as-company =
  `get_my_company_id()`) or super_admin; insert/update by that company's **admin** or
  super_admin (company settings are an admin action). The 9 overlapping policies are
  consolidated to one per command in Phase 1.
- **vehicles / drivers (the fleet):** admin-write. Staff read via `can_access_tenant`;
  only an admin or super_admin does roster writes via `can_manage_tenant`. `vehicles`
  additionally lets staff toggle operational status (`active` = VOR) via a column-guard
  trigger. See the plan's Task 4b.
- **tenants:** after adding `company_id`, policy = own tenant (`id = get_my_tenant_id()`)
  OR admin's company (`company_id = get_my_company_id()`) OR super_admin. Writes
  service-role only.
- **companies:** own company OR super_admin (keep existing `companies_select` shape).
- **roles:** read-only lookup for authenticated (keep the existing `SELECT true`); no
  write policy, so writes are denied.
- **asset_types:** RLS-locked with no policy; the app does not read it, so it is left
  locked (opening it blindly could leak per-tenant rows). Add a scoped policy only if a
  real need appears.
- **user_permissions:** RLS-locked with no policy and unused by the app. Leave locked
  (it gates nothing today). Give it a real policy only when the permissions feature is
  actually built.
- **memberships:** legacy (see section 4). Unused, and its current `company_id`-keyed
  policy denies rather than leaks, so it is inert. Leave it untouched in Phase 1 and
  remove it with `public.users` in Phase 2.
- **Out of scope, leave untouched:** `ai_signals`, `paper_trade_logs`,
  `portfolio_history` belong to a different application sharing this database and
  already have owner-scoped policies.

## 7. Writes and provisioning

Isolation of *existing* rows is the `can_access_tenant` predicate above. Creating
companies, tenants, and staff profiles, and sending invites, does NOT go through
client inserts. It goes through **service-role server routes** that first verify the
caller is a super_admin (for companies/tenants) or the company's admin (for staff in
their tenants). This is the same pattern already used for `registration_requests`.

Consequently, the director-invites-staff flow the product owner described is
satisfied without opening any write policy: the director (an `admin`) calls a server
route, the route checks their role server-side and inserts the new profile with the
correct `tenant_id`/`company_id` via the service role. Building that route and the
invite UI is the app-layer follow-on, not Phase 1. Phase 1 only needs the write
policies to stay closed, which they do.

## 8. Rollout

The re-key is **backward-compatible with the current test state**, which makes it safe
to apply immediately:

- Today every profile shares `tenant_id = 2f7cc0dc...`. Under the new base rule
  (`tenant_id = get_my_tenant_id()`), every user's `get_my_tenant_id()` is also
  `2f7cc0dc...`, so all shared-tenant users can see the shared-tenant data. That is the
  correct behaviour for a single shared tenant, and it actually **fixes** the current
  bug where the `company_id`-keyed policy made that data invisible to everyone.
- Real separation begins only once we assign distinct tenants. Steps, in order:
  1. Add `tenants.company_id`; create one `tenants` row per company and set its `company_id`.
  2. Assign each real user their company's tenant (`profiles.tenant_id`), and set the
     director's `profiles.role_id` to `admin` (done as postgres or super_admin, which the
     guard trigger permits).
  3. Deploy the helper functions and the re-keyed policies.
  4. (App-layer follow-on) remove the hardcoded `TENANT_ID` so the app reads the user's
     real tenant. Until then the app stays on the shared tenant harmlessly.

## 9. Verification and testing

Isolation is security-critical, so it is proven, not assumed:

- **Per-level probes** run inside a transaction with `set local role authenticated`
  and a simulated `request.jwt.claims`, then rolled back (the pattern already used to
  prove the profiles guard). For each level: a tenant user sees only their tenant; an
  admin sees their company's tenants and not another company's; a super_admin sees all;
  an anon caller sees nothing.
- **Adversarial pass:** independent attempts to break isolation, cross-tenant read,
  cross-tenant write, self-escalation, tenant-hop, and reaching a locked table. This
  runs before the change is considered done. (Good candidate for parallel reviewers,
  each trying a distinct bypass class.)
- **A repeatable SQL harness** captured under `docs/sql/` so the checks can be re-run
  after future schema changes.

## 10. Open items and risks

- The exact `profiles` and `company_profiles` policy consolidation is Phase 2; Phase 1
  must not regress their current (correct) isolation.
- `can_access_tenant` runs a subquery over `tenants` per row; if that ever shows up as
  a performance cost on large scans, memoise "my company's tenant ids" or index
  `tenants.company_id`. Not a concern at current scale.
- Role assignment must happen for real users or everyone stays tenant-level by default
  (safe, but admins would see nothing beyond their own tenant until assigned).
```
