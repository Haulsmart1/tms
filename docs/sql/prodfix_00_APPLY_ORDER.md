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
   select 'billing_01 platform_charges' as needs, to_regclass('public.platform_charges') is not null as ok
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
| 6 | `prodfix_30_vehicle_licence_gate.sql` | Licence gate trigger (errcode LIC01). First run the count query in its header to see how many live assignments are already unlicensed (they are grandfathered). |
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

## Dashboard and environment steps (not SQL)

Supabase:
- Auth, Providers, Email: turn off "Allow new users to sign up". Admin invites keep working.
- Email templates: Invite link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`;
  Magic Link template also points at `/auth/confirm?token_hash=...&type=email`.
- URL configuration: the redirect allowlist must accept `/auth/confirm?next=...`.
- Do not enable OTP captcha yet; the login route sends no captcha token.
- Storage: confirm `pod-files` allowed MIME types include `image/jpeg` (driver photos are now JPEG).

Vercel (production):
- `CRON_SECRET`: required, or no billing runs (the cron now answers 500 and logs why).
- `NEXT_PUBLIC_SITE_URL`: absolute links in emails and share links.
- Remove `POD_SHARE_SECRET`: nothing reads it now.
- Alerting: a non-200 from `/api/billing/run`, or no successful run in 26 hours. Watch logs for
  `MANUAL REVIEW` and `PAYMENT_INDETERMINATE`.

App data:
- Set `allowed_origin` on every live quote-request form token.
- Xero customers on 0% or mixed VAT: save `settings.xeroTaxTypes` (for example `{"0":"ZERORATEDOUTPUT"}`)
  through `POST /api/accounts/accounting`; there is no UI for it yet, and a sync with an unmapped rate is refused.
- Invitees who were locked out before this fix: re-invite them.
