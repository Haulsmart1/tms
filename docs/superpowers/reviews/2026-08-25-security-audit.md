# Security Audit — 2026-08-25

Full-codebase scan (fresh pass, not limited to the 2026-08-24 quick sweep, whose findings are folded in below). Every lead from the parallel audit was verified individually against the code before landing here. This report supersedes the root `SECURITY-SWEEP-2026-08-24.md`.

## Scope and method

Five surface groups were audited:

1. **Accounts / finance / payments** — `app/api/accounts/**`, `app/api/settings/payments/**`, `app/api/settings/documents/**`, `lib/accounts/`.
2. **Auth, tenancy, tokens** — `app/api/auth/callback`, `app/api/settings/users/**`, `app/api/settings/portal-invites`, `app/api/subcontractor/**`, `app/api/pod/share/**`, `app/api/public/**`, `lib/pod/`, `lib/tenant/`, `lib/roles.ts`, `lib/supabase/**`.
3. **Other API + shared lib** — `app/api/customers/**`, `app/api/subcontractors`, `app/api/driver/**`, `app/api/integrations/**`, `app/api/tomtom/**`, `app/api/request-access`, `lib/api/`.
4. **RLS + storage migrations** — `docs/sql/**`, read in numeric order.
5. **Tooling** — `npm audit` and danger-pattern greps (`dangerouslySetInnerHTML`, service-role reachability from client, input-built query clauses, non-constant-time compares, redirect surface).

**Method:** four read-only audit subagents produced leads; the controller then re-read each cited file and either confirmed it with a concrete exploit scenario or discarded it. Severities below reflect that verification, which in several cases lowered a subagent's initial guess (notably the customers/transactional-accounts writes, which turn out to match the intended RLS model).

**Not covered:** runtime/live verification of the Postgres RLS state (see C1 — requires running against the live DB, which this audit deliberately did not touch), penetration testing, client-side pages beyond their data-access calls, and the `tests/` Playwright project.

---

## Findings

### CRITICAL (conditional)

#### C1 — RLS enablement is not reproducible from the migrations; live state is unverified

**Files:** `docs/sql/rls_03_rekey_data_tables.sql`, `rls_04_identity_tables.sql`, `rls_04b_vehicles.sql`; verification harness `docs/sql/rls_09_verify.sql`.

The numbered migrations `create policy ...` on every tenant table but contain **no `alter table ... enable row level security`** for the data tables. The only `enable row level security` statements in the whole set are for `storage.objects` (rls_10a) and `registration_requests`. A policy on a table with RLS disabled is inert.

`rls_06_lock_secrets.sql:67` explicitly acknowledges enablement is a manual step ("New tables still need `alter table ... enable row level security` explicitly"), and `rls_09_verify.sql` exists precisely to prove isolation is live. This strongly indicates RLS **was** enabled out-of-band via the Supabase dashboard and verified — but that state lives only in the live database, not in version control, so it is unproven here and would not survive a rebuild from the numbered scripts.

**Why CRITICAL-conditional:** if RLS is in fact not enabled on the live data tables, every tenant table is fully exposed to any authenticated user (cross-tenant read/write) — a platform-wide breach. If it is enabled (most likely), this is a serious disaster-recovery and reproducibility gap rather than a live exploit.

**Action:**
1. **Verify now (Ethan, live DB):** run `docs/sql/rls_09_verify.sql` in the Supabase SQL editor; P1 (anon sees nothing) and P14 (staff foreign-tenant write blocked) passing confirms RLS is live.
2. **Fix reproducibility:** add an explicit `enable row level security` (and `force` where appropriate) migration so the state is in version control and CI-checkable. Drafted as an unapplied migration in the patch branch.

### HIGH

#### H1 — Broken function-level access control on the accounts/finance/payments API

**File:** `lib/accounts/server.ts:47-81` (`requireTenantAccess`) and its callers.

`requireTenantAccess` fetches the caller's membership `role` but never enforces it (a grep for any role check across `app/api/accounts/**` returns zero matches, whereas `settings/users/**` and `portal-invites` correctly gate on `["admin","super_admin"]`). Critically, these routes operate through the **service-role admin client**, which **bypasses RLS entirely** — so the app-layer check is the *only* authorization gate.

For plain table writes (invoices, credit notes, payments, quotations) this matches the intended RLS model anyway (see note under M-class / L1 — those tables are any-member-write by design). The genuine privilege escalation is the set of actions RLS would otherwise deny to a non-admin:

- **Xero integration** — connect / disconnect / setup / sync. `integration_connections` is service-role/admin-only (locked in `rls_06`), so RLS would deny a non-admin; here any member can bind, unbind, or push tenant data to an external accounting system.
- **Stripe Connect** — `POST /api/settings/payments/stripe/connect` creates a Stripe Connect account for the tenant.
- **Document / branding settings** — `PUT /api/settings/documents`, logo upload/delete.
- **Emailing financial documents** — invoice/quotation email routes (see M1).

**Exploit:** a tenant invites a user as role `driver` (lowest of admin/staff/driver, per `ALLOWED_INVITE_ROLES`). That driver's authenticated session calls e.g. `POST /api/accounts/accounting/xero/disconnect`, `POST /api/settings/payments/stripe/connect`, or `POST /api/accounts/accounting/xero/invoices/{id}/sync` directly. Nothing server-side stops it.

**Affected mutating handlers** (each calls `requireTenantAccess` with no role gate):
`accounts/accounting/route.ts:53` (POST), `.../xero/disconnect:31` (POST), `.../xero/callback:76` (GET, writes credentials), `.../xero/setup:84` (GET, state-changing), `.../xero/test:31` (POST), `.../xero/invoices/[id]/sync:312` & `:848` (POST), `invoices/route.ts:82` (POST), `invoices/[id]/route.ts:120` (PATCH), `invoices/[id]/email:171` (POST), `credit-notes:420` (POST) & `:577` (PATCH), `payments:42` (POST), `purchase-orders:50` (POST), `statements:41` (POST), `chase-letters:41` (POST), `quotations:273` (POST) & `:511` (PATCH), `quotations/[id]/convert:55` (POST), `quotations/[id]/email:239` & `:966` (POST), `quotations/[id]/share:116` (POST), `quote-requests:184` (PATCH), `settings/documents:281` (PUT), `settings/documents/logo:145` (POST) & `:322` (DELETE), `settings/payments/stripe/connect:45` (POST).

**Fix:** give `requireTenantAccess` an allowed-roles parameter and enforce it. **Open scope decision (see end of report):** whether to gate *all* of the above to admin, or only the config/integration/communication subset, leaving transactional invoice/quotation/payment writes at the any-member level the RLS model already permits.

#### H2 — `job-files` storage bucket is unrestricted (cross-tenant)

**File:** documented in `docs/sql/rls_10a_pod_files_policies.sql:32-36`, `README.md:176`, `CLAUDE.md:67`.

While `pod-files` was privatized (rls_10*), the sibling `job-files` bucket retains its four original permissive `storage.objects` policies scoped by `bucket_id` only, with no tenant path-segment check, and the bucket is public. Any authenticated user (or anyone with a path) can list, read, insert, or delete any tenant's job documents.

**Fix:** mirror the `pod-files` restrictive policies onto `job-files` (tenant-segment `can_access_tenant` check for select/insert, deny update/delete). Drafted as an unapplied migration in the patch branch. This was previously tracked as an architectural item; the fix is a small self-contained storage-policy migration, so it is drafted here for Ethan to apply and verify manually.

---

### MEDIUM (noted, not patched this pass)

- **M1 — Arbitrary email recipient on invoice and POD email.** `app/api/accounts/invoices/[id]/email/route.ts:130-133,406-414` and `app/api/pod/share/email/route.ts:292-316`. `recipient = body.to || <customer contacts>`; when `body.to` is present it is used verbatim after only an email-format regex, not constrained to the customer. Sends the invoice/POD PDF as attachment → data exfiltration and mail relay from the tenant's sending domain. Subject is CRLF-sanitized (`safeHeader`), so header injection is not possible.
- **M2 — POD share tokens cannot be revoked.** `lib/pod/shareToken.ts:39-119`, `app/api/pod/share/[token]/pdf/route.ts`. Self-contained HMAC tokens with a 7-day lifetime and no DB record (unlike `quotation_share_links.revoked_at`). A leaked/forwarded link streams another party's POD PDF unauthenticated for the full week with no way to invalidate it. Signature comparison itself is constant-time and correct.
- **M3 — Subcontractor listing ignores role.** `app/api/subcontractors/route.ts:75-105`. GET uses the service-role client (RLS bypassed), selects the membership `role` but never checks it, then returns `select("*")` on all subcontractors → any tenant member (incl. driver) enumerates every subcontractor and their financial columns. Fix is a one-line role check (role is already fetched).
- **M4 — Public quote-request origin allow-list bypass.** `app/api/public/quote-request/[token]/route.ts:229-231`. `originAllowed()` returns `true` when the `Origin` header is absent, so any server-side client (curl) bypasses `allowed_origin` and injects `quote_requests` rows into the token's tenant. Combined with M6 (no rate limit), an unauthenticated spam/injection vector.
- **M5 — Subcontractor invite pre-auth IDOR enumeration.** `app/api/subcontractor/users/invite/route.ts:140-181`. `targetEmployee` is fetched by `employeeId` with **no tenant filter**, and existence / employment-status / email-presence responses are returned *before* the permission check at `:207-220`. A user in another tenant can probe employee UUIDs to learn their existence and status. UUID guessing limits practicality; the ordering is still wrong.
- **M6 — No rate limiting on public token/invite endpoints.** Only `request-access` is throttled. `public/quote-request`, `public/quotation-share`, `pod/share/[token]/pdf`, and all invite POSTs have no throttle. HMAC signing makes token brute force infeasible, so the real risk is abuse/spam (M4) and mass-mailing (M1), not guessing.
- **M7 — pod-files tenant scoping is not reproducible from migrations.** `docs/sql/rls_10a_pod_files_restrictive.sql:21-44` — the restrictive policies that actually enforce pod-files tenant isolation are commented out (applied via dashboard). Same DR class as C1: a rebuild from the numbered scripts reverts pod-files to permissive bucket-only policies. Fix alongside C1/H2.
- **M8 — `sharp`/`libvips` advisories.** `npm audit` reports HIGH advisories in `sharp` (<0.35.0, several libvips CVEs). `sharp` processes uploaded POD photos and logos, so untrusted-image exposure is plausible. Fixable via `npm audit fix`. Verify the build after upgrading.

### LOW (noted, not patched this pass)

- **L1 — customers/transactional writes are membership-only at both layers.** `lib/api/server.ts:30-94` (`requireTenant`) checks membership not role, and the matching RLS policy for `customers` (and other default-branch tables: invoices, quotations, credit_notes, payments, quote_requests) is `for all using can_access_tenant` — i.e. **any member write is the intended design** (only `drivers`/`driver_work_rules` are role-gated via `can_manage_tenant`). So this is consistent-by-design, flagged as defense-in-depth / a product decision, not a clear vulnerability. It informs the H1 scope question.
- **L2 — customers `.or()` search sanitization is partial.** `app/api/customers/route.ts:147-152`. Only commas are stripped from the search term, not `(`/`)`/`*`/`.`. Impact is bounded: the term sits inside an `ilike` and the query is still AND-combined with `.eq("tenant_id", tenantId)`, so at worst a member widens their own tenant's search. Strip parentheses too for robustness.
- **L3 — documents PUT stores `logo_path` without tenant-prefix validation.** `app/api/settings/documents/route.ts:297-300` stores `logo_path` via `cleanText()` only, unlike `logo/route.ts` which enforces `isTenantLogoPath()`. A member could store a path pointing at another tenant's segment, later returned as a signed URL → storage IDOR. Reuse `isTenantLogoPath()` here.
- **L4 — invite route omits `company_id`.** `app/api/settings/users/invite/route.ts:282,319-325`. Profile and membership inserts never set `company_id`. Caller is tenant-scoped so no cross-tenant write, but a null `company_id` can desync `lib/tenant/context.ts` (which reads it). Data-integrity, not access-control.
- **L5 — `postcss` / `uuid` advisories.** `postcss` advisories are build-time (CSS processing); `uuid` moderate has no fix available. Low real exposure; upgrade opportunistically.

---

## Verified clean (checked, no action)

- **Auth callback open redirect** — `lib/auth/confirm.ts` `safeAuthNextPath` resolves `next` with `new URL(raw, origin)` and accepts only same-origin, falling back to `/dashboard`. Protocol-relative and cross-origin values rejected.
- **Cambridge Audio RMA bearer auth** — `crypto.timingSafeEqual` after equal-length guard; missing secret fails closed.
- **TomTom SSRF surface** — fixed `https://api.tomtom.com` base; user input only reaches encoded structured params; lat/lng range-validated. No user-controlled host/path.
- **Email HTML escaping** — `lib/documents/emailTemplate.ts` escapes every interpolated value; subjects CRLF-stripped.
- **Xero secret handling** — tokens AES-256-GCM encrypted at rest; status routes select only non-secret columns.
- **Service-role client isolation** — no `"use client"` file imports `lib/supabase/admin.ts` or the accounts server helper; the flagged `super-admin/requests/page.tsx` is a server component using the anon client for reads (RLS-guarded), service-role only for a count. Keys lack `NEXT_PUBLIC_`.
- **Quotation share links** — DB-backed with `token_hash`, `expires_at`, `revoked_at`, single-active-link revocation, constant-time compare, expiry enforced.
- **Role escalation guards** — `profiles_privileged_columns_guard.sql` blocks role/tenant/company columns on insert/update for non-super; `settings/users/[userId]` restricts assignable roles (no super_admin), enforces last-admin protection, scopes target to tenant.
- **Driver routes** — reads/writes scoped by `tenant_id` + `driver_id` from the session, not the request. No IDOR found.
- **Driver evidence upload** — UUID-validated ids, sanitized filename, tenant-prefixed storage path, `upsert:false`, content-type and byte validation.
- **request-access** — per-IP in-memory rate limit (platform headers), honeypot, zod caps, parameterized service-role insert, no readback. Residual: limiter is per-instance (speed bump only) — self-documented.
- **page.tsx `dangerouslySetInnerHTML`** — static schema.org JSON, no user input. Theme script in `layout.tsx` is a static constant.

---

## Patch plan for this pass

Per the approved spec, only HIGH/CRITICAL are patched now:

- **H1 (code):** patched on `ethan/security-patches` with TDD, using **option B** (gate only the integration, settings, and document-email actions; leave transactional writes at the member level the RLS model already permits). A pure `isRoleAuthorized` helper in `lib/accounts/authz.ts`, an `allowedRoles` parameter on `requireTenantAccess`, and `ACCOUNTS_ADMIN_ROLES` enforced on the Xero (connect/disconnect/setup/callback/test/sync), accounting-integration settings, Stripe Connect, document/branding settings + logo, and invoice/quotation email routes.
- **C1, H2 (SQL):** drafted as unapplied numbered migrations in `docs/sql/` (`rls_11_enable_rls_explicit.sql`, `rls_12_job_files_lockdown.sql`) for Ethan to review, apply, and verify manually (no automated runner; no live writes performed by this audit).

Everything under MEDIUM/LOW is queued here, not patched. M7 (pod-files restrictive-policy reproducibility) is a small companion to C1 but left queued to stay within the HIGH/CRITICAL scope; its fix is to move the already-live restrictive policies from `rls_10a_pod_files_restrictive.sql`'s comments into a reproducible migration.

## Open scope decision (blocks H1 patch)

The RLS model deliberately allows **any tenant member** to write the transactional accounts tables (invoices, quotations, credit notes, payments). So two options for the H1 fix:

- **(A) Gate everything to admin** — enforce `["admin","super_admin"]` on every accounts/finance mutation, including invoice/quotation/payment creation. Cleanest ("accounts = admin"), but diverges from the current RLS model and would block staff who may legitimately create invoices today.
- **(B) Gate only the config/integration/communication actions** — Xero connect/disconnect/setup/sync, Stripe Connect, document/branding settings, and document email — leaving transactional writes at the member level RLS already permits. Smaller blast radius, closes the genuine escalation, preserves staff workflows.

This is a product/role-model decision, so it is Ethan's call before the H1 route changes land.
