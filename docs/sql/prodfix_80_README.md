# prodfix_80..93: database security batch (fix agent H)

Written 2026-09-14 for the production-readiness review
(`docs/superpowers/reviews/2026-09-14-production-readiness-review.md`, findings SQL-1..SQL-20, POD-4, POD-15).
Nothing here has been applied. Every file was written without access to the live database, so each one
asserts its preconditions and either changes nothing or raises and rolls back. None of them widens
access, with one deliberate, bounded exception (prodfix_91 grants on `user_permissions`, see below).

## Before anything

1. Run `docs/sql/diag_2026_09_14_live_state.sql` (read-only) and keep the CSV.
2. Run `docs/sql/prodfix_80_preflight_readonly.sql` (read-only). It says what each file below will do to
   the live state. Run it again at the end and compare.
3. Apply the other agents' `prodfix_10..79` files first, as their numbering implies. If one of them does
   `create or replace function` on a function listed in prodfix_86, re-run prodfix_86 afterwards.

## Apply order

Run each file on its own in the Supabase SQL editor. Each ends with a read-only verify query whose result is
what the editor shows.

| # | File | Findings | Depends on | Check in diag first | Verify after |
|---|------|----------|------------|---------------------|--------------|
| 1 | `prodfix_81_drop_rls_verify.sql` | SQL-10 | nothing | `04_function` (is `rls_verify` there?) | its query returns 0 rows |
| 2 | `prodfix_82_storage_buckets_private.sql` | SQL-1, POD-4 | nothing | `07_bucket` | both buckets `public = false` |
| 3 | `prodfix_83_storage_restrictive_policies.sql` | SQL-1, POD-4, SQL-8, M7 | 2 (not strictly) | `02_policy` storage.objects rows, `04_function` can_access_tenant `auth_exec=true`; prodfix_80 `E_storage_owner` | five RESTRICTIVE rows per bucket; the app-side list/remove checks at the bottom of the file |
| 4 | `rls_11_enable_rls_explicit.sql` (corrected draft) | SQL-2, C1 | nothing | `01_table_rls` (rls=false rows, `policies`, `has_tenant_id`); prodfix_80 `A_rls_off` | re-run prodfix_80: `A_rls_off` lists only SKIP rows; then rls_09 + prodfix_81 |
| 5 | `prodfix_84_views_security_invoker.sql` | SQL-3 | 4 | `03_view`; prodfix_80 `H_server_version` (needs 15+) | every view `security_invoker=true`, `anon_select=false` |
| 6 | `prodfix_85_replace_auth_tenant_id_policies.sql` | SQL-4, POD-15 | 4 | `05_function_source` (`auth_tenant_id` body), `02_policy` for the six tables | 4 policies on job_items, 1 on each other table, all `can_access_tenant`; /jobs as a company admin viewing a sibling tenant now shows items |
| 7 | `prodfix_92_jobs_policy_drift.sql` (OPTIONAL) | SQL-9 | 4 | `02_policy` for `jobs`, `job_stops`: apply only if they are not exactly one rls_03 `tenant_access` | one `tenant_access` per table; `orphan_tenant_rows` counts |
| 8 | `prodfix_91_user_permissions_policy.sql` | SQL-20 | 4 | `10_column` + `02_policy` for `user_permissions` | two policies, anon no privileges; staff self-grant probe errors |
| 9 | `prodfix_87_tachograph_manual_activity.sql` | SQL-18, SQL-7 | nothing | `04_function` (both tachograph signatures) | `memberships_in_body=false`, `takes_lock=true`; add a manual activity on /tachograph as a company admin |
| 10 | `prodfix_88_profiles_guard_extend.sql` | SQL-7 | nothing | `06_trigger` (profiles guard present), `10_column` profiles, `12_role_counts` | two triggers; VERIFY 2 lists 0 mismatched profiles |
| 11 | `prodfix_90_child_tenant_binding.sql` | SQL-16 | nothing | `10_column` job_items; raises with a count if existing rows already mismatch | two triggers; cross-tenant insert probe errors |
| 12 | `prodfix_86_security_definer_hardening.sql` | SQL-14, SQL-15 | after 6, 9, 10, 11 (covers the functions they create) | `04_function`, `02_policy` (policies with roles `{public}`/`{anon}` that call a helper), `10_column` (defaults using `next_*_number`) | every listed definer function `anon_exec=false`, config ends `pg_temp` |
| 13 | `prodfix_89_auth_users_provisioning_check.sql` (read-only) | SQL-13 | nothing, run early | `06_trigger` auth rows, `05_function_source` `handle_new_user` | see "SQL-13" below |
| 14 | `prodfix_93_tenant_indexes.sql` | SQL-19 | last | prodfix_80 `I_unindexed` (sizes) | result lists only tables skipped for size; run their CONCURRENTLY statements from psql |

Finally: run `rls_09_verify.sql` (fill the three placeholders), read P1..P14, then **run prodfix_81 again**
to drop `rls_verify`.

`rls_12_job_files_lockdown.sql` is superseded by 2 + 3 and now raises immediately if run.

## Things that need the Supabase dashboard

- **Disable public signups**: Authentication > Sign In / Providers > turn off "Allow new users to sign up".
  Admin invites (`inviteUserByEmail`) keep working. Without this, `/auth/v1/signup` stays open even after the
  login page stops creating users, and every "authenticated" surface below is reachable by strangers (SQL-13).
- **prodfix_83 may need the dashboard.** If it raises "cannot create policies on storage.objects", create the
  policies in Storage > Policies > New policy > For full customization, as the file header describes (normally
  only `pod_files_non_authenticated_deny` and the five `job_files_*` ones; the four pod-files ones are live since
  2026-08-10).
- **job-files**: nothing in app/ or lib/ uses it. Deleting the bucket (Storage > job-files) is the simplest full fix.
- **Sessions**: after prodfix_85, anyone who set `tenant_id` in their own user_metadata keeps nothing from it; no
  session revocation is needed for RLS, but if diag 05 shows `auth_tenant_id` read user_metadata, treat it as a
  possible past breach and review job_items / load_* writes by `created_by` / `scanned_by`.

## Tables the browser reads directly (deny-all would break them)

Found by grepping `app/` and `lib/` for the browser client (`lib/supabase/browser`) and the cookie-scoped server
client on 2026-09-14. RLS applies to every one. rls_11 only leaves a table deny-all when it has RLS off, no
policies and no `tenant_id` (or a sensitive name), and prodfix_80 flags any of these that would land there with
"WILL BREAK A BROWSER PAGE".

- Reads and writes from the browser: `assets`, `drivers`, `driver_licence_checks`, `driver_licence_endorsements`,
  `driver_training`, `jobs`, `job_stops`, `pod_evidence`, `maintenance_records`, `vehicles`, `company_profiles`,
  `user_permissions`, `subcontractors`, `subcontractor_employees`, `subcontractor_vehicles`,
  `fleet_insurance_policies`, `invoices` (super-admin pages)
- Reads only: `asset_types`, `tenants`, `companies`, `profiles`, `customers`, `vehicle_assignments`,
  `driver_activity_logs`, `planning_route_itineraries`, `planning_route_visits`, `planning_route_visit_stops`,
  `vehicle_licences`, `vehicle_locations`, `telematics_positions`, `company_billing`, `platform_charges`,
  `vehicle_addon_charges`, `period_charges`, `registration_requests` (server component, user client)
- Embedded in a select (so the child table's RLS applies too): `job_items` (jobs and planning pages), `job_stops`,
  `customers`, `drivers`, `subcontractors`

Most likely to have **no `tenant_id`** and therefore be at risk: `driver_licence_checks`,
`driver_licence_endorsements`, `driver_training` (probably keyed by `driver_id`), `subcontractor_employees`,
`subcontractor_vehicles` (probably keyed by `subcontractor_id`), `vehicle_assignments`, `user_permissions`
(covered by prodfix_91), and the global lookup `asset_types` (already has `asset_types_read` from rls_04). Check
`has_tenant_id` for these in diag `01_table_rls`. A child table without `tenant_id` needs a parent-scoped policy
(example in the rls_11 header), not deny-all.

Other RPCs the browser calls: `get_tenant_context`, `assign_driver_to_vehicle`, `unassign_vehicle`,
`replace_planning_route_itinerary`, `invalidate_planning_route_itinerary`. prodfix_86 keeps authenticated EXECUTE
on all of them.

## Per-finding notes

- **SQL-1 / POD-4, SQL-8**: restrictive policies, not drops, because of the 42501 ownership incident in rls_10a.
  The `*_non_authenticated_deny` policies are `to public` and call no function, so anon storage calls are denied
  without depending on anon's EXECUTE grants.
- **SQL-2**: rls_11 corrected in place (it is still unapplied; billing_03 refers to it by name).
- **SQL-3**: all public views get `security_invoker`; `jobs_ready_to_invoice` and `customer_aged_debt` become
  service-role only, as the app uses them. Materialized views never apply RLS, so they become service-role only.
- **SQL-4**: if `auth_tenant_id()` reads `auth.jwt() -> 'user_metadata'`, that metadata is user-editable
  (`supabase.auth.updateUser({ data })`), and the invite routes put `tenant_id` there, which makes that body
  likely. prodfix_85 does not depend on the body. The function itself is left installed; once VERIFY 2 in
  prodfix_85 shows nothing references it, drop it or at least revoke EXECUTE from anon and authenticated.
- **SQL-7**: `profiles_privileged_columns_guard` does block client writes to role_id, company_id and tenant_id
  (insert and update). prodfix_88 widens the protected column set and binds `company_id` to the tenant's company
  for every role. prodfix_87 removes the last memberships read from database code in the repo. The app-side half
  (which caller may change `profiles.role_id` through a service route) belongs to the settings agent.
- **SQL-9**: drift is undetermined from the repo. prodfix_92 is optional and refuses to replace any policy it
  does not recognise.
- **SQL-10**: real profile UUIDs are removed from `rls_09_verify.sql`, but they are still in
  `docs/superpowers/plans/2026-07-28-rls-tenancy-hardening.md` (outside this batch's files) and in git history.
  Dropping the function removes the gadget; the ids are identifiers, not secrets.
- **SQL-11**: rls_03 header now says DO NOT RE-RUN and lists what a re-run would overwrite.
- **SQL-13**: prodfix_89 is a report. What to look for in the live `handle_new_user` (or any auth.users trigger):
  any read of `raw_user_meta_data` / `user_metadata` that feeds `profiles.tenant_id`, `company_id`, `role_id`, a
  `role` column, `memberships`, `driver_users` or `subcontractor_users`. The safe shape (identity only, privileged
  data from a service-role route or `raw_app_meta_data`) is in the file. No automatic replacement, because the
  invite routes put the same keys in user_metadata and a guessed body could break invite provisioning.
- **SQL-14 / SQL-15**: `alter function ... set search_path` only; no bodies touched except the two tachograph RPCs
  (prodfix_87), which needed a body change anyway. Functions that are not in the repo and not named in prodfix_86
  are listed by its verify query for a decision.
- **SQL-16**: triggers, not composite FKs (see file header). Moving a job to another tenant is not blocked.
- **SQL-18**: advisory lock in the RPC, not an exclusion constraint, because imported tachograph rows may
  legitimately overlap.
- **SQL-19**: plain `create index`, not CONCURRENTLY (the SQL editor wraps a transaction). Tables over 256 MB are
  skipped and printed with a CONCURRENTLY statement for psql. Likely large: `telematics_positions`, `gps_events`,
  `telematics_events`, `telematics_trips`, `telematics_fuel`, `vehicle_locations`, `driver_activity_logs`,
  `audit_logs`, `load_scan_events`, `job_item_scans`.
- **SQL-20**: an admin can manage permission rows for users in tenants they manage (`can_manage_tenant` on the
  target profile's tenant); a user can read their own rows; nobody else can write. Chosen over deny-all because
  `/settings/permissions` writes the table from the browser. This file adds `select, insert, update, delete` to
  authenticated; the policy is what keeps that narrow.

## Owned by other fix agents (not in this batch)

- **SQL-5** (v2 billing evaded by deleting vehicles) and **SQL-12** (billing audit rows cascade-delete): billing
  agent. Note for them: prodfix_86 does not touch `record_cycle_charge` or any billing table.
- **SQL-6** (quotation acceptance RPCs callable directly): invoices agent. prodfix_86 only sets `search_path` on
  `accept_quotation_share*`, `decline_quotation_share` and `mark_quotation_share_viewed` and leaves their grants
  alone. If their file recreates those functions, re-run prodfix_86.
- Rate limiting: `prodfix_01_rate_limits.sql`, already correct (revokes from public, anon, authenticated).

## Drift and hygiene recorded, not fixed (SQL-9, SQL-17)

- `supabase/migrations/20260819_planning.sql` describes jobs/job_stops policies as `tenant_id = get_my_company_id()`,
  which contradicts rls_03. Settle with diag `02_policy`; fix with prodfix_92 if real.
- Non-idempotent migrations (bare `create table` / `create policy`, a re-run errors partway):
  `20260902133000_job_item_scans.sql`, `20260902140000_load_manifests.sql`,
  `20260908050000_planning_route_itineraries.sql`. Headers now say do not re-run where this batch supersedes them.
- `create table if not exists` on tables that already existed live (the invoice_lines incident class), which
  silently accepts a different shape and then applies RLS and grants to it: `20260813_portal_invites.sql`,
  `20260814_xero_oauth_credentials.sql`, `20260902130000_job_items_baseline.sql`. Future files should assert the
  expected shape first, as billing_06 PRE-FLIGHT 1 does.
- More than 60 tables the app uses (jobs, invoices, quotations, customers, and their child tables) have no
  `create table` or RLS DDL anywhere in the repo. `schema_rls_dump.sql` is a query, not a committed result, and it
  omits views, storage policies, function ACLs and auth triggers. `diag_2026_09_14_live_state.sql` covers those;
  commit its CSV output (it contains no customer data) as the baseline after this batch.
- The only drafts in this batch's ownership were rls_11 (rewritten idempotent) and rls_12 (neutralised).
- `billing_06_verify.sql` creates and then drops `billing_period_verify()` in the same file, which is the right
  pattern; `rls_09_verify.sql` does not, hence prodfix_81.
- README.md and CLAUDE.md still say the job-files bucket is not locked down; update them once 2 and 3 are
  applied and verified.
