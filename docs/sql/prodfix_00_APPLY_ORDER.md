# prodfix SQL: apply order for the 2026-09-14 production-readiness fixes

Every `docs/sql/prodfix_*.sql` file comes from the review in
`docs/superpowers/reviews/2026-09-14-production-readiness-review.md`. None of them has been applied.
They were written without access to the live database, so each one checks its preconditions and
either changes nothing or raises and rolls back. Apply them by hand in the Supabase SQL editor, in
the order below, and run the verify query at the bottom of each file before moving on.

## When to apply: SQL first, then deploy

Several code paths on `ethan/production-review-fixes` refuse to work until their SQL exists. That
is deliberate: failing closed means no silent money loss or data loss.

| Until this is applied | This refuses |
|---|---|
| prodfix_10 | super-admin tenant moves (503) |
| prodfix_20 | user invites, role edits, user removal, portal invites (503) |
| prodfix_40..43 | recording payments, creating invoices, approving credit notes, editing draft invoices (503) |
| prodfix_60 | every POD share link (reads as invalid; creating one is a 503) |
| prodfix_70 | **saving in Planning** |

The new SQL is additive for the OLD code too: the only changes that affect today's deployed code
are the licence gate (prodfix_30 refuses assigning an unlicensed vehicle), the delete restrictions
(prodfix_31), and the storage and policy tightening (prodfix_83, 85). With no live customers, the
simplest safe path is one short window: apply everything below, then deploy the branch.

## Baseline that must already be live (and must never be re-run)

The prodfix files assume two earlier sets of migrations are applied. Neither is in this list, and
neither is safe to replay.

- `docs/sql/billing_01` .. `billing_07`. The `billing_07` header records `billing_01`..`05` as
  applied (2026-09-10), and `billing_06`/`07` were applied with the period-billing work. Never
  re-run `billing_03` STEP 1: outside its deploy window it creates coverage nobody paid for.
- `supabase/migrations/*.sql` (15 files, 2026-08-13 .. 2026-09-11). Despite the folder name these
  were pasted into the SQL editor by hand, so the Supabase CLI's migration history is empty. **Never
  run `supabase db push` against this project**: it would treat all 15 as pending, replay files that
  cannot run twice (`job_item_scans`, `load_manifests`, `planning_route_itineraries`) and recreate
  functions that prodfix_85/86/87 harden.
- `rls_01_tenants_company_id.sql` and `rls_01b_reseed.sql` now refuse to run. `rls_03` says DO NOT
  RE-RUN.

What depends on the baseline, and what goes wrong without it:

| prodfix | Needs | Without it |
|---|---|---|
| 31 | `billing_03`, `billing_05`, `billing_06`, `billing_07` | Evidence check is built from whichever tables exist at apply time. Without `billing_07`'s lifecycle columns it compiles to `or true`, so **no vehicle can ever be deleted**. A billing table created later is ignored until 31 is re-run. |
| 32 | `billing_06`, `billing_07` | Migration RPC fails. |
| 33 | `billing_06` (`period_charges`, `billing_periods`), `billing_01` (`platform_charges`) | Aborts on an unguarded `::regclass` cast. |
| 71 | `20260901041500_jobs_planning_date.sql` | Itinerary trigger references `jobs.planning_date`. |
| 87 | `20260831235900_driver_activity_timezone_ferry.sql`, `20260911131500_tachograph_activity_ledger.sql` | Raises and changes nothing. |

## 0. Read-only checks first

0. Run this. Every row must say `true`; if any says `false`, stop and apply or investigate that
   baseline file before any prodfix.

   ```sql
   select 'billing_01 company_billing' as needs, to_regclass('public.company_billing') is not null as ok
   union all select 'billing_01 platform_charges', to_regclass('public.platform_charges') is not null
   union all select 'billing_03 vehicle_cycle_coverage', to_regclass('public.vehicle_cycle_coverage') is not null
   union all select 'billing_03 vehicle_addon_charges', to_regclass('public.vehicle_addon_charges') is not null
   union all select 'billing_04 record_cycle_charge', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_cycle_charge')
   union all select 'billing_05 vehicle_addon_charges.square_card_id', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vehicle_addon_charges' and column_name = 'square_card_id')
   union all select 'billing_06 billing_periods', to_regclass('public.billing_periods') is not null
   union all select 'billing_06 period_charges', to_regclass('public.period_charges') is not null
   union all select 'billing_06 period_invoice_lines', to_regclass('public.period_invoice_lines') is not null
   union all select 'billing_07 vehicle_licences.activated_at', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vehicle_licences' and column_name = 'activated_at')
   union all select 'billing_07 vehicle_licences.deactivated_at', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vehicle_licences' and column_name = 'deactivated_at')
   union all select 'supabase 20260901041500 jobs.planning_date', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'planning_date')
   union all select 'supabase 20260831235900 driver_activity_logs.activity_kind', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'driver_activity_logs' and column_name = 'activity_kind')
   union all select 'supabase 20260911131500 upsert_manual_driver_activity', to_regprocedure('public.upsert_manual_driver_activity(uuid,uuid,uuid,text,text,timestamptz,timestamptz)') is not null;
   ```

1. `diag_2026_09_14_live_state.sql`: export the CSV. Several files below name a diag section to check.
2. `prodfix_80_preflight_readonly.sql`: says what the security batch (step 7) will change. Keep the
   output and run it again at the end to compare.
3. From section `11_roles_row`, confirm `roles` has exactly one `admin`, one `staff`, one `driver`
   (prodfix_20 depends on exact names).

## 1. Foundations

| # | File | Notes |
|---|---|---|
| 1 | `prodfix_01_rate_limits.sql` | Rate-limit table and `rate_limit_hit()`. Code allows requests if this is missing, so it is not blocking, but apply it first. |

## 2. Sign-in, super-admin, user management

| # | File | Notes |
|---|---|---|
| 2 | `prodfix_10_super_admin_tenant_move.sql` | Atomic tenant move plus `super_admin_audit`. |
| 3 | `prodfix_20_user_management.sql` | Invite and role RPCs, service-role email lookup. Check diag `11_roles_row` first. |

## 3. Platform billing (order matters)

| # | File | Notes |
|---|---|---|
| 4 | `prodfix_33_billing_integrity.sql` | Must go BEFORE 31. Collection claims, refund_pending, one-success backstop. |
| 5 | `prodfix_31_billing_evidence_retention.sql` | RESTRICT foreign keys and an atomic vehicle delete. After this, a company with billing rows cannot be deleted. Check diag `08_fk` for the constraint names it expects. |
| 6 | `prodfix_30_vehicle_licence_gate.sql` | Licence gate trigger (errcode LIC01), and from 2026-09-15 a cancelled-company gate (LIC02): a company whose `company_billing.status` is `canceled` cannot newly assign any vehicle. First run the count query in its header to see how many live assignments are already unlicensed (they are grandfathered). |
| 7 | `prodfix_32_migrate_company_to_period_billing.sql` | Needed before any `scripts/migrate-company-to-period-billing.mjs --apply`. |

## 4. Customer accounts (in order)

| # | File | Notes |
|---|---|---|
| 8 | `prodfix_40_accounts_payment_allocation.sql` | Atomic payment and allocation checks. |
| 9 | `prodfix_41_accounts_invoice_create.sql` | Atomic invoice create. Adds unique indexes only if no duplicates exist today; it reports them if they do. |
| 10 | `prodfix_42_accounts_credit_notes.sql` | Credit note numbering (CN-YYYY-0001 per tenant) and atomic approval. |
| 11 | `prodfix_43_accounts_invoice_edit.sql` | Atomic draft invoice edit. |
| 12 | `prodfix_44_accounting_integration_unique.sql` | One tenant per Xero organisation. |

## 5. Quotations

| # | File | Notes |
|---|---|---|
| 13 | `prodfix_50_quotation_share_acceptance.sql` | Revokes client EXECUTE on acceptance RPCs and stores accepted prices. Check diag `04_function` for the live signatures it names. |

## 6. Proof of delivery

| # | File | Notes |
|---|---|---|
| 14 | `prodfix_60_pod_share_links.sql` | Stored, revocable share links. Links issued before the deploy stop working. |
| 15 | `prodfix_61_pod_evidence_path_check.sql` | Evidence path constraint, added NOT VALID. Run its verify query 2; if it returns no rows, run the VALIDATE statement. |

## 7. Planning and tracking

| # | File | Notes |
|---|---|---|
| 16 | `prodfix_70_planning_save.sql` | Atomic planning save. Planning cannot save until this exists. |
| 17 | `prodfix_71_itinerary_integrity.sql` | |
| 18 | `prodfix_72_latest_positions.sql` | Creates two indexes; run it when nobody is using Tracking. |
| 19 | `prodfix_73_geocode_failures.sql` | |
| 19a | `prodfix_94_job_acceptance_stamp.sql` | Stamps `jobs.accepted_by` / `accepted_at` with the real caller, so a browser write cannot record someone else as the person who accepted a job. Changes nothing for server code. |

## 8. Database security batch

Full detail, including which diag section decides each file, is in `prodfix_80_README.md`.

| # | File | Notes |
|---|---|---|
| 20 | `prodfix_81_drop_rls_verify.sql` | Drops the impersonation helper. |
| 21 | `prodfix_82_storage_buckets_private.sql` | |
| 22 | `prodfix_83_storage_restrictive_policies.sql` | If it fails with 42501, create the policies in Storage, Policies as its header describes, or delete the unused `job-files` bucket. |
| 23 | `rls_11_enable_rls_explicit.sql` | Corrected draft. Check the pre-flight first: tables the browser reads that have no tenant_id would become deny-all (driver_licence_checks, driver_licence_endorsements, driver_training, subcontractor_employees, subcontractor_vehicles, vehicle_assignments). |
| 24 | `prodfix_84_views_security_invoker.sql` | Needs Postgres 15 or newer (checked). |
| 25 | `prodfix_85_replace_auth_tenant_id_policies.sql` | |
| 26 | `prodfix_92_jobs_policy_drift.sql` | OPTIONAL, only if diag `02_policy` shows drift on jobs or job_stops. |
| 27 | `prodfix_91_user_permissions_policy.sql` | |
| 28 | `prodfix_87_tachograph_manual_activity.sql` | |
| 29 | `prodfix_88_profiles_guard_extend.sql` | |
| 30 | `prodfix_90_child_tenant_binding.sql` | Raises if existing rows already mismatch; fix those first. |
| 31 | `prodfix_86_security_definer_hardening.sql` | After 50, because it re-applies grants on functions 50 recreates. |
| 32 | `prodfix_89_auth_users_provisioning_check.sql` | Read-only; can run any time. |
| 33 | `prodfix_93_tenant_indexes.sql` | Last. Tables over 256 MB are skipped and printed with a CONCURRENTLY statement to run separately. |

Then run `rls_09_verify.sql` (with real ids substituted locally, never committed) and immediately run
`prodfix_81_drop_rls_verify.sql` again. Finally re-run `prodfix_80_preflight_readonly.sql` and compare.

## 8b. Ledger lockdown (independent; can run any time after rls_08)

| # | File | Notes |
|---|---|---|
| 33b | `prodfix_95_ledger_readonly.sql` | Findings H-1 and M-3 of the 2026-09-22 OWASP review. Revokes INSERT/UPDATE/DELETE from client roles on the accounts ledger tables (invoices, quotations, credit notes, payments, statements, purchase orders, customer contacts, delivery log, ...), replaces their policies with one `tenant_read` SELECT policy, and nulls the share URLs stored in `document_delivery_log`. Deploy branch `ethan/ledger-readonly` FIRST: the super-admin invoices page now writes through `PATCH /api/super-admin/invoices/[id]` instead of the browser. Leaves `customers`, `customer_integrations` and `subcontractors*` alone on purpose (see the file header). |

Live-state note (2026-09-22, Appendix A of the same review): `prodfix_01` and `prodfix_70` are already
applied (`rate_limit_hits` and `save_planning_assignments` exist), so entries 1 and 16 can be marked done.

## 9. Self-serve signup (after the whole prodfix series)

| # | File | Notes |
|---|---|---|
| 34 | `signup_01_create_company_with_admin.sql` | The RPC behind `POST /api/signup`: company, tenant, company profile and founding admin in one transaction, service_role only. Needs prodfix_01 (rate limits), prodfix_20 (`prodfix_role_id`, roles seeded) and prodfix_88 (the tenant/company binding it satisfies). Also adds the unique index on `roles.name`; if the live table holds duplicate role names the file fails and changes nothing, so fix those first. Spec: `docs/superpowers/specs/2026-09-16-self-serve-signup-design.md`. |

Ordering constraints from the signup review (`docs/superpowers/reviews/2026-09-16-self-serve-signup-review.md`,
B1 and S1): every landing call to action links `/signup` in the same branch, so the branch must not
deploy before entries 1 to 34 are applied, or every "Get started" submit answers 500. And apply
`prodfix_20` (#3) and `signup_01` (#34) in the same sitting: between them `/api/signup` answers
200 to an existing address and 500 to a new one, which is an account-existence oracle, and each
500 creates and then deletes an auth user. Run the VERIFY 3 block of `signup_01` (rolled back) on
the hosted project before marking #34 applied: the RPC's column list for `companies` and `tenants`
was proven only against the local reconstruction.

`docs/sql/local_00_base_tables_reconstructed.sql` is NOT in this list. It rebuilds the
dashboard-created identity tables for a local `supabase start` stack only, and must never be
applied to a hosted project.

## Dashboard and environment steps (not SQL)

Supabase:
- Auth, Providers, Email: turn off "Allow new users to sign up". Admin invites keep working, and
  so does self-serve signup: `/api/signup` creates users with the service-role admin API, which
  ignores this switch. It stays off after signup launches.
- Email templates: Invite link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`;
  Magic Link template also points at `/auth/confirm?token_hash=...&type=email`. Signup's
  confirmation email IS the invite template, so it must be in place before `/signup` is live.
- URL configuration: the redirect allowlist must accept `/auth/confirm?next=...`.
- Do not enable OTP captcha yet; the login route and the signup route send no captcha token.
- Custom SMTP (Auth, SMTP settings): the built-in sender has a low shared hourly cap, and
  self-serve signup sends one email per accepted signup. Configure a provider with a verified
  sending domain before `/signup` is linked from the landing page.
- Storage: confirm `pod-files` allowed MIME types include `image/jpeg` (driver photos are now JPEG).

Vercel (production):
- `CRON_SECRET`: required, or no billing runs (the cron now answers 500 and logs why).
- `NEXT_PUBLIC_SITE_URL`: absolute links in emails and share links, including the signup
  invite's `redirectTo`; without it the link falls back to https://tmswizard.cloud.
- `SUPABASE_SERVICE_ROLE_KEY`: the signup route cannot create accounts without it (500).
- Remove `POD_SHARE_SECRET`: nothing reads it now.
- Alerting: a non-200 from `/api/billing/run`, or no successful run in 26 hours. Watch logs for
  `MANUAL REVIEW` and `PAYMENT_INDETERMINATE`.

App data:
- Set `allowed_origin` on every live quote-request form token.
- Xero customers on 0% or mixed VAT: save `settings.xeroTaxTypes` (for example `{"0":"ZERORATEDOUTPUT"}`)
  through `POST /api/accounts/accounting`; there is no UI for it yet, and a sync with an unmapped rate is refused.
- Invitees who were locked out before this fix: re-invite them.

## Driver shifts and walkaround checks (shifts_01..05), 2026-09-29

Spec: `docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md`. Apply in this order, then run
`shifts_verify.sql`.

**Deploy this branch and apply shifts_01..05 together, in the same sitting.** The driver job gate in the
stop routes fails closed: once the code is live and the tables and RPCs are not, every own-fleet driver
gets 409 on every stop completion, for every company, not just those that have started using shifts.
Apply the SQL first and deploy straight after, or deploy only when you are ready to apply immediately.

**After shifts_05, test a real walkaround photo upload** from a driver phone (or `scripts/dev-login.mjs`
as a driver). shifts_05 adds restrictive storage policies, and a restrictive policy also applies to
uploads made through a server-issued signed upload URL; the only way to know the two agree is to upload
a photo and see it recorded on the check.

| Order | File | Needs | Applied |
|---|---|---|---|
| 1 | `shifts_01_tables.sql` | rls_02 | no |
| 2 | `shifts_02_catalogue_seed.sql` | shifts_01 | no |
| 3 | `shifts_03_triggers.sql` | shifts_02; re-run after prodfix_30 if that is applied later. Confirm the server role name first (billing_03 pre-flight): the QR hash guard exempts `postgres`, `supabase_admin`, `service_role` | no |
| 4 | `shifts_04_rpcs.sql` | shifts_03 | no |
| 5 | `shifts_05_storage.sql` | none. Creates restrictive storage policies: if it raises 42501, create them in the dashboard as its header says | no |
| check | `shifts_verify.sql` | all of the above | |

## Stop contacts, saved plans and load transfers, 2026-09-29/30

Moved here from `supabase/migrations/` on 2026-10-01 so every migration still to apply sits in this folder.
They keep their timestamp names. None depends on the shifts series, so they can run before or after it.
Whether any was already applied is unknown: check for the table before running (`load_transfers` uses a
plain `create table` for `load_transfer_batches` and `load_transfer_items`, so it fails on a second run).

| Order | File | Needs | Applied |
|---|---|---|---|
| 1 | `20260929093000_job_stop_contacts.sql` | none | unknown |
| 2 | `20260929123000_planning_saved_plans.sql` | rls_02 (`can_access_tenant`). Needed by the Saved Plans section on Planning | unknown |
| 3 | `20260930150000_load_transfers_and_stop_windows.sql` | rls_02 (`can_access_tenant`). Needed by `/load-transfer` | unknown |
