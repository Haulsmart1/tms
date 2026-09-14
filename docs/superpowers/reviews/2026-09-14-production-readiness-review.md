# Production-readiness review, 2026-09-14

Full-codebase review of main at b04e095, run as 9 parallel area reviews ahead of public self-service signup.
Totals: 9 CRITICAL, 42 HIGH, 66 MEDIUM, 85 LOW (with cross-area duplicates).
CONFIRMED means proven from the repo; PLAUSIBLE means it depends on live database state, settled by docs/sql/diag_2026_09_14_live_state.sql.

Decisions taken with Ethan: profiles is the single role source of truth; unlicensed vehicles are gated from use; past-due suspension will be built; live DB state is checked by a read-only script Ethan runs.


---

# Review 01: auth, signup/onboarding, invites, super-admin

Reviewer scope: proxy.ts, lib/auth/**, lib/supabase/**, lib/roles.ts, app/api/auth/**, app/auth/**, app/login/**,
app/api/request-access/**, invite flows (settings/users, settings/users/[userId], settings/portal-invites,
subcontractor/users/invite), app/super-admin/**, app/api/super-admin/**, lib/superAdmin/**, TenantGate,
TenantProvider, lib/tenant/context.ts, scripts/dev-login.mjs, profiles guard SQL, registration_requests RLS,
portal_invites migration. Read-only; nothing in the repo was changed. Live DB not touched.

Note on public signup: there is NO self-service signup/onboarding code in the repo today. Grepping app/ and lib/
finds no insert into `companies` or `tenants`, no `signUp`, no onboarding route. New customers arrive only through
`/api/request-access` (a lead row) plus manual provisioning. Anything "public signup" will need is net new, and
several findings below (AUTH-2, AUTH-3, AUTH-7) are prerequisites for it to work at all.

Summary: CRITICAL 0, HIGH 4, MEDIUM 6, LOW 8.

---

### [HIGH] AUTH-1: The edge auth gate (proxy.ts) never runs on any real route because the matcher regex is broken

- File: proxy.ts:125-127 (identical since ed0a23c, when it was middleware.ts)
- Verdict: CONFIRMED
- Problem: The matcher is written as a normal JS string `"/((?!_next/static|_next/image|.*\.[^/]+$).*)"`. In a
  JS string literal `\.` is just `.`, so the value Next receives is `/((?!_next/static|_next/image|.*.[^/]+$).*)`.
  The negative lookahead `.*.[^/]+$` then matches almost every path (any last segment of 2 or more characters),
  so the matcher EXCLUDES nearly every route. Evidence:
  - The production build on disk, `.next/server/functions-config-manifest.json`, records
    `"originalSource": "/((?!_next/static|_next/image|.*.[^/]+$).*)"`, with the backslash already gone.
  - Running Next's own `getMiddlewareMatchers` against that source (scratchpad `matcher.cjs`):
    `/` true, `/dashboard` false, `/api/accounts/invoices` false, `/super-admin/users` false. With the intended
    escaped source (`String.raw` or `\\.`): `/dashboard` true, `/api/accounts/invoices` true,
    `/favicon.ico` false.
- Failure scenario: an anonymous visitor to `/dashboard` or any `/api/...` route is never redirected or 401'd by the
  gate. They reach page shells and route handlers directly. Session cookies are never refreshed at the edge, so
  the "users logged out every hour / server components render against an expired token" problem the file's own
  comments describe is live. Memory and CLAUDE.md describe the gate as LIVE, and it is not. Each route's own auth
  plus RLS still hold, which is why this is HIGH rather than CRITICAL. But every route that forgot its own check
  (other reviewers' areas) is now exposed with no second layer.
- Fix: in proxy.ts use `"/((?!_next/static|_next/image|.*\\.[^/]+$).*)"` (double backslash) or `String.raw`. Add
  a lib/ unit test that runs `getMiddlewareMatchers` (or the same regex) against a path list, so this cannot
  silently regress, and exercise it once in a deployed preview with a signed-out curl to `/dashboard`
  (expect 307 to /login) and `/api/billing/preview` (expect 401 JSON). After fixing, confirm every legit public
  route is in lib/auth/publicRoutes.ts, since the gate will suddenly start enforcing (for example
  `/driver/jobs/[jobId]` and `/api/public/*` flows). No SQL.

### [HIGH] AUTH-2: Invited users land on "Account not linked to a company" (the invite never sets profiles.company_id or role_id)

- File: app/api/settings/users/invite/route.ts:282-305 (profile insert/update sets only `tenant_id`);
  docs/sql/rls_07_tenant_context.sql:13-19 (integrity check); docs/sql/profiles_privileged_columns_guard.sql:5-7
  (documents that get_my_company_id reads profiles.company_id)
- Verdict: CONFIRMED against the repo's SQL. The definition of `get_my_company_id()` lives only in the live DB; the
  guard file documents it as reading profiles.company_id.
- Problem: `get_tenant_context()` returns `no-tenant` for any non-super user unless
  `tenants.id = home tenant AND tenants.company_id = get_my_company_id()`. The invite route creates a profile with
  `tenant_id` only, so `company_id` is null and the equality fails. `role_id` is also never set, so even the
  "admin" invite is not an admin for RLS. This is the audit's L4, but its impact is larger than "data integrity":
  it breaks onboarding end to end.
- Failure scenario: Admin invites `new@haulier.co.uk` as staff. They click the link, sign in, and TenantGate shows
  "Account not linked to a company. Ask an administrator..." Nothing the tenant admin can do in the UI fixes it; only
  a super admin editing SQL can.
- Fix: in the invite route, look up `tenants.company_id` for `tenantId` and set `profiles.company_id` to it. Set
  `profiles.role_id` from the roles table for the invited role (and seed `roles` rows for staff/driver if absent,
  see AUTH-4). Do it on both the insert and the "existing profile with null tenant" branch. Longer term, move
  provisioning into one SECURITY DEFINER RPC so profile, membership and role are written atomically (see AUTH-9).
  Needs a small SQL seed for role rows if they do not exist.

### [HIGH] AUTH-3: Super-admin tenant re-parent locks every user of the moved tenant out

- File: app/api/super-admin/tenants/[id]/route.ts:230-237 (comment deciding not to touch profiles.company_id),
  :293-300 (update writes tenants only); docs/sql/rls_07_tenant_context.sql:13-19
- Verdict: CONFIRMED (same get_my_company_id dependency as AUTH-2)
- Problem: The route's comment asserts that nothing reads profiles.company_id on an ordinary tenant assignment, so
  it is left alone. But `get_tenant_context()` requires `tenants.company_id = get_my_company_id()`, and
  `can_access_tenant`/`can_manage_tenant`/`tenants_select`/`profiles_select`/`company_profiles_*` all key admins on
  get_my_company_id. After a move, `tenants.company_id` is the new company while every profile still carries the
  old one.
- Failure scenario: Super admin moves tenant T from company A to company B. Every staff user whose home tenant is T
  now gets `no-tenant` and is locked out. The target company's admins do not see T's users in profiles_select
  (company_id mismatch), and T's users cannot see company_profiles for B. The operation has no undo route.
- Fix: in the same request (ideally one SECURITY DEFINER function so it is atomic), update
  `profiles.company_id = newCompanyId where tenant_id = tenantId`. Decide explicitly what happens to company-wide
  admins of A whose home tenant is T. Correct the misleading comment. A SQL function is recommended; the plain
  service-role update also works as a stopgap.

### [HIGH] AUTH-4: Two role models; a memberships "admin" of one tenant can make anyone, including themselves, company-wide admin, and demotions do not stick

- File: app/api/settings/users/[userId]/route.ts:13-70 (authz from memberships), :130-165 (last-admin check counts
  memberships only), :230-262 (writes profiles.role_id via service role); app/api/settings/users/invite/route.ts
  (memberships only); docs/sql/rls_06_lock_secrets.sql:19-30 (memberships declared legacy, deny-all, "slated for
  removal"); docs/sql/rls_02_helpers.sql (RLS uses profiles.role_id and company_id)
- Verdict: CONFIRMED in code. The contents of the roles table are PLAUSIBLE: only `admin` is referenced in the repo
  (rls_01b_reseed.sql:12), and whether `staff`/`driver` rows exist is live-only.
- Problem: API routes (user management, invites, portal invites, subcontractor invites, accounts, subcontractors,
  POD share, tachograph) authorize via `memberships.role` with the service-role client. RLS authorizes via
  `profiles.role_id` plus `company_id`. The two are not kept in sync:
  1. PATCH /api/settings/users/[userId] lets any memberships-admin of tenant T set `profiles.role_id = admin` on any
     member of T whose profile tenant is T, including their own id. That is RLS admin, which is COMPANY-wide:
     `can_access_tenant` grants every tenant in the company. A person meant to administer one depot gains read and
     write on all sibling depots. The service-role write bypasses the privileged-columns guard trigger by design.
  2. Demoting to staff or driver only syncs role_id if a `roles` row with that name exists. If not (likely, per the
     reseed file), `profiles.role_id` stays admin, so the demoted user keeps company-wide RLS admin while the UI
     says "staff".
  3. The last-admin guard counts memberships, not RLS admins, so it can lock a company out of RLS admin or leave
     phantom admins.
  4. There is no route that deletes a membership or removes a user, so a departed employee's
     `memberships.role = admin` keeps API-level admin powers (Xero, Stripe Connect, invites) indefinitely.
- Failure scenario: Company with tenants North and South. Dave is invited to North as "admin" (memberships). Dave
  PATCHes himself with role admin; `profiles.role_id` becomes admin; Dave now reads and edits South's jobs,
  invoices and drivers through the normal client. Or: the owner demotes Dave to staff; role_id is unchanged (no
  staff role row), and Dave keeps full company access.
- Fix: pick one source of truth, profiles plus RLS, as rls_06 already intends. Short term: in [userId] PATCH forbid
  `userId === caller`, authorize with `can_manage_tenant(tenantId)` evaluated as the caller (user client RPC)
  instead of memberships, fail with 500 if the target role row is missing rather than silently skipping, and count
  admins from profiles. Add a remove-user route that deletes the membership and nulls the profile's
  tenant/company/role. Medium term: migrate the 10 memberships readers to an RPC. SQL: seed roles rows; optional
  RPCs.

### [MEDIUM] AUTH-5: Any tenant admin can hijack another company's user's post-login destination and grant them portal access without consent

- File: app/api/settings/portal-invites/route.ts:186-240 (driver branch: existing auth user by email gets an
  active driver_users link); app/api/subcontractor/users/invite/route.ts:228-330; app/api/settings/users/invite/route.ts:196-215,
  :307-340; app/api/auth/callback/route.ts:48-111, :346-364 (portal destination overrides `next` for every login)
- Verdict: CONFIRMED
- Problem: All three invite routes resolve the invitee by email across the whole platform and, if an account
  exists, link it silently: no email, no acceptance step. The callback then sends ANY user with an active
  driver_users or subcontractor_users row to the portal dashboard, overriding `next`, even if they are a staff or
  admin user of a different company.
- Failure scenario: With public signup, an attacker creates a company, adds a driver whose email is
  `owner@victim-haulier.com` (driver email is tenant-editable), and clicks invite. The response says "already had an
  account" (enumeration, see AUTH-11). From then on, every magic-link login by the victim lands on the attacker's
  driver dashboard. The attacker can also attach the victim as "admin" of the attacker's tenant via
  settings/users/invite, and if the victim's profile tenant_id is null, the route sets it to the attacker's tenant
  (invite/route.ts:291-301).
- Fix: never link an existing account implicitly. Create a pending invite row plus a signed, expiring acceptance
  link emailed to the address, and link only after the invitee accepts while signed in as that email. In the
  callback, only apply the portal redirect when the user has no console profile, or when `next` is a portal path.
  No SQL beyond an invites table if you add one.

### [MEDIUM] AUTH-6: Login CSRF / session swap via the legacy GET callback

- File: app/api/auth/callback/route.ts:370-410 (GET runs verifyOtp with any `token_hash` and any `type`)
- Verdict: CONFIRMED
- Problem: The POST path was hardened (Origin check, type must be `email`, scanner-safe confirm page). GET still
  verifies an OTP straight from query parameters, with `type` unvalidated (`recovery`, `invite`, `email_change`,
  `magiclink`, and so on). So a cross-site link logs the clicker in as whoever minted the token, and email scanners
  consume invite tokens on GET, the exact failure the confirm page was built to stop.
- Failure scenario: The attacker requests a magic link for their own account, copies the token_hash, and sends the
  victim `https://app/api/auth/callback?token_hash=...&type=magiclink&next=/jobs`. If the victim is signed out,
  they become the attacker and may enter customer data or card details into the attacker's tenant. If the victim
  is signed in, verification fails and "recover-existing-session" redirects normally. Separately, Outlook Safe
  Links pre-fetches invite URLs and burns the single-use token.
- Fix: point invite `redirectTo` at `/auth/confirm` (all three invite routes), extend `isMagicLinkEmailType` to
  allow `invite`, and make GET render or redirect to the confirm page instead of verifying. Keep `code` exchange on
  GET only if PKCE is still used (PKCE is bound to the verifier cookie, so it is not CSRF-able). No SQL.

### [MEDIUM] AUTH-7: Login creates an auth user for any typed email; enables email bombing and quota DoS, and makes later invites silently skip the email

- File: app/login/page.tsx:40-47 (`signInWithOtp` without `shouldCreateUser: false`, no captcha or throttle);
  app/api/settings/users/invite/route.ts:196-201 (existing user means no invite email)
- Verdict: CONFIRMED in code. Supabase project-level rate limits and captcha settings are PLAUSIBLE, since they are
  live dashboard config I could not see. Already noted in docs/console-design-system-refactor-candidates.md:94 and
  never fixed.
- Problem: (a) Anyone can create unlimited `auth.users` rows and trigger Supabase to email arbitrary addresses from
  the product's sending domain. Supabase's project-wide hourly email cap is shared, so a script can exhaust it and
  block real users from signing in. (b) A user who typed their email on /login before being invited already
  exists, so the invite route sends no email and returns "already had a TMS account". The invitee never learns
  they were added. (c) Such users see "Account not linked to a company", a dead end with no path to request
  access.
- Failure scenario: A bot posts 10k random addresses to Supabase `/auth/v1/otp` with the public anon key. That
  endpoint is hit directly, so it bypasses the app entirely. The email quota is exhausted, and customers cannot get
  login links for the rest of the hour.
- Fix: set `shouldCreateUser: false` on login (until self-signup exists, at which point route signup through a
  server endpoint with captcha), disable open signups in Supabase Auth settings, and enable Supabase captcha
  (Turnstile) for OTP. In the invite route, when the user already exists, still send a notification or magic link.
  Give the no-tenant panel a sign-out button and a link to request access. Supabase dashboard change, no SQL.

### [MEDIUM] AUTH-8: request-access has no durable rate limit or dedupe; public launch invites lead and notification spam

- File: app/api/request-access/route.ts:18-65 (per-instance in-memory limiter), :118-125 (no dedupe);
  lib/validation/requestAccess.ts:24-27 (no max on vehicles)
- Verdict: CONFIRMED
- Problem: The limiter is per serverless instance and resets on cold start; the code comment admits it is only a
  speed bump. There is no captcha, no duplicate check, and emails are stored as typed (no lowercasing). Each
  accepted POST writes a row and fires a Teams card plus a Resend email, so it burns email quota and floods the
  sales channel. `vehicles` has no upper bound, so `vehicles: 99999999999` passes zod and 500s at the int column
  ("Could not save your request").
- Failure scenario: A distributed bot (many IPs, or many warm instances) submits thousands of junk leads. The Teams
  channel becomes unusable and the Resend quota is spent, so real leads stop notifying; `notified:false` is only
  logged.
- Fix: add Turnstile verification server-side, back the limiter with Upstash or Vercel KV, dedupe on
  lower(email) within 24h (return ok without re-notifying), store `email.toLowerCase()`, and cap `vehicles` (for
  example max 100000). A unique partial index is optional SQL.

### [MEDIUM] AUTH-9: Invite flow is non-atomic and O(all users); partial failures leave orphans and it slows with growth

- File: app/api/settings/users/invite/route.ts:84-101 (listUsers paging over the whole platform), :196-340
  (auth invite, then users, then profiles, then memberships, each a separate write); same shape in
  portal-invites/route.ts:79-95 and subcontractor/users/invite/route.ts:67-93
- Verdict: CONFIRMED
- Problem: (a) Every invite pages through all `auth.users` 1000 at a time to find one email. With public signup
  this becomes seconds per invite and multiplies GoTrue load. (b) The invite email is sent first, then 3 to 5
  writes follow. If any fails, the user has an emailed invite and an auth account but no profile or membership
  (lands on no-tenant), and a retry takes the "existing user" path, which sends no email. (c) Two concurrent
  invites for the same email can both miss and both call inviteUserByEmail, or both insert memberships; there is
  no visible unique constraint in the repo. (d) Raw Supabase error messages are returned to the client
  (`error.message` in the 500 bodies), leaking table and column names.
- Failure scenario: The memberships insert fails with a transient error after the invite email is sent. The
  invitee signs in to a dead end; the admin retries and gets "already had a TMS account and has now been added"
  with still no email.
- Fix: look up users by email with a SECURITY DEFINER RPC (`select id from auth.users where lower(email)=lower($1)`)
  or `generateLink`, instead of listUsers. Do DB provisioning first in one RPC transaction and send the email last.
  Add unique (tenant_id, user_id) on memberships if missing. Return generic error strings. Needs SQL (RPC, and
  possibly a unique index).

### [MEDIUM] AUTH-10: Subcontractor invite leaks employee existence and status to any signed-in user before authorization (audit M5, still open)

- File: app/api/subcontractor/users/invite/route.ts:140-181 (lookup by employeeId with no tenant filter, then 404,
  409 and 400 responses), :183-220 (permission check afterwards)
- Verdict: CONFIRMED (unchanged since the 2026-08-25 audit)
- Problem: Existence, employment status and whether an email is on file are disclosed before checking the caller
  can manage that tenant. Also, with public signup, "any signed-in user" means anyone on the internet.
- Failure scenario: A user from another company iterates candidate UUIDs. A 404 versus 409 versus 400 distinguishes
  "no such employee", "inactive or not directly employed" and "no email".
- Fix: move the membership/subcontractor_users permission check before any detail-revealing response, returning the
  same 404 for "not found" and "not allowed". No SQL.

### [LOW] AUTH-11: Account enumeration through invite responses

- File: app/api/settings/users/invite/route.ts:342-352; portal-invites/route.ts:241-247, :345-350;
  subcontractor/users/invite/route.ts:325-331
- Verdict: CONFIRMED
- Problem: "X already had a TMS account" versus "Invite sent" tells any tenant admin (with public signup: anyone who
  signs up) whether an email has an account anywhere on the platform.
- Failure scenario: A competitor signs up and probes `ops@rival.co.uk` to learn who uses TMS Wizzard.
- Fix: return one neutral message ("Invitation sent") in both cases, which fits naturally with AUTH-5's
  acceptance-link design. No SQL.

### [LOW] AUTH-12: Login discards the `next` deep link the proxy provides

- File: proxy.ts:47-52 sets `?next=`; app/login/page.tsx:41 hardcodes `next=/dashboard`;
  app/super-admin/layout.tsx:26 and app/components/TenantGate.tsx:24 redirect to bare `/login`
- Verdict: CONFIRMED
- Problem: After signing in, users always land on /dashboard instead of the page they asked for (for example a
  shared job link). Once AUTH-1 is fixed this becomes the common path.
- Fix: read `next` from `window.location.search`, pass it through `safeAuthNextPath`-style validation, and
  URL-encode it into `emailRedirectTo` (`/auth/confirm?next=${encodeURIComponent(next)}`). Have TenantGate and the
  layout include `next`. No SQL.

### [LOW] AUTH-13: Callback redirect statuses and error handling inconsistencies

- File: app/api/auth/callback/route.ts:141-148, 176-182, 263-268, 296-302, 312-318 (error redirects use default 307
  even on POST); :346-364 (mutates Location on an existing redirect)
- Verdict: CONFIRMED
- Problem: The success path uses 303 for POST (commit 8dd27a1), but every failure redirect from the POST path is 307,
  which re-POSTs the form body (token_hash) to `/login`. /login is a page, so the POST likely yields 405 or an
  error page instead of the friendly "link expired" message. `request.formData()` throwing on a malformed body is
  unhandled (500).
- Failure scenario: A user clicks "Continue" on an already-used link; verifyOtp fails; the browser re-POSTs to
  `/login?error=auth` and sees an error instead of the resend prompt.
- Fix: pass `{ status: redirectStatus }` to every redirect in `completeAuthentication`, and wrap `formData()` in
  try/catch redirecting to `/login?error=invalid_link` with 303. No SQL.

### [LOW] AUTH-14: Portal routing silently falls back to the console when the lookup errors, and the callback builds its own service-role client

- File: app/api/auth/callback/route.ts:24-46, 57-83
- Verdict: CONFIRMED
- Problem: A driver_users lookup error is logged and the code falls through to subcontractor lookup, then to `next`
  (/dashboard), so a driver lands on a no-tenant panel with no hint. The route also duplicates createAdminClient
  (as do the three invite routes and lib/accounts/server.ts) instead of lib/supabase/admin.ts, weakening the
  "only admin.ts holds the key" rule stated in proxy.ts and admin.ts.
- Fix: on lookup error, redirect to `/login?error=portal` rather than guessing. Import the single
  `lib/supabase/admin.ts`. No SQL.

### [LOW] AUTH-15: Super-admin audit trail is console-only and tenant moves are non-atomic

- File: lib/superAdmin/guard.ts:130-148; app/api/super-admin/tenants/[id]/route.ts:45-52, :293-313
- Verdict: CONFIRMED (self-documented)
- Problem: The most consequential writes (company edits, tenant re-parent) leave only a Vercel log line, which rolls
  over. Combined with AUTH-3, a move that locks users out has no durable record of who did it or what the previous
  company_id was, so there is nothing to undo from.
- Fix: add a `super_admin_audit` table and write `{actor, action, target, old_company_id, new_company_id}` inside
  the same SECURITY DEFINER function recommended in AUTH-3. SQL migration.

### [LOW] AUTH-16: Super-admin billing page inserts v1-shaped invoices from the browser for every company

- File: app/super-admin/billing/page.tsx:161-180
- Verdict: PLAUSIBLE (depends on live invoices RLS and columns; other reviewers own billing)
- Problem: The client inserts `invoices` with `company_id` and no `tenant_id`, relying on a super-admin RLS branch.
  The pricing is v1 (`computeChargeAmounts`) even for v2 companies, which the page itself notes. It is gated only
  by the layout's server check plus RLS, and there is no confirmation or idempotency, so a double-click creates two
  invoices.
- Fix: move to a `withSuperAdmin` API route with an idempotency key, and skip v2 companies. Flag to the billing
  reviewer. No SQL.

### [LOW] AUTH-17: Brand-new or orphaned users have no way out of the no-tenant screen

- File: app/components/TenantGate.tsx:43-52; app/components/TenantProvider.tsx:103-114
- Verdict: CONFIRMED
- Problem: The "Account not linked to a company" panel has no sign-out button, no link to request access, and no
  retry. A `get_tenant_context` RPC failure on first load is also shown as no-tenant (TenantProvider:108-113),
  which misdescribes an outage as an account problem. Users whose tenant was deleted, moved (AUTH-3) or never
  linked (AUTH-2, AUTH-7) are stuck and cannot even switch accounts.
- Fix: add Sign out, Retry and "Request access" actions, and add a distinct `error` status for RPC failure.
  No SQL.

### [LOW] AUTH-18: proxy.ts comments and publicRoutes header still say middleware.ts; public allowlist carries a stale entry

- File: lib/auth/publicRoutes.ts:1-6 ("middleware.ts"), :17-18 (`/api/integrations/cambridge-audio/rma`)
- Verdict: CONFIRMED (cosmetic, but relevant once AUTH-1 makes the allowlist actually enforce)
- Problem: The header references the old filename. More importantly, once the matcher works, any legitimately
  public surface missing from the list will start 401ing or redirecting: for example the driver job page
  (`/driver/jobs/[jobId]`, described in CLAUDE.md as driver-facing outside the console) and any Stripe or Xero
  webhook route. None of this was ever tested, because the gate never ran.
- Fix: after fixing AUTH-1, enumerate `app/**/route.ts` and customer-facing pages, decide public or not for each,
  and extend publicRoutes.test.ts. No SQL.

---

## Previously queued audit items re-checked in this area

- M5 (subcontractor invite pre-auth enumeration): STILL OPEN, see AUTH-10.
- M6 (no rate limiting on invite POSTs): STILL OPEN. None of the three invite routes throttle, and each sends email
  and scans all auth users (AUTH-9).
- L4 (invite route omits company_id): STILL OPEN and more severe than logged, see AUTH-2.
- "Auth callback open redirect" (verified clean): still clean. `safeAuthNextPath` rejects cross-origin and
  protocol-relative values, and the portal override only uses fixed paths.
- "Role escalation guards" (verified clean): the trigger itself is sound, but the service-role PATCH route
  deliberately bypasses it, see AUTH-4.

## Checked and found clean

- lib/superAdmin/guard.ts `withSuperAdmin`: fails closed, uses getUser (validated), and every /api/super-admin route
  is wrapped. The layout performs the same check server-side.
- normalizeTenantEdit / normalizeCompanyEdit: allowlisted fields only, UUID validated; routes build patches from
  them.
- /super-admin/requests: reads via the RLS client, and service role is used only for a count. registration_requests
  RLS: no anon insert, super-admin select/update only.
- publicRoutes.normalizePathname: dot-segment and double-slash handling is correct, prefixes require a "/" boundary,
  and `/api/pod/share` minting is correctly excluded.
- request-access: honeypot, zod caps, CRLF strip on subject, trusted-header IP key, no readback of the insert.
- scripts/dev-login.mjs: service role read from .env.local only, prints a single-use link; not reachable from the app.
- lib/supabase/admin.ts: no client component imports it; only server files do (grep).

---

# Review 02: SQL and database security model

Scope: docs/sql/**, supabase/migrations/** (15 files), cross-checked against every `.from()`, `.rpc()` and `storage.from()` in app/ and lib/.
Method: read-only. No Supabase connection. Every finding below was traced against the SQL text. PLAUSIBLE means the repo cannot prove live state; a confirming query is given.

## Re-check of the 2026-08-25 audit SQL items

| Item | Status | Evidence |
|---|---|---|
| C1 RLS enablement not reproducible | STILL OPEN | `docs/sql/rls_11_enable_rls_explicit.sql:9` still says NOT YET APPLIED; `billing_03_mid_cycle_charges.sql:69-78` repeats that. rls_11 also has a logic gap (SQL-2). |
| H2 job-files unrestricted | STILL OPEN, and the drafted fix cannot work as written | `rls_12_job_files_lockdown.sql:24` NOT YET APPLIED; see SQL-1. |
| M7 pod-files restrictive policies not reproducible | STILL OPEN | `rls_10a_pod_files_restrictive.sql:21-44` policies still commented out; plus role-scope question in SQL-8. |

Background fact that raises several severities: `app/login/page.tsx:44` calls `signInWithOtp` without `shouldCreateUser: false`, so any email address can already become an `authenticated` user today. Wherever this file says "any authenticated user", read "anyone on the internet", even before self-service signup launches.

---

### [CRITICAL] SQL-1: job-files bucket is still cross-tenant, and rls_12 cannot fix it as written
- File: docs/sql/rls_12_job_files_lockdown.sql:24, :35-38, :44-57; docs/sql/rls_10a_pod_files_policies.sql:4-14; docs/sql/rls_10a_pod_files_restrictive.sql:21-44
- Verdict: CONFIRMED (repo state and the fix's defects); live bucket state PLAUSIBLE
- Problem: H2 is unapplied, and the draft has two independent defects:
  1. `drop policy if exists ... on storage.objects` needs ownership of `storage.objects`, which is `supabase_storage_admin`. rls_10a documents that exactly this DDL failed with 42501 from the SQL editor and from a grant attempt. `if exists` does not skip the ownership check, so the script aborts at line 35.
  2. Even if the drops ran, they guess policy names ("job-files insert" and so on). The header says a non-matching drop is a "safe no-op" because the new policies "define access on their own". That is false: PERMISSIVE policies OR together, so the original bucket-only permissive policies would keep granting full access and the new ones would add nothing.
- Failure scenario: anyone signs up with a throwaway email and uses the anon key plus their own JWT to call storage `list`, `download`, `upload` and `remove` on `job-files`. They can read, overwrite or delete every tenant's job documents.
- Fix: reuse the approach that actually worked for pod-files, which is RESTRICTIVE policies created through the dashboard:
  ```sql
  create policy job_files_read_restrict on storage.objects as restrictive for select to authenticated, anon
    using (bucket_id <> 'job-files' or ((storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           and public.can_access_tenant(((storage.foldername(name))[1])::uuid)));
  create policy job_files_insert_restrict on storage.objects as restrictive for insert to authenticated, anon
    with check (bucket_id <> 'job-files' or ((storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           and public.can_access_tenant(((storage.foldername(name))[1])::uuid)));
  create policy job_files_update_deny on storage.objects as restrictive for update to authenticated, anon using (bucket_id <> 'job-files');
  create policy job_files_delete_deny on storage.objects as restrictive for delete to authenticated, anon using (bucket_id <> 'job-files');
  update storage.buckets set public = false where id = 'job-files';
  ```
  Commit the executed text uncommented in a new numbered file, and retire rls_12 so nobody runs it as-is.
- Verify: `select policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='storage' and tablename='objects' and (qual ilike '%job-files%' or with_check ilike '%job-files%'); select id, public from storage.buckets where id='job-files';`

### [CRITICAL] SQL-2: RLS coverage of most app tables cannot be determined from the repo, and rls_11 would leave policy-less tables open
- File: docs/sql/rls_11_enable_rls_explicit.sql:20-36; docs/sql/rls_03_rekey_data_tables.sql:25-37; docs/sql/rls_06_lock_secrets.sql:66-69
- Verdict: PLAUSIBLE (live state); rls_11 logic gap CONFIRMED
- Problem:
  1. The app queries more than 60 tables that have no `create table` and no RLS DDL anywhere in the repo. They include jobs, job_stops, invoices, invoice_lines, credit_notes, credit_note_lines, credit_note_allocations, payment_allocations, customer_payments, customer_contacts, customer_addresses, customer_rates, quotations, quotation_lines, quotation_stops, quotation_share_links, quotation_terms_versions, accounting_integrations, accounting_sync_log, document_settings, document_delivery_log, cambridge_rma_imports, subcontractor_users, subcontractor_employees, pod_evidence and vehicle_licences.
  2. rls_03 was a one-shot loop run on 2026-07-28. It only re-keyed tables that existed at that point AND had a `tenant_id` column. Two groups were never re-keyed: tables created afterwards, such as Stuart's accounts and quotation feature from 2026-08-14, and child tables with no `tenant_id` (the `*_lines`, `*_allocations` and `*_jobs` link tables). Those keep whatever policies they were created with.
  3. rls_11 enables RLS only on tables that already have at least one policy (`join pg_policies`). It skips a table that has RLS off AND zero policies. That table is the worst case, fully readable and writable by any role that holds Supabase's default grants.
- Failure scenario: a table such as `credit_note_lines` or `quotation_lines` was created with RLS off (the SQL-editor default) before rls_06 revoked default grants. Any signed-up user runs `supabase.from('quotation_lines').select('*')` and reads every tenant's pricing.
- Fix:
  - Run the report query below now.
  - Enable RLS on every public table with `rls_enabled = false`, whether or not it has policies. Deny-all is the correct failure mode.
  - Give each child table that lacks `tenant_id` an explicit policy that checks through its parent, e.g. `using (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_access_tenant(i.tenant_id)))`.
  - Commit a schema-only dump of public (tables, policies, grants, functions) as the baseline.
- Verify:
  ```sql
  select c.relname, c.relrowsecurity,
         (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
         has_table_privilege('anon', c.oid, 'select') as anon_select,
         has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') order by c.relrowsecurity, c.relname;
  select tablename, policyname, roles, cmd, qual, with_check from pg_policies
  where schemaname='public' and (qual = 'true' or with_check = 'true' or roles @> '{public}');
  ```

### [CRITICAL] SQL-3: reporting views probably bypass RLS for every caller
- File: app/api/accounts/ready-to-invoice/route.ts:17 (`jobs_ready_to_invoice`); app/api/accounts/statements/route.ts:44 (`customer_aged_debt`); no DDL in repo
- Verdict: PLAUSIBLE
- Problem: both names read like views, and the risk chain is:
  - A Postgres view without `security_invoker = true` applies base-table RLS as the view OWNER. That is postgres, which bypasses RLS.
  - PostgREST exposes views exactly like tables.
  - Supabase default privileges grant SELECT on new relations to anon and authenticated.
  - The app only reads these views through the service role, so the app would never reveal that the direct REST path is open.
  - `schema_rls_dump.sql` only dumps `relkind='r'`, so views have never been audited.
- Failure scenario: a signed-up stranger calls `GET /rest/v1/customer_aged_debt?select=*` with the anon key and gets every operator's customers and outstanding balances.
- Fix: `alter view public.jobs_ready_to_invoice set (security_invoker = true); alter view public.customer_aged_debt set (security_invoker = true); revoke all on public.jobs_ready_to_invoice, public.customer_aged_debt from anon, authenticated;` (the app only uses them via the service role). Apply the same treatment to every other view and materialized view in public.
- Verify: `select c.relname, c.relkind, c.reloptions, has_table_privilege('anon', c.oid, 'select') anon_sel, has_table_privilege('authenticated', c.oid, 'select') auth_sel from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m');`

### [HIGH] SQL-4: six tables' policies rely on `auth_tenant_id()`, which is defined nowhere in the repo
- File: supabase/migrations/20260813_portal_invites.sql:25; 20260902130000_job_items_baseline.sql:44,58,72-73,87; 20260902133000_job_item_scans.sql:67; 20260902140000_load_manifests.sql:141,149,157
- Verdict: PLAUSIBLE (security depends on the unseen body); inconsistency with the tenancy model CONFIRMED
- Problem: six tables use `tenant_id = auth_tenant_id()` instead of the reviewed `can_access_tenant`: `driver_users`, `job_items` (full CRUD for authenticated), `job_item_scans`, `load_manifests`, `load_manifest_items` and `load_scan_events`. Nothing in the repo shows the function's source, volatility or definer status.
  - If it reads a JWT claim from `user_metadata`, the user can write that claim with `supabase.auth.updateUser({data:{tenant_id}})`. That gives any user full CRUD on another tenant's job_items: CRITICAL.
  - If it reads `profiles.tenant_id`, company admins cannot see sibling tenants' rows. That contradicts the documented model and tends to provoke a loosening "fix".
- Failure scenario: a user sets their auth metadata `tenant_id` to a victim tenant UUID, then runs `supabase.from('job_items').update(...)` against the victim's rows.
- Fix: replace every `auth_tenant_id()` predicate with `public.can_access_tenant(tenant_id)`, in both USING and WITH CHECK. Then drop or document `auth_tenant_id`.
- Verify: `select pg_get_functiondef(p.oid), p.prosecdef, p.provolatile from pg_proc p where p.proname='auth_tenant_id';`, then check whether the body references `auth.jwt()`, `user_metadata` or `app_metadata`.

### [HIGH] SQL-5: v2 arrears billing can be evaded by deleting vehicles before the period closes
- File:
  - docs/sql/rls_04b_vehicles.sql:19-21: `vehicles_admin_all` is FOR ALL, so it includes DELETE.
  - app/vehicles/page.tsx:540: the browser deletes vehicle rows directly.
  - lib/billing/periodServer.ts:79-107,120-130: close enumerates LIVE vehicles, then fetches licences `in (vehicle_id)`.
  - docs/sql/billing_06_period_billing.sql:305-315: explicitly designed so deleting a billed vehicle succeeds.
- Verdict: CONFIRMED (logic path); FK behaviour of `vehicle_licences.vehicle_id` PLAUSIBLE
- Problem: v2 computes the invoice at close from licence rows, and it finds those rows through `vehicles`. billing_07 STEP 2 blocked licence deletion because deleting one "destroys the evidence", but the parent vehicle row is still deletable by any company admin from the browser. Once the vehicle row is gone, the close job never selects its licences. That is true whether the FK cascades (licences deleted) or is missing (licences orphaned). Only `ON DELETE RESTRICT` would prevent it, and the billing_06 comment shows that deleting billed vehicles is expected to work. v2 is now the default for new companies (b04e095).
- Failure scenario: a 20-truck operator runs the whole period, deletes 18 vehicle rows the day before close and re-creates them the next morning. The invoice is the GBP 129 floor instead of roughly GBP 1,161 net before discount, and the trick repeats every period.
- Fix: forbid deleting a vehicle that has any licence row, and have the UI archive instead (for example `vehicles.archived_at`). As a second layer, make the close job find licences by company through tenants rather than through live vehicle ids.
  ```sql
  alter table public.vehicle_licences drop constraint <existing_fk>,
    add constraint vehicle_licences_vehicle_id_fkey foreign key (vehicle_id)
    references public.vehicles(id) on delete restrict;
  ```
  Alternatively, add a BEFORE DELETE trigger on vehicles that raises when licences exist and `current_user` is not service_role.
- Verify: `select conname, confdeltype from pg_constraint where conrelid='public.vehicle_licences'::regclass and contype='f';` (`c` = cascade; `r`/`a` = restrict/no action), plus `select has_table_privilege('authenticated','public.vehicles','delete');`

### [HIGH] SQL-6: quotation-acceptance SECURITY DEFINER RPCs are directly callable, bypassing the token check and allowing forged legal evidence
- File:
  - supabase/migrations/20260823060000_quotation_acceptance_portal.sql:84-383: no REVOKE or GRANT at all.
  - 20260823193000_quotation_acceptance_company_position.sql:371-397: revokes only FROM public.
  - Legacy `accept_quotation_share`, `decline_quotation_share` and `mark_quotation_share_viewed` are not in the repo.
  - lib/quotations/publicShare.ts:64: the share link id travels inside the token payload.
- Verdict: PLAUSIBLE (depends on live function ACLs); the missing revoke in the first file is CONFIRMED
- Problem:
  - On Supabase, `postgres` default privileges grant EXECUTE on new public functions to `anon` and `authenticated` directly. `revoke all ... from public` does not remove those separate ACL entries, and `accept_quotation_share_with_terms` has no revoke at all.
  - The functions take only `p_share_link_id`, not the secret token. The token_hash check, rate limiting and origin checks all live in the Next route, which a direct RPC call skips.
  - `p_ip_address` and `p_user_agent` come from the caller and are stored as "immutable acceptance evidence".
- Failure scenario: someone who has seen a share link calls `POST /rest/v1/rpc/accept_quotation_share_with_terms` with the anon key. That can be anyone the email was forwarded to, or any tenant staff member, since staff can SELECT `quotation_share_links`. They accept on the customer's behalf with a fabricated name, IP and user agent, and auto-conversion creates a job. If the legacy 3-argument `accept_quotation_share` is also executable, T&C clause evidence is skipped entirely.
- Fix:
  ```sql
  revoke all on function public.accept_quotation_share_with_terms(uuid,text,text,text[],boolean,inet,text) from public, anon, authenticated;
  revoke all on function public.accept_quotation_share_with_business_identity(uuid,text,text,text,text,text[],boolean,inet,text) from public, anon, authenticated;
  -- and the legacy accept_quotation_share / decline_quotation_share / mark_quotation_share_viewed, using their live signatures
  grant execute on function public.accept_quotation_share_with_business_identity(uuid,text,text,text,text,text[],boolean,inet,text) to service_role;
  ```
  Better still, have the functions accept the token hash and verify it themselves.
- Verify: `select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proacl from pg_proc p where p.pronamespace='public'::regnamespace and p.proname ~ 'quotation';`. Any `anon=X`, `authenticated=X` or leading `=X` (PUBLIC) entry means the function is exposed.

### [HIGH] SQL-7: two sources of truth for role (memberships.role vs profiles.role_id) let a tenant-scoped admin mint a company-wide RLS admin
- File:
  - app/api/settings/users/[userId]/route.ts:34-57: the caller is authorized from `memberships`.
  - Same file, :198-245: writes `memberships.role`, then syncs `profiles.role_id`.
  - app/api/settings/users/invite/route.ts:282,321-325: the profile is inserted with no role_id and no company_id.
  - docs/sql/rls_02_helpers.sql and rls_08: RLS `admin` is COMPANY-wide, via `get_my_role()` reading profiles.
  - docs/sql/rls_06_lock_secrets.sql:18-27: calls memberships "unused by the app, slated for removal".
  - supabase/migrations/20260911131500_tachograph_activity_ledger.sql:128-135,240-247: definer functions authorize from memberships.
- Verdict: PLAUSIBLE (depends on the target profile having `company_id` set, which is true for legacy rows)
- Problem: the service-role routes authorize from per-tenant `memberships.role`, while RLS authorizes from `profiles.role_id`, where `admin` covers every tenant in the company. The `[userId]` route copies a tenant-level role choice into that company-wide column. The guard trigger exempts service_role (`profiles_privileged_columns_guard.sql:25`), so the route is the only gate. The two sources also drift in normal use: an invited "admin" is RLS staff with a null `company_id`, so `get_tenant_context` returns `no-tenant` (audit L4, still open). And the rls_06 comment calling memberships dead is a trap for whoever cleans up.
- Failure scenario: company C has depots T1 and T2. A depot manager with `memberships.role='admin'` for T1 only promotes a T1 colleague (or themselves, unless self-edit is blocked) to `admin`. `profiles.role_id` becomes admin, and that user now passes `can_manage_tenant` for T2: they can delete T2 vehicles and drivers, read billing rows and edit company_profiles.
- Fix: choose one model.
  - (a) RLS reads memberships: `can_access_tenant` means a membership exists for the tenant, and `can_manage_tenant` means that membership's role is admin.
  - (b) Service routes may not write `profiles.role_id` unless the caller is a company admin according to profiles.

  Either way, add a trigger enforcing `profiles.company_id = tenants.company_id` for `profiles.tenant_id`, and correct the rls_06 comment.
- Verify: `select p.id, r.name profile_role, m.tenant_id, m.role membership_role, p.tenant_id, p.company_id from public.profiles p left join public.roles r on r.id=p.role_id left join public.memberships m on m.user_id=p.id where coalesce(r.name,'staff') <> coalesce(m.role,'staff') or p.company_id is null;`

### [HIGH] SQL-8: pod-files restrictive policies bind only `authenticated`; if an original permissive policy targets `public`, anon is unrestricted
- File: docs/sql/rls_10a_pod_files_restrictive.sql:13-17 (four original permissive policies left live), :22-44 (all four restrictive policies are `to authenticated`)
- Verdict: PLAUSIBLE
- Problem: a RESTRICTIVE policy only constrains the roles it names. The repo never records the `roles` of the original policies: the verify query at :67-72 selects `roles`, but its output was not written down, and dashboard templates often default to `public`. If any original pod-files policy is `TO public` or `anon`, anon-key requests match it and no restrictive policy applies. `buckets.public = false` does not help, because it only controls the unauthenticated public-URL path. Separately, M7 remains open.
- Failure scenario: an unauthenticated client using the anon key (which ships in the JS bundle) calls `storage.from('pod-files').list('<tenant>')` and then `.remove([...])`, reading or destroying every proof of delivery.
- Fix: recreate the four restrictive policies `to anon, authenticated`, or add an anon deny-all restrictive policy for the bucket. Commit the executed SQL uncommented.
- Verify: `select policyname, permissive, roles, cmd from pg_policies where schemaname='storage' and tablename='objects' and (qual ilike '%pod-files%' or with_check ilike '%pod-files%') order by permissive, cmd;`. Every PERMISSIVE row must have roles exactly `{authenticated}`.

### [MEDIUM] SQL-9: jobs and job_stops live policies appear to have drifted from rls_03
- File: supabase/migrations/20260819_planning.sql:12-13 ("both tables already carry tenant policies (cmd ALL, tenant_id = get_my_company_id())"); docs/sql/rls_03_rekey_data_tables.sql:50-53 (should be `tenant_access using can_access_tenant(tenant_id)`)
- Verdict: PLAUSIBLE
- Problem: the planning migration's author looked at live policies three weeks after rls_03 and recorded a company-id predicate. Either that comment is wrong, or the policies were recreated out of band. If the predicate is live, it compares a tenant key with a company id, which cuts both ways. Staff lose their own tenant's rows, which invites someone to loosen the policy. Rows that carry the company id in `tenant_id` become visible to every user in the company, whichever tenant they belong to.
- Failure scenario: a staff user in depot T1 sees depot T2's legacy jobs, or a later "fix" broadens the predicate further.
- Fix: after confirming, re-apply the rls_03 `tenant_access` policy to `jobs` and `job_stops` only.
- Verify: `select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public' and tablename in ('jobs','job_stops');`

### [MEDIUM] SQL-10: `rls_verify()` is left installed as a callable JWT-impersonation gadget, and a real super_admin UUID is committed
- File: docs/sql/rls_09_verify.sql:15-19 (invoker function in public, never dropped), :30-37, :43-44, :154-157 (hard-coded super_admin and admin profile UUIDs)
- Verdict: PLAUSIBLE (depends on whether it was dropped after use)
- Problem: the function calls `set_config('request.jwt.claims', {sub: <argument>})` and `set_config('role', ...)`, so it lets a caller act as any user id they pass. The chain:
  - Default EXECUTE goes to anon and authenticated, so it is reachable at `/rest/v1/rpc/rls_verify`.
  - PostgREST's session user `authenticator` is a member of anon and authenticated, so the role switch succeeds.
  - The caller can therefore run the probes as any user id, including the super_admin id printed in the repo.
  - Output is limited to counts and PASS/FAIL strings, such as the platform-wide job count.
  - The mutating probes roll back, but they still take row locks and fire triggers.
- Failure scenario: a signed-up stranger calls it with the committed super_admin UUID and learns platform-wide job volume and live RLS probe outcomes, a map of which controls fail.
- Fix: `drop function if exists public.rls_verify(uuid,uuid,uuid);`. Rewrite the file to create and drop the function inside one transaction (or use a non-exposed schema), and remove real UUIDs from the repo.
- Verify: `select proname, proacl from pg_proc where proname='rls_verify';`

### [MEDIUM] SQL-11: rls_03 says "safe to re-run", but a re-run today would silently overwrite purpose-built policies
- File: docs/sql/rls_03_rekey_data_tables.sql:1-3, :26-37 (loops over every CURRENT tenant_id table and drops EVERY policy)
- Verdict: CONFIRMED
- Problem: many later tables have `tenant_id` but are not in `excluded`. They include `period_invoice_lines` (admin-only read), `accounting_oauth_credentials` (deliberately policy-less), `tachograph_sync_runs`, `planning_route_*`, `driver_transport_*`, `load_*`, `job_items`, `driver_users` and `vehicle_licences`. A re-run swaps each table's policies for `tenant_access FOR ALL using can_access_tenant`. Staff would read period invoice lines. `accounting_oauth_credentials` would get an ALL policy protected only by a grant revoke. Every select-only design would become write-capable wherever a grant is ever restored.
- Failure scenario: someone re-runs rls_03 "to re-verify tenancy", as its header invites. Encrypted OAuth credentials are then one `grant` away from staff, and period billing lines leak to staff.
- Fix: replace the header with DO NOT RE-RUN, or change `excluded` into a frozen include-list of the original tables.
- Verify: diff `select table_name from information_schema.columns where table_schema='public' and column_name='tenant_id'` against the include list.

### [MEDIUM] SQL-12: billing audit records cascade-delete on ordinary vehicle and company deletes, including 'pending' unknown-outcome charges
- File:
  - docs/sql/billing_03_mid_cycle_charges.sql:148-153 (`vehicle_cycle_coverage.vehicle_id ... on delete cascade`) and :170-172 (`vehicle_addon_charges.vehicle_id ... on delete cascade`).
  - billing_01_platform_billing.sql:6,24 and billing_06_period_billing.sql:174,263-265,374-376: every `companies` FK is `on delete cascade`.
  - billing_05_addon_intent.sql:48-52: says never to delete a pending row.
- Verdict: CONFIRMED
- Problem: a company admin can delete a vehicle from the browser (rls_04b `vehicles_admin_all`; app/vehicles/page.tsx:540). That erases its succeeded add-on charge records and any `pending` row whose Square outcome is unknown. billing_05 says a pending row must never be deleted, because it is the only trace of a payment that may have gone through. A company delete wipes platform_charges, period_charges and billing_periods, which are VAT and financial records that must be retained.
- Failure scenario: a mid-cycle add-on crashes after Square captured money, leaving a pending row. The operator deletes and re-adds the vehicle. The pending row vanishes, the reconciliation query finds nothing, and the customer's payment becomes untraceable.
- Fix: change these FKs to `on delete restrict` on every charge, coverage and period table, and archive vehicles and companies instead of deleting them.
- Verify: `select conrelid::regclass, conname, confrelid::regclass, confdeltype from pg_constraint where contype='f' and conrelid::regclass::text in ('vehicle_addon_charges','vehicle_cycle_coverage','platform_charges','period_charges','billing_periods','period_invoice_lines','company_billing');`

### [MEDIUM] SQL-13: signup is effectively open already, and nothing in the repo shows how a new auth user is provisioned
- File: app/login/page.tsx:44 (no `shouldCreateUser:false`); there is no trigger on `auth.users` in docs/sql or supabase/migrations
- Verdict: PLAUSIBLE
- Problem: the database model assumes "authenticated" means an invited user. A brand-new user with no profile correctly gets false from `can_access_tenant`. That user still reaches:
  - every surface in SQL-1, SQL-3, SQL-6, SQL-8 and SQL-10;
  - any `TO public` or `using (true)` legacy policy (SQL-2).

  A live `handle_new_user`-style trigger could also copy `raw_user_meta_data`, which the user controls at signUp, into `profiles.tenant_id`, `company_id` or `role_id`. The guard trigger would not catch it: such a trigger runs as its postgres owner, and `postgres` is exempt in `guard_profiles_privileged_columns` (line 25).
- Failure scenario: a sign-up passes `options.data = {tenant_id: <victim>}`, a live provisioning trigger writes it to profiles, and the attacker joins the victim's tenant.
- Fix: before public launch, inventory auth triggers and make provisioning an explicit service-role route that never reads user metadata. Set `shouldCreateUser:false` on the login page until signup is intended.
- Verify: `select tgname, pg_get_triggerdef(t.oid), p.proname, pg_get_functiondef(p.oid) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='auth.users'::regclass and not t.tgisinternal;`

### [LOW] SQL-14: other SECURITY DEFINER functions revoke only from PUBLIC, so anon keeps EXECUTE
- File: supabase/migrations/20260911131500_tachograph_activity_ledger.sql:261-289; 20260908050000_planning_route_itineraries.sql:583-623; docs/sql/rls_07_tenant_context.sql:37-38
- Verdict: CONFIRMED pattern; currently mitigated by in-body `auth.uid()` / `can_access_tenant` checks
- Problem: this is the same Supabase default-privilege gotcha as SQL-6. The bodies fail closed for anon today, but the ACL provides no second layer. load_manifests (:653-735) and billing_04 do it correctly, revoking `from public, anon, authenticated`.
- Fix: add `anon` (and `authenticated` where only the service role should call) to every revoke.
- Verify: `select proname, proacl from pg_proc where pronamespace='public'::regnamespace and prosecdef;`

### [LOW] SQL-15: SECURITY DEFINER search_path lets pg_temp shadow tables
- File: 20260911131500_tachograph_activity_ledger.sql:115,229 and 20260908050000_planning_route_itineraries.sql:225,551 (`pg_catalog, public`); 20260823060000_quotation_acceptance_portal.sql:20,96 and 20260823193000_quotation_acceptance_company_position.sql:32 (`public`)
- Verdict: CONFIRMED (not exploitable today without arbitrary SQL)
- Problem: when `pg_temp` is not listed, Postgres searches it FIRST for relations. A session that can create a temp table named `drivers` or `memberships` could subvert the authorization lookups. PostgREST offers no raw SQL, so this is hardening only.
- Fix: `set search_path = pg_catalog, public, pg_temp`, as load_manifests already does.

### [LOW] SQL-16: job_items and job_item_scans do not bind the child's tenant to the parent's tenant
- File: 20260902130000_job_items_baseline.sql:10-11,54-58; 20260902133000_job_item_scans.sql:5-10
- Verdict: CONFIRMED
- Problem: `job_items.job_id` is a single-column FK, and the INSERT/UPDATE policy checks only the row's own `tenant_id`. A member can attach items to another tenant's job UUID or repoint `job_id` on update. The damage is integrity pollution, limited because create_load_manifest re-checks tenancy. The newer tables already use the right pattern, composite `(tenant_id, id)` keys.
- Fix: add `unique (tenant_id, id)` on jobs and a composite FK `(tenant_id, job_id) references jobs(tenant_id, id)`.

### [LOW] SQL-17: migration hygiene (non-idempotent creates, silent `if not exists` skips, and a "snapshot" that is only a query)
- File:
  - Bare `create table` / `create policy`: 20260902133000_job_item_scans.sql:2,29,62; 20260902140000_load_manifests.sql:5,27,67,136-157; 20260908050000_planning_route_itineraries.sql:3,34,77,155-171.
  - `if not exists` on tables that may already exist (the same class as the invoice_lines incident): 20260813_portal_invites.sql:1; 20260814_xero_oauth_credentials.sql:3; 20260902130000_job_items_baseline.sql:7.
  - docs/sql/schema_rls_dump.sql:1-57.
- Verdict: CONFIRMED
- Problem:
  - Re-runs of the bare-create migrations error partway through.
  - `if not exists` silently accepts a different pre-existing table shape, then applies RLS and grants to it.
  - `schema_rls_dump.sql` is a query, not a committed result. It also omits views, storage.objects policies, auth-schema triggers, function ACLs and column grants, so drift between the repo and live cannot be diffed.
- Fix:
  - Guard every create.
  - Add a pre-flight `pg_tables` assertion, as billing_06 does.
  - After each migration batch, commit the dump OUTPUT, extended to relkind v/m, storage policies, proacl and auth triggers.

### [LOW] SQL-18: the manual tachograph activity overlap check is racy
- File: 20260911131500_tachograph_activity_ledger.sql:162-172
- Verdict: CONFIRMED
- Problem: the `exists` overlap check and the insert are not serialized, so two concurrent saves can create overlapping driver activity records. This is a compliance data-integrity problem, not an access-control one.
- Fix: `perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_driver_id::text));` before the check, or an exclusion constraint `exclude using gist (tenant_id with =, driver_id with =, tstzrange(start_time, end_time) with &&)`.

### [LOW] SQL-19: policy performance on large tenant tables
- File: docs/sql/rls_08_null_write_hardening.sql:4-21; rls_03 (applied to telematics_positions, gps_events, driver_activity_logs and others)
- Verdict: PLAUSIBLE
- Problem: `can_access_tenant(tenant_id)` runs per row and calls `get_my_role()` up to twice, plus a tenants subquery. The repo shows no `tenant_id` index on most tables; only driver_activity_logs, job_items and the newer tables add one. Telematics tables will degrade to sequential scans with a function call per row.
- Fix: index `tenant_id` on every tenant table. Consider a set-returning helper `accessible_tenant_ids()` used as `tenant_id in (select public.accessible_tenant_ids())`, so it is evaluated once per statement.
- Verify: `select c.relname from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' where c.relnamespace='public'::regnamespace and c.relkind='r' and not exists (select 1 from pg_index i where i.indrelid=c.oid and i.indkey[0]=a.attnum);`

### [LOW] SQL-20: `user_permissions` is written from the browser even though rls_06 records it as locked
- File: app/settings/permissions/page.tsx:86 (browser upsert); docs/sql/rls_06_lock_secrets.sql:18-21 ("matching users/user_permissions" deny-all); rls_03 excludes it from re-keying
- Verdict: PLAUSIBLE
- Problem: either the page is broken, or the table has live policies and grants that no migration records, with nothing constraining which tenant or user a row targets. Nothing in app/ reads it for authorization today, which keeps it LOW, but it is a ready-made escalation point for whoever wires it up.
- Fix: decide, then either lock it (deny-all) or give it a `can_manage_tenant` policy with WITH CHECK.
- Verify: `select policyname, cmd, roles, qual, with_check from pg_policies where tablename='user_permissions'; select relrowsecurity from pg_class where oid='public.user_permissions'::regclass;`

---

## Verified clean (checked, no finding)
- `can_access_tenant` / `can_manage_tenant` (rls_08): null-safe, SECURITY DEFINER with `search_path`, fail closed when role, tenant or company is null.
- `profiles_privileged_columns_guard.sql`: covers INSERT and UPDATE with invoker rights, which is correct for a `current_user` test. No INSERT/DELETE grant or policy exists on profiles.
- Billing tables in billing_01/03/06: RLS is enabled in-file, reads are admin/super only, and writes are revoked (03 and 06 also from PUBLIC). `record_cycle_charge` is invoker and service_role only.
- vehicle_licences guards (billing_03 STEP 2/3, billing_07): column allowlist plus invoker triggers, and the trigger name ordering is correct. billing_07 STEP 1 and STEP 2 are recorded as applied in docs/handoffs/2026-09-10-period-billing.md:58-60.
- `create_load_manifest` / `record_load_manifest_event`: revoked from public, anon and authenticated, and every input is re-validated against `p_tenant_id`.
- `replace_planning_route_itinerary` / `invalidate_planning_route_itinerary`: check `can_access_tenant` and re-validate vehicle, driver, job and stop ownership.
- `accounting_oauth_credentials`, `integration_connections`: RLS on, no policies, grants revoked.
- `get_tenant_context`: checks that the home tenant belongs to the user's company; the super, admin and staff branches are correct.

---

# Review 03: platform billing v1 and shared billing entry points

Scope read in full: app/api/billing/{run,card,cancel,preview}, app/api/licences/{activate,estimate},
lib/billing/{server,run,schedule,money,prorata,addon,addonServer,squareThrow,vehicleCount,activation,
cancellation,licenceDelete}.ts, routing functions in periodServer.ts (resolveActivation,
isPeriodBillingCompany, quoteVehicleAddition, cancelCompany, ensureOpenPeriod,
openPeriodAndChargeMinimum head), lib/payments/*, components/billing/*, app/settings/billing/*
(page, V1Billing, PaymentMethodCard), app/super-admin/billing/page.tsx (data + invoice insert),
app/settings/licences/page.tsx (call sites), app/subscription page/*, vercel.json,
lib/auth/publicRoutes.ts, scripts/migrate-company-to-period-billing.mjs, docs/sql/billing_01..05.
Items already accepted in docs/superpowers/reviews/2026-08-26-square-platform-billing-review-notes.md
are not repeated unless the severity is materially different.

Counts: CRITICAL 1, HIGH 4, MEDIUM 3, LOW 8.

---

### [CRITICAL] BILL1-1: Billing is opt-in: an active licence is the only billable signal and it gates nothing
- File: lib/billing/vehicleCount.ts:41-45, lib/billing/activation.ts:134-144, lib/billing/run.ts:37-39, app/api/licences/activate/route.ts:406-413
- Verdict: CONFIRMED
- Problem: Both models bill only vehicles that carry an active `vehicle_licences` row. Nothing operational reads that table. A grep of app/ and lib/ for `vehicle_licences` finds only billing, stats, the invoices count page and super-admin pages; jobs, planning, vehicles, tracking and the driver app never read it (the driver dashboard's "licence" is the driver's driving licence). A vehicle with no active licence can still be created, given jobs, planned and tracked.
- Failure scenario: A self-service v2 signup adds vehicles and never ticks "Active for billing". No activation happens, so `open_period_and_charge` never runs and no period ever opens. The company pays GBP 0 forever with full use of the platform. A v1 company can deactivate every licence (always allowed via the `!writeBody.active` path, no charge) the day before `next_charge_on`. The cron then counts 0 vehicles, skips Square (`grossPence` 0) and advances the cycle. The company keeps operating every vehicle. Once self-service signup opens, this is the default path, not an exploit.
- Fix: Make billable state enforceable. Either (a) gate vehicle usability on billable state: job and planning assignment and telematics refuse a vehicle with no active licence, enforced in the DB (trigger or RLS `with check` on jobs.vehicle_id and similar), not just in the UI; or (b) bill on the `vehicles` rows the company operates, not on a self-declared licence flag. (a) needs a SQL migration; either option needs a product decision.

### [HIGH] BILL1-2: Fleets already active when a company adds its first card under the v2 default are never billed
- File: app/api/billing/card/route.ts:182-208, app/api/licences/activate/route.ts:444-456, lib/billing/periodServer.ts (ensureOpenPeriod ~163; only live caller is openPeriodAndChargeMinimum ~852)
- Verdict: CONFIRMED (code path); how many companies are affected depends on live data
- Problem: A v2 period opens only when an activation of a vehicle that is NOT already billable reaches `open_period_and_charge`. The card route's v2 branch inserts `company_billing` and returns, without looking at the existing billable fleet. The only other `billing_periods` insert is the manual migration script, which requires an existing row. Before the flip to v2 (b04e095), a company with no billing row got `free / no_subscription` activations under v1 (addon.ts:60-62). Under v1 the first card save then charged the whole fleet; under v2 it charges nothing. Adding further licences to those vehicles returns `already_billable` before the v2 block (activate route 444-456), so no period ever opens.
- Failure scenario: Company A signed up before 2026-09-14, activated 20 vehicles free (no card yet, v1 no_subscription), then adds a card today. The row is created as v2_period with no period. No close ever runs for them, and they pay nothing until they happen to activate a vehicle that has no active licence. The same applies to any licence made active by SQL, backfill or support tooling for a company with no card.
- Fix: In the card route's v2 branch, run `fetchBillableVehicles`. If it is non-empty, call `openPeriodAndChargeMinimum` there, or refuse the save and route the company through the migration script. Also run a one-off audit now: v2 rows with no open period whose company has an active licence. No schema migration; an audit query plus a code change.

### [HIGH] BILL1-3: A v1 cycle charge with an unrecorded outcome wedges permanently once the fleet changes, and the company gets free vehicles the whole time
- File: lib/billing/server.ts:214-244 (body carries amount and vehicle count in the note), lib/billing/run.ts:37-39, lib/billing/addon.ts:92-100, app/api/billing/run/route.ts:145-156
- Verdict: CONFIRMED
- Problem: `runChargeCycle` records nothing until Square answers. On an indeterminate throw (timeout, 5xx, 429, no status code), a PENDING status, or a failed `record_cycle_charge` rpc, the cron catch logs it and leaves `company_billing` unchanged. The next run sends the same key `(company, cycleDate, 1)`, but the body contains `amountMoney` and `note: ... ${vehicleCount} vehicles`. If the fleet size changed in between, Square answers IDEMPOTENCY_KEY_REUSED and the code throws PAYMENT_INDETERMINATE again, every day, forever. `retry_at` stays null while `next_charge_on` is in the past, so `selectAddonAction` returns `free / cycle_due` for every addition. That changes the fleet size, which guarantees the wedge. billing_05 fixed exactly this for add-ons with a pending intent row; the cycle charge never got the same fix.
- Failure scenario: Square times out on the 06:00 charge and never processed it. That afternoon the company adds 5 vehicles free (cycle_due). Every later cron run hits IDEMPOTENCY_KEY_REUSED. The company is never charged again, adds vehicles free indefinitely, and the only signal is a `failed` count in a JSON response nobody reads (ledger item 4). If Square HAD processed the payment, the customer paid but no coverage row was ever written, so later add-ons are mis-priced as well.
- Fix: Mirror billing_05. Insert a `pending` platform_charges row holding the amounts, vehicle count, vehicle-id snapshot and card before calling Square, then replay from that row. That needs a SQL migration: widen the status check, add card, customer and snapshot columns, and have `record_cycle_charge` settle the row instead of inserting. Also: alert on any PAYMENT_INDETERMINATE older than 24h, and make `selectAddonAction` return `blocked` rather than `free` when `next_charge_on` is more than 1 day in the past.

### [HIGH] BILL1-4: A missing CRON_SECRET (or a cron that isn't running) means no billing at all, and v1 add-ons turn free for every company
- File: app/api/billing/run/route.ts:16-22, vercel.json, lib/billing/addon.ts:92-100
- Verdict: PLAUSIBLE (project memory and the 2026-09-10 handoff both say CRON_SECRET was still missing from Vercel)
- Problem: Without the env var every cron call answers 401. No v1 renewal charges, no v2 period closes, no dunning. Nothing surfaces this. Worse, every v1 company's `next_charge_on` then slides into the past, so `selectAddonAction` answers `free / cycle_due` for every vehicle addition with no bound on how overdue the date may be. The code comment calls that acceptable on the assumption the cron runs within hours.
- Failure scenario: Production runs a month with the secret missing. v1 companies pay nothing for renewals and add unlimited vehicles free. v2 periods pass `period_end` and are never invoiced. When the secret is finally set, BILL1-6's catch-up charges all fire at once.
- Fix: Confirm CRON_SECRET in Vercel production now. Alert when no successful cron run has happened in 26h (for example a heartbeat row checked by an external monitor). Cap the cycle_due free window (for example `days === 0` only, blocked when overdue by more than 1 day). No SQL unless a heartbeat table is added.

### [HIGH] BILL1-5: past_due v1 companies keep full service forever and are never charged again
- File: lib/billing/run.ts:23-26, app/api/billing/card/route.ts:290-314, components/billing/PastDueBanner.tsx
- Verdict: CONFIRMED
- Problem: Once dunning is exhausted, `selectDueAction` returns `none` for good. The only recovery is the admin voluntarily replacing their card. Nothing suspends the company, nothing auto-cancels it after N days, and every already-active vehicle stays active. The addon gate blocks only NEW activations. The handoff records the missing suspension for v2; v1 has exactly the same gap, and it is not in the review ledger.
- Failure scenario: A company's card expires. After 4 failed attempts it is past_due. It ignores the banner and runs its whole fleet on the platform indefinitely with no further charge attempts.
- Fix: Implement the read-only suspension gate for past_due (both models) and an auto-cancel or escalation after a fixed number of days. Needs a proxy.ts or route-level gate; no billing migration.

### [MEDIUM] BILL1-6: Card replacement after a long past_due back-bills every missed cycle on consecutive days at today's fleet size
- File: lib/billing/run.ts:83-89, app/api/billing/card/route.ts:316-408, lib/billing/run.ts:37-39, app/settings/billing/V1Billing.tsx:444-445
- Verdict: CONFIRMED
- Problem: The recovery charge uses `cycleDate = next_charge_on`, which has been frozen since the company went past_due. On success `next_charge_on = cycleDate + 28`, which is still in the past, so the next cron run charges the next cycle (attempt 1, new key), and the next run the one after that, one per day until caught up. Every catch-up charge prices the CURRENT fleet, not the fleet of that historical cycle, and writes coverage against stale cycle dates. The UI then says "Card updated and the outstanding charge was taken", implying a single charge.
- Failure scenario: A company is past_due for 4 months and replaces its card. It is charged 5 full 4-weekly cycles over 5 days with no warning. That invites chargebacks, and the customer sees charges for months it may consider suspended.
- Fix: Decide the policy explicitly. Either take one arrears charge with a clear quote before submitting the card, or restart the cycle from today after recovery (`next_charge_on = computeNextChargeOn(today)`) and handle missed cycles as a separate, disclosed invoice. No SQL needed.

### [MEDIUM] BILL1-7: The serial cron has no time budget: slow Square calls starve the v2 close and create unrecorded outcomes
- File: app/api/billing/run/route.ts:13, 57-157, 173-185; lib/payments/square.ts:24-30
- Verdict: PLAUSIBLE (the code shape is confirmed; the real impact depends on SDK default timeouts and Vercel plan limits)
- Problem: The v1 loop charges every company serially before `closeDuePeriods`. The Square client is built with no `timeoutInSeconds` and the loop has no elapsed-time check. A handful of hanging calls pushes the function past `maxDuration = 300`. Vercel then kills it mid-call: that company's outcome is unrecorded (feeding BILL1-3), and v2 periods do not close that day, which repeats daily if the stall persists.
- Failure scenario: A Square degradation makes 5 calls hang. The function dies at 300s, v2 `closeDuePeriods` never runs, and one v1 company is left with an indeterminate payment.
- Fix: Set a short per-request timeout on payment calls. Check elapsed time in the loop and stop starting new charges past a budget. Run the v2 close first or as its own cron entry. No SQL.

### [MEDIUM] BILL1-8: The super-admin "create invoice" writes v1-priced rows into the customer invoicing `invoices` table for every company, v2 included
- File: app/super-admin/billing/page.tsx:135-175
- Verdict: PLAUSIBLE (depends on the live `invoices` schema; the insert itself is visible in code)
- Problem: The amount is `computeChargeAmounts(count).netPence / 100`, v1 graduated pricing, with no fork on `billing_model`, so it is wrong for any v2 company. It is inserted from the browser into `invoices`, which the accounts feature reads (Xero sync, credit notes, chase letters). The count also comes from unscoped browser selects subject to the 1000-row cap (ledger item 7).
- Failure scenario: A super admin clicks create invoice for a v2 company. A wrong-amount "pending" platform invoice lands in a ledger that accounting tooling reads and may sync or chase.
- Fix: Remove the button, or move it to a server route that forks on `billing_model` (v2 reads `period_invoice_lines`) and writes to a platform-billing table, not the customer invoice table. No SQL unless a platform invoice table is added.

### [LOW] BILL1-9: A vehicle activated during the cron's Square call for that company rides free for a whole cycle
- File: lib/billing/server.ts:194-229, app/api/billing/run/route.ts:103-113, lib/billing/addon.ts:98-100
- Verdict: CONFIRMED (narrow window)
- Problem: `runChargeCycle` snapshots billable vehicles, calls Square and records, and only then does the route advance `next_charge_on`. An activation inside that window sees `next_charge_on == today`, gets `free / cycle_due`, and is in neither the charged set nor coverage. After the CAS, its next charge is 28 days away.
- Failure scenario: A timing-lucky (or scripted) activation on charge day gets 28 free days per vehicle.
- Fix: Take a per-company advisory lock or a `charging_at` marker on `company_billing`, set before the snapshot and checked by the activate route (blocked while set). The column is a small migration.

### [LOW] BILL1-10: Concurrent add-on activations of different vehicles all price off the same baseline
- File: app/api/licences/activate/route.ts:643-652
- Verdict: CONFIRMED
- Problem: `baselineCount = max(billable, covered)` is read without serialisation, so N parallel adds all use baseline B. Across a band edge (vehicle 10 to 11 goes from GBP 10 to GBP 8 per week) each vehicle is charged the higher marginal rate. Nothing refunds the difference.
- Failure scenario: An admin at fleet size 10 activates 3 vehicles from two tabs. All three are charged GBP 10 per week pro-rata instead of GBP 8. The overcharge is small.
- Fix: Serialise per company (advisory lock rpc), or recompute the baseline at intent-insert time. Minor.

### [LOW] BILL1-11: Cron secret compared with `!==`, and a 1000-row company cap halts BOTH models
- File: app/api/billing/run/route.ts:20, 40-48
- Verdict: CONFIRMED
- Problem: The string comparison is not timing-safe (low practical risk over the network, but trivial to fix with `crypto.timingSafeEqual` on equal-length buffers). The row-cap refusal returns 500 before `closeDuePeriods`, so reaching 1000 non-canceled rows (every self-service card save counts, including zero-vehicle v2 companies) stops all v1 AND v2 billing.
- Fix: Use timingSafeEqual. Paginate `company_billing` by `company_id` instead of refusing. No SQL.

### [LOW] BILL1-12: Card route double-submit or concurrent first save returns a raw Postgres error and leaves a stray enabled card
- File: app/api/billing/card/route.ts:183-201, 409-412
- Verdict: CONFIRMED
- Problem: Two first-time v2 saves both pass `!existing`. The second insert hits the primary key (23505), and `errorResponse` passes `insertError.message` straight into the 500 body. Unlike the preview, cancel and activate routes, this route never sanitises 500s, so PostgREST and Square messages reach the browser. The losing request's Square card stays enabled.
- Fix: Catch 23505 and re-read or treat as success. Sanitise 500s like the activate route. Disable the orphaned card.

### [LOW] BILL1-13: v1 customers get no price before their card is charged for an add-on
- File: app/api/licences/estimate/route.ts:71-78 (returns `{model: "v1_immediate"}` only), app/api/licences/activate/route.ts:653-664
- Verdict: CONFIRMED
- Problem: Activating a licence on v1 charges a pro-rata amount immediately, and the UI never quotes it. The estimate route has no v1 branch.
- Fix: Add a v1 quote using `computeAddonAmounts(baseline, days)` with the same inputs the activate route uses. No SQL.

### [LOW] BILL1-14: v1 companies cannot cancel self-service while the cron keeps charging
- File: app/api/billing/cancel/route.ts:70-81
- Verdict: CONFIRMED
- Problem: The 409 tells a v1 customer to contact support. Once signup is self-service, a customer who cannot stop a recurring card charge is a chargeback and consumer-law risk. Only legacy v1 companies are affected now that new companies default to v2.
- Fix: Implement v1 cancel (status canceled, no refund) or migrate the remaining v1 companies to v2.

### [LOW] BILL1-15: Activate route reports v2 gross with a hardcoded 20% VAT
- File: app/api/licences/activate/route.ts:546-549
- Verdict: CONFIRMED
- Problem: `grossPence` ignores `settings.vat_rate`, which the charge path honours (`vat_rate ?? 20`). It is display only, but it is wrong as soon as any company carries a different rate.
- Fix: Return the recorded charge's gross, or use `settings.vat_rate`.

### [LOW] BILL1-16: Sandbox Square Subscriptions scripts live under app/ with top-level throws and hardcoded ids
- File: app/subscription page/catalogue_and_library.tsx, subscription_plan_creation.tsx, subscription_test_flow.tsx
- Verdict: CONFIRMED
- Problem: These are not routes (there is no page.tsx), but they sit in the app tree and are typechecked. They hardcode a location id and a 10% tax, and model a third billing approach (the Square Subscriptions API) that contradicts the real one. If anything ever imports them, the top-level `throw` fires.
- Fix: Move to scripts/ or delete.

---

Checked and found sound: cross-company authorization on activate, estimate, card, cancel and preview (companyId always comes from the caller's profile; vehicle and licence ownership is checked on both halves); webhooks (none exist, so there is no signature surface); the cron's v2 skip and the `selectRecoveryAction` v2 guard; the `addonServer` pending-intent and replay logic, including concurrent same-vehicle requests; the `classifySquareThrow` decline rule; integer-pence maths and VAT rounding in money.ts and prorata.ts; UTC-midnight date arithmetic (no DST drift across 28-day cycles); idempotency key lengths and namespaces; cron overlap for successful charges (same key and body replay, `on conflict do nothing`, idempotent CAS); migration script ordering (period before flag).

---

# Review 04: v2 period billing end to end

Scope: lib/billing/{rateCard,pence,period,invoiceLine,invoice,close,activation,cancellation,licenceDelete,periodPayment,periodPaymentServer,periodServer,run,schedule}.ts, app/api/licences/{activate,estimate}, app/api/billing/{run,cancel,card,preview}, scripts/migrate-company-to-period-billing.mjs, docs/sql/billing_06*, billing_07, commits f98a3a5..b04e095.
Unit tests for close, invoice, cancellation, activation, rateCard, periodPayment: 140 pass (npx vitest run). Pricing arithmetic below was reproduced with a standalone node re-implementation of fleetPeriodPence, prorateLine and assembleInvoice.

Counts: CRITICAL 2, HIGH 5, MEDIUM 7, LOW 8.

---

### [CRITICAL] BILL2-1: A cancelled company keeps being billed every 28 days
- File: lib/billing/periodServer.ts:680-686 (successor open in collectPeriod), 1322-1329 (cancelCompany close_early), 305-317 (closeDuePeriods ignores company status)
- Verdict: CONFIRMED
- Problem: cancelCompany's close_early path calls collectPeriod, and collectPeriod opens a successor period whenever any company licence has a null deactivated_at. Cancellation never deactivates licences, so the successor always opens (collectPeriod runs before markCancelled, and nothing checks status anyway). closeDuePeriods filters only on billing_model, never on company_billing.status, so 28 days later it computes and charges that successor, which in turn opens another. The same happens when a mid-dunning company cancels via cancel_only: the failed period's later retry succeeds and opens a successor. The spec's guarantee ("ensure_open_billing_period opens no successor") exists nowhere: there is no such SQL function and no status check in ensureOpenPeriod.
  Secondary: when a cancelled company's final charge keeps declining, dunning exhaustion writes status = 'past_due' over 'canceled' (periodServer.ts:645-651), relabelling a cancelled company as a suspended one.
- Failure scenario: 2-vehicle company on its second period cancels on day 11. Balance settles (floor), period invoiced, successor opened from tomorrow. Company shows canceled. On day 28 of the successor the cron charges GBP 129.00 + VAT for 2 vehicles with prepaid 0, and repeats every 28 days until the card dies. A 20-vehicle company is charged roughly GBP 1,238 gross per period after leaving.
- Fix: in collectPeriod, do not open a successor when period.closed_reason is 'cancellation' or company_billing.status is 'canceled' (read status fresh inside the function). In closeDuePeriods, never compute an 'open' period for a canceled company (still collect closed/failed debt). In cancelCompany, deactivate every active licence or record a cancellation timestamp the rollover reads. Never overwrite 'canceled' in the exhaustion branch (add `.neq('status','canceled')`). Optional SQL backstop: trigger refusing an open billing_periods row for a canceled company.

### [CRITICAL] BILL2-2: Double balance charge when two collectors act on a closed or failed period
- File: lib/billing/periodServer.ts:339-367, 599-676; lib/billing/periodPaymentServer.ts:219-308
- Verdict: CONFIRMED (code path); trigger requires overlapping runs, PLAUSIBLE in practice
- Problem: only the compute step is claimed (CAS from 'open' to 'closing'). Collecting a period already in 'closed' or 'failed' has no claim, and chargePeriod never asks whether a balance for this period already succeeded. claimAttempt reuses a PENDING row, but once the first collector has settled, nextAttemptNumber returns max(attempt)+1 counting succeeded rows too, minting a NEW idempotency key (`_b2`), and Square takes a second payment. collectPeriod's final update to 'invoiced' is unconditional, so nothing notices.
- Failure scenario: (a) The 09-10 handoff tells the operator to curl /api/billing/run by hand; if that overlaps the scheduled run (maxDuration 300 s, companies processed serially) both load the due list while a dunning period is 'failed' or an indeterminate period is 'closed'. Run A charges and settles attempt 1; run B reaches the same period with its stale snapshot, gets attempt 2, charges again. (b) Cancel route vs cron: cron fetches the due list after cancelCompany's computePeriodInvoice marked the period 'closed' and before collectPeriod settled, then collects after settle: attempt 2, second charge. (c) Duplicate Vercel cron delivery gives the same overlap. For a failed period the second collector instead makes an extra same-day decline and advances attempt_count, reaching past_due early.
- Fix: claim collection with a CAS, e.g. `update billing_periods set status='collecting', closing_since=now() where id=? and status in ('closed','failed') and attempt_count=?`, standing down on zero rows (new enum value: SQL migration). Independently, in chargePeriod return the stored success when a succeeded balance row with gross > 0 already exists. Database backstop: partial unique index on period_charges (billing_period_id, kind) where status='succeeded' and gross_pence > 0 (SQL migration).

### [HIGH] BILL2-3: Adding throwaway vehicles on the last day of a period lowers the invoice
- File: lib/billing/invoice.ts:195-236, lib/billing/close.ts:216-275
- Verdict: CONFIRMED (arithmetic reproduced)
- Problem: the discount band is chosen by the number of invoice LINES in the period, while each line is prorated by days. A vehicle licensed on the last day costs 1/28 of GBP 64.50 (230 pence) but counts as a whole vehicle for the band, and the discount ratio is applied to the whole prorated subtotal. The rateCard monotonicity proof only covers full-period fleets; the invoice is not monotonic in vehicles over time. Rules 4 and 5 do not help because the phantom is billed one day only. estimateVehicleAddition floors its quote at 0, so the UI hides the drop.
- Failure scenario (net pence, min_bill_days = 1):
  - 9 full vehicles: 58050. 9 full + 1 added on the last day: 52452 (saves GBP 55.98 net, GBP 67.18 gross).
  - 14 full: 81270. 14 + 1 last-day: 76951. 14 + 6 last-day: 73344.
  - 19 full: 103200. 19 + 1 last-day: 98224. 19 + 11 last-day: 97562.
  - 29 full: 149640. 29 + 1 last-day: 146078.
  - 5 full + 5 last-day: 30060 vs 32250.
  Activate and deactivate on the same last day; the licence never reaches the next period. With self-service signup any vehicle row works, so every customer with 5+ vehicles can do this every period.
- Fix: choose the band from something a single day cannot buy, e.g. round-half-up of total billable vehicle-days / PERIOD_DAYS (full-period-equivalent vehicles) or the high-water mark; or apply a larger min_bill_days for band counting only. Add a property test that adding any vehicle with any coverage never lowers netPence. Update the spec's "band chosen by the period's line count".

### [HIGH] BILL2-4: A pending minimum charge is never reconciled, blocks the customer forever and can double-collect GBP 129
- File: lib/billing/activation.ts:118-120, lib/billing/cancellation.ts:521-523, lib/billing/periodServer.ts:884-889, 599-625; lib/billing/periodPaymentServer.ts:103-129
- Verdict: CONFIRMED
- Problem: if the minimum's Square call is indeterminate (timeout, 5xx, non-COMPLETED status, failed settle write), a 'pending' minimum row stays on an open period with prepaid_pence 0. From then on resolveActivation answers blocked/payment_settling BEFORE reaching openPeriodAndChargeMinimum, which is the only code that would replay the same key and resolve it. Cancellation is blocked the same way. The cron never looks at minimum rows. At day 28 the close job bills with prepaid_pence 0, so if the pending charge did succeed the customer pays the minimum twice. Worse variant: getSquare()/getSquareLocationId() run AFTER claimAttempt inserted the pending row (periodPaymentServer.ts:103 then 128-129), so a missing Square env var creates a pending row for a request that never left the process, with the same permanent wedge. The comment says env resolution was moved before the try to avoid exactly this classification, but the pending row already exists by then.
- Failure scenario: Square times out on a new signup's first activation. The customer sees a generic 500; every retry says "still settling"; they cannot add vehicles or cancel. If the card was charged, GBP 154.80 sits unrecorded in prepaid_pence, and any vehicle that is in the period is billed at the floor again at close.
- Fix: in selectActivationAction route a pending minimum to open_period_and_charge (replay) instead of blocked; openPeriodAndChargeMinimum replays via claimAttempt. Resolve Square config before claimAttempt. In closeDuePeriods replay or refuse a period with a pending minimum before collecting. Add a daily reconciliation pass for stale pending period_charges.

### [HIGH] BILL2-5: A v2 company that reaches past_due can never recover, and its debt is never collected
- File: lib/billing/run.ts:59, app/api/billing/card/route.ts:292-314, lib/billing/close.ts:451-454, app/settings/billing/V2Billing.tsx:325-326
- Verdict: CONFIRMED
- Problem: after the 4th failed balance attempt collectPeriod sets past_due and the period is skipped forever as dunning_exhausted. The card route's selectRecoveryAction returns none for every v2 company (f98a3a5), so a new card only updates card fields. Nothing sets status back to active, nothing retries the failed period, and selectActivationAction blocks past_due. The spec's "On payment, the floor is taken again and a NEW period opens" is not implemented. V2Billing tells the customer "Replace your card below to bring your account back up to date", which does nothing. With service-level suspension unbuilt, the company keeps using the product unpaid.
- Failure scenario: card expires, 4 declines over 7 days, past_due. Customer replaces the card as told: no charge, still past_due, cannot add vehicles, debt never collected; only SQL fixes it.
- Fix: in the card route, for v2 with a failed period, collect it immediately with the new card (attempt_count + 1, through the claim from BILL2-2) and on success set status active; the next activation then opens a fresh period with the minimum per spec. Also let the cron retry exhausted periods after a card change.

### [HIGH] BILL2-6: No dunning gate on v2 activation; a failing company opens a new period and the exposure cap does not exist
- File: lib/billing/activation.ts:82-137, lib/billing/periodServer.ts:163-209, 627-662
- Verdict: CONFIRMED
- Problem: during the retry ladder the failed period is 'failed', company status stays 'active', and no successor is open. selectActivationAction has no equivalent of v1's `dunning` block, sees no open period and returns open_period_and_charge; ensureOpenPeriod inserts a new open period (the one-open index ignores 'failed'). The spec's "refuses to open a new period while one is failed" relies on an ensure_open_billing_period function that does not exist.
- Failure scenario: period closes 1 Oct, balance declines. On 3 Oct the customer adds a vehicle; the smaller GBP 154.80 minimum succeeds and a new period 3 Oct to 31 Oct opens. Every existing vehicle is unbilled for 1 to 2 Oct. If the failed balance later exhausts, the company goes past_due while the new period stays open and still closes and charges, so debt compounds past one period. If the retry succeeds instead, collectPeriod's ensureOpenPeriod returns the new period and the gap stays unbilled.
- Fix: in resolveActivation, block with a `dunning` reason when the company has a 'failed' or uncollected 'closed' period (add the message). Enforce in ensureOpenPeriod too, ideally as a SQL guard (migration).

### [HIGH] BILL2-7: An active fleet can be left with no open period indefinitely
- File: lib/billing/periodServer.ts:678-691, 360-379
- Verdict: CONFIRMED (code path); trigger PLAUSIBLE
- Problem: the successor opens only inside collectPeriod after settlement, and a failure there is swallowed into outcome.error ("The next activation self-heals it"). A company with a stable fleet never activates again, and nothing else opens a period (invoiced periods leave the due query). Same result while a period sits in 'closed' on repeated PAYMENT_INDETERMINATE. When the customer eventually adds a vehicle, a fresh GBP 129 minimum is charged, the anchor restarts, and an unused cooling-off window reopens.
- Failure scenario: transient PostgREST error in fetchCompanyVehicleIds right after a successful balance charge; a 30-vehicle company is never billed again until someone notices.
- Fix: make successor creation re-runnable: closeDuePeriods also scans v2 non-canceled companies whose latest period is invoiced with closed_reason 'scheduled', no open period and active licences, and opens the successor at that period_end.

---

### [MEDIUM] BILL2-8: A throw inside openPeriodAndChargeMinimum leaves an open period with no minimum, and later activations join it free
- File: lib/billing/periodServer.ts:866-925
- Verdict: CONFIRMED (code path)
- Problem: ensureOpenPeriod inserts the period first; it is deleted only on a clean `failed` result. Any throw between that insert and claimAttempt's insert (the `existing` select, chargePeriod's company_billing select, nextAttemptNumber, a non-23505 period_charges insert error) leaves an open period, prepaid_pence 0, no period_charges row. resolveActivation then returns join_open_period (ok:true, charged:false, reason period_billing) for every activation. Revenue is still invoiced at close (floor applies), so the loss is the up-front card proof and collection, but it reproduces the reported symptom exactly (see the last section).
- Fix: on any throw after ensureOpenPeriod created a NEW row, delete it if it has no period_charges rows; or claim the charge row before exposing the period; or treat an activation-opened period with prepaid 0 and no minimum row as still needing the minimum.

### [MEDIUM] BILL2-9: The floor is not prorated for cancellation, so cancelling early in any later period costs the full GBP 154.80
- File: lib/billing/invoice.ts:238-254, lib/billing/periodServer.ts:1280-1327
- Verdict: CONFIRMED
- Problem: the spec's cancellation examples assume the GBP 129 was collected up front, true only in an activation-opened period. A rollover period has prepaid_pence 0 by design, and assembleInvoice lifts a short invoice to the full min_invoice_pence. The spec's reason for day-exact cancellation (avoiding chargebacks) is defeated.
- Failure scenario: 2-vehicle customer in month 3 cancels the day after rollover: lines total 461 pence, minimum adjustment lifts to 12900, charged GBP 154.80 for two days.
- Fix: for closed_reason 'cancellation', prorate the floor by billed days / PERIOD_DAYS or waive it when prepaid is 0. Product decision; record it in the spec.

### [MEDIUM] BILL2-10: Cooling-off refund ignores usage, is per company only, and is not limited to the first activation
- File: lib/billing/cancellation.ts:540-554, lib/billing/periodServer.ts:1245-1276
- Verdict: CONFIRMED
- Problem: inside 48 h the minimum is refunded and the period closed with net 0 regardless of fleet size or usage. The once-only guard is company_billing.cooling_off_refunded_at; self-service signup makes a new company free and the card is not fingerprinted. The window also opens for any period with prepaid_pence > 0, i.e. every activation-opened period (return from dormancy, BILL2-6/7 re-opens), while the spec says FIRST activation only.
- Failure scenario: operator signs up, adds 60 vehicles, runs 47 hours of dispatch, cancels, gets GBP 154.80 back and pays nothing for about GBP 276 net of usage; repeats with a new company name and the same card.
- Fix: invoice usage above the floor on cooling-off (refund only the unused part), or restrict it to fleets under the floor. Guard by card fingerprint / Square customer as well. Require the period to be the company's first billing_periods row.

### [MEDIUM] BILL2-11: The activate route accepts writes against superseded rows and active-to-active toggles
- File: app/api/licences/activate/route.ts:177-203, 324-360, 406-456
- Verdict: CONFIRMED
- Problem: nothing refuses a licenceId whose superseded_by is set, and setActive true on an already active row goes through already_billable into writeLicenceAsNewActivation, which inserts a new active row and supersedes the old one WITHOUT deactivating it. writeInFlight is per tab.
  - Stale tab: tab A deactivates then reactivates X (X superseded by X'). Tab B still shows X active and clicks Deactivate: the update on X is a no-op, the route answers "Licence deactivated", X' stays billable.
  - Crafted or replayed setActive true on active X: X stays active but hidden by the page's superseded filter; deactivating visible X' leaves hidden X billing indefinitely.
  - Two tabs activating the same inactive X: X' and X'' both active.
- Fix: 409 on setActive/delete when superseded_by is not null; no-op for active-to-active; make the supersede update conditional on `superseded_by is null` and roll back the insert on zero rows.

### [MEDIUM] BILL2-12: Deleting a vehicle bypasses the v2 evidence rule
- File: app/vehicles/page.tsx:540
- Verdict: PLAUSIBLE (depends on the vehicle_licences.vehicle_id FK action, which is not in docs/sql)
- Problem: the licences route refuses deleting an ever-active licence under v2, but the vehicles page deletes the vehicle straight from the browser. With ON DELETE CASCADE every licence (the invoice evidence) disappears mid-period; with RESTRICT, deleting any ever-licensed vehicle fails for every company.
- Failure scenario: v2 company deletes 10 vehicles on day 27; the period closes with 10 fewer lines.
- Fix: check `select confdeltype from pg_constraint where conrelid='public.vehicle_licences'::regclass and contype='f'`. Route vehicle deletion through a server route that refuses when a licence was ever active under v2, or soft-delete vehicles.

### [MEDIUM] BILL2-13: A migrated company cannot cancel before its seam date, and vehicles added before the seam are free
- File: lib/billing/cancellation.ts:565-571, lib/billing/periodServer.ts:1280-1290, scripts/migrate-company-to-period-billing.mjs:229-237
- Verdict: CONFIRMED
- Problem: the script creates the first v2 period starting at next_charge_on, in the future. close_early sets period_end = tomorrow, which is before period_start, so the update violates billing_periods_end_after_start and the route answers 500 "not cancelled, contact support". Also a vehicle activated between migration and the seam joins free (no v1 pro-rata; coverage clamps to the seam).
- Fix: when todayISO < periodStartISO, delete (or zero-close) the untouched future period and cancel_only. Accept or charge the pre-seam window explicitly.

### [MEDIUM] BILL2-14: Four different no-charge exits all return ok:true, charged:false, hiding billing faults
- File: app/api/licences/activate/route.ts:406-413, 444-456, 468-489, 612-619
- Verdict: CONFIRMED
- Problem: not_active, already_billable, period_billing and every v1 free reason look identical to the UI, which is why the 09-10 report could not be diagnosed; combined with BILL2-8 a broken open period reads as success.
- Fix: show `reason` in licenceAddedMessage and log a structured server line per v2 activation (companyId, vehicleId, action kind, periodId, prepaid_pence).

---

### [LOW] BILL2-15: Cooling-off refund is recorded as refunded without reading Square's refund status
- File: lib/billing/periodPaymentServer.ts:372-401
- Verdict: CONFIRMED
- Problem: response.refund.status (PENDING, COMPLETED, REJECTED, FAILED) is ignored; the row goes 'refunded' and cooling_off_refunded_at is stamped even if Square later rejects it.
- Fix: classify the returned status; record pending and reconcile, throw on REJECTED/FAILED.

### [LOW] BILL2-16: Cooling-off with a succeeded minimum lacking square_payment_id uses up the refund and refunds nothing
- File: lib/billing/periodPaymentServer.ts:365-368, lib/billing/periodServer.ts:1249-1275
- Verdict: CONFIRMED
- Problem: settle stores `payment?.id ?? null`. If null, refundPeriodMinimum returns nothing_to_refund, yet the company is cancelled, refunded_at set, and ok:true with refundedPence 0 returned.
- Fix: when prepaid_pence > 0 and nothing refundable is found, throw for manual reconciliation.

### [LOW] BILL2-17: Re-opening a period on the same London day collides on unique (company_id, period_start)
- File: lib/billing/periodServer.ts:178-206, docs/sql/billing_06_period_billing.sql:229
- Verdict: CONFIRMED
- Problem: after a cooling-off or close_early period that started today, a new activation today inserts the same period_start. ensureOpenPeriod treats every 23505 as the one-open race, `.single()` finds no open period and throws: generic 500 for the rest of the day.
- Fix: distinguish the constraint name; start at tomorrow or narrow the unique constraint (SQL).

### [LOW] BILL2-18: A declined minimum deletes its own audit trail
- File: lib/billing/periodServer.ts:915-925, docs/sql/billing_06_period_billing.sql:375-376
- Verdict: CONFIRMED
- Problem: deleting the period cascades period_charges, so failed first-activation attempts (fraud blocks, card testing) leave no record.
- Fix: keep the failed row (mark the period instead of deleting, or log elsewhere).

### [LOW] BILL2-19: VAT rate effectively hardcoded in several places
- File: lib/billing/periodServer.ts:50, 283, 447, 610, 1078-1080; app/api/licences/activate/route.ts:546-549
- Verdict: CONFIRMED
- Problem: settings.vat_rate is never selected (no such company_billing column), so every `?? 20` is 20; the activate route and quote recompute VAT with their own formula instead of the charge row. Correct today, silently wrong on change.
- Fix: one VAT helper and source; return grossPence from the charge row.

### [LOW] BILL2-20: Documentation and verify-probe contradictions
- File: docs/sql/billing_06_period_billing.sql:518-523; spec and billing_06 references to ensure_open_billing_period
- Verdict: CONFIRMED
- Problem: billing_06 inline VERIFY step 5 says a 'vehicle' line with null vehicle_id "must FAIL with 23514", but the constraint at line 316 allows it and billing_06_verify.sql asserts the opposite. The spec relies on an ensure_open_billing_period function (suspension, failed and cancellation guards) that was never created; those missing guards are BILL2-1 and BILL2-6.
- Fix: correct step 5; implement the function or rewrite the spec against ensureOpenPeriod.

### [LOW] BILL2-21: Migration script hardening
- File: scripts/migrate-company-to-period-billing.mjs:183-272
- Verdict: CONFIRMED
- Problem: the dry run is safe (no write before the apply check; a missing or mistyped flag stays a dry run). But --apply is three non-transactional writes: failure after step 1 leaves a v1 company with an open future period (re-run refuses on 23505, manual cleanup), failure in step 2 leaves a partial activated_at reset. No 1000-row cap check. No check for pending v1 add-on intents or pending platform_charges, which are orphaned once the v1 cron skips the company.
- Fix: one SQL function/transaction; row-cap checks; refuse while pending v1 charge rows exist.

### [LOW] BILL2-22: Estimate quotes a charge that activation would refuse
- File: lib/billing/periodServer.ts:1046-1090
- Verdict: CONFIRMED
- Problem: quoteVehicleAddition ignores status, card presence, pending minimum and failed periods, so a past_due or card-less company is quoted "GBP 154.80 today" and then refused; a no-row company is quoted as v1 while the page resolves it as v2.
- Fix: derive the quote from resolveActivation.

---

## Checked and found sound
- rateCard full-period prices at 9/10/14/15/19/20/29/30 vehicles: 58050, 58050, 81270, 82238, 103200, 103200, 149640, 150930 (monotonic). Floor applied after discount. Zero vehicles: no invoice, no charge.
- Period boundaries: exclusive end, London dates via londonDateISO at the edge, addDays/daysBetween on UTC midnights, so BST transitions do not shift days. A licence activated 00:30 BST on the end date lands in the next period. The script's `${seam}T00:00:00Z` maps to the seam date in both GMT and BST.
- Concurrent compute of an 'open' period: CAS claim works; stale 'closing' reclaim regenerates lines.
- Minimum not charged on rollover; a two-tab double minimum is prevented by the succeeded/pending check.
- Refund idempotency key replays safely after a failed record write.
- Authorization: activate, estimate, cancel, preview require company admin (admin, or super_admin with a company_id) and scope vehicle/licence to the caller's company; period tables are RLS read-only for company admins; /api/billing/run is allowlisted in proxy and requires CRON_SECRET.
- Signup default: no company_billing row on a v2 default is refused (no_payment_method); card save inserts billing_model v2_period and charges nothing; the v1 cron and selectRecoveryAction skip v2 rows.

---

## Unresolved activation report

Facts: the 2026-09-10 report was "no period_charges row, no charge". The 2026-09-11 plan records that a later dry run on 2026-09-14 did charge GBP 154.80, so the charge path works; the cause of the first failure was never written down.

What the code rules out: every non-throwing path through openPeriodAndChargeMinimum writes a period_charges row (claimAttempt inserts pending before Square; zero amounts insert a zero row; the succeeded-race branch implies a row exists), except NO_PAYMENT_METHOD, which returns 402 (not ok) and deletes the period. So the request never reached the charge. Candidates, in the order the route evaluates them:

1. not_active (route.ts:406). "Active for billing" unchecked. The form defaults to checked; unlikely.
2. already_billable (route.ts:444-456). Evaluated before the v2 blocked/open branches. A test company used under v1 almost certainly already had an active licence on the vehicle, and any further licence on it is free by design. High likelihood if "adding a vehicle" meant adding a licence to an existing test vehicle.
3. join_open_period, reason period_billing (route.ts:468-489). A period already existed. Two ways, neither of which the handoff's "correct behaviour" reading covers:
   - The company was switched with the migration script, which creates a period with prepaid 0 and never takes the minimum.
   - BILL2-8: an earlier attempt threw after ensureOpenPeriod inserted the period but before a charge row existed (for example a PostgREST error on period_charges or company_billing inside chargePeriod). That attempt shows a generic 500 and writes no licence; the retry joins the orphaned period with ok:true and no charge row. This is the one candidate that is a code defect, and it matches every symptom.
4. legacy fall-through (route.ts:559-619). companyId is the CALLER's profile company (lib/billing/server.ts:36-52), not the vehicle's. If billing_model was flipped on a different company_billing row, resolveActivation returns legacy and v1 answers a free reason (already_covered, no_subscription, cycle_due) with ok:true. resolveActivation also returns legacy silently on 42703, so a missing billing_06 column in its select gives the same result.

Most likely (2) or (3). To tell after the fact: `select id, status, prepaid_pence, created_at from billing_periods where company_id = '<test company>' order by created_at` joined to period_charges (an open period with prepaid 0 and no charge rows created before the test confirms 3; a matching "Licence activation failed" 500 in Vercel logs at its created_at confirms BILL2-8), and count active licences per test vehicle (confirms 2).

Regardless of which it was: fix BILL2-8 (orphaned period), BILL2-14 (surface `reason`), and log the resolved action kind for every v2 activation.

---

# Review 05: accounts, integrations, external portals (2026-09-14)

Scope: app/api/accounts/**, lib/accounts/**, app/api/integrations/**, app/api/subcontractor(s)/**, app/api/customers/**, app/api/settings/portal-invites, portal pages, supabase/migrations/20260813_portal_invites.sql, 20260814_xero_oauth_credentials.sql, lib/validation, lib/api.
Read-only review. Nothing run against Supabase, Xero or Microsoft Graph. The accounts table schema (payment_allocations, credit_note_allocations, invoice triggers, next_invoice_number) is NOT in the repo, so findings that depend on constraints or triggers are marked PLAUSIBLE.

Status of 2026-08-25 audit items in this area:
- H1: fixed for integration, settings and email routes (option B). Transactional routes remain member-level by design. But see ACC-2: the gate reads the legacy `memberships` table.
- M1 (arbitrary email recipient): STILL OPEN on invoice and quotation email (now admin-only). ACC-5.
- M3 (subcontractors GET ignores role): STILL OPEN. ACC-10.
- M5 (subcontractor invite pre-auth IDOR): STILL OPEN. ACC-11.
- M6 (no rate limiting): STILL OPEN for the email send and invite routes in this area. ACC-18.
- L2 (customers .or() sanitization): STILL OPEN. ACC-19.

---

### [CRITICAL] ACC-1: Payment allocation accepts any invoiceId and any amount, with no tenant or balance check
- File: app/api/accounts/payments/route.ts:28-75
- Verdict: PLAUSIBLE (the code path is confirmed; the money impact depends on the DB triggers/FKs on payment_allocations, which are not in the repo)
- Problem: POST calls `requireTenantAccess(tenantId)`, then inserts through the service-role client (RLS bypassed):
  - `customer_payments` with `customer_id: body.customerId`, which is never checked against the tenant.
  - `payment_allocations` with `invoice_id: body.invoiceId` and `amount: Number(body.allocateAmount ?? amount)`.
  Nothing checks that the invoice belongs to `tenantId` or to `customerId`, that `allocateAmount <= amount`, or that the allocation is no more than the invoice `balance_due`. There is no currency check against the invoice either. Any member role (driver included) can call it.
- Failure scenario:
  1. A user of tenant A (any role) POSTs `{tenantId: A, customerId: <anything>, amount: 1, invoiceId: <tenant B invoice uuid>, allocateAmount: 99999}`.
  2. The row is written with tenant_id = A but points at B's invoice.
  3. If amount_paid/balance_due is maintained by a trigger or view over payment_allocations keyed on invoice_id (the invoices GET returns amount_paid and balance_due), B's invoice shows as paid. B then stops chasing a real debt: money loss plus cross-tenant integrity corruption.
  4. Even within one tenant, a GBP 1 payment can be allocated as GBP 10,000 against an invoice, marking it paid.
  Invoice UUIDs are not secret once shared (emails, PDFs, share links), so guessing is not the barrier.
- Fix:
  - Load the invoice with `.eq("id", invoiceId).eq("tenant_id", tenantId).eq("customer_id", customerId)` and 404 otherwise. Also verify the customer belongs to the tenant.
  - Enforce 0 < allocateAmount <= amount and allocateAmount <= balance_due, and require matching currency.
  - Do the insert and the check atomically in an RPC with a row lock on the invoice.
  - SQL migration recommended: composite FK (tenant_id, invoice_id) -> invoices(tenant_id, id) on payment_allocations and credit_note_allocations, plus a CHECK or trigger rejecting over-allocation.

### [HIGH] ACC-2: Accounts authorization is built on the legacy `memberships` table, which the tenancy model says is unused
- File: lib/accounts/server.ts:47-81 (also app/api/subcontractors/route.ts:77, app/api/subcontractor/users/invite/route.ts:532-562, app/api/settings/portal-invites/route.ts:52-71, lib/api/server.ts:71)
- Verdict: PLAUSIBLE (depends on which users have memberships rows in the live DB)
- Problem:
  - docs/sql/rls_06_lock_secrets.sql:19-30 documents `memberships` as "a legacy user<->tenant table ... unused by the app ... slated for removal". The canonical model is profiles.role/profiles.tenant_id plus get_tenant_context(), where company `admin` reaches every tenant under the company with no per-tenant row.
  - The only code that ever inserts into memberships is app/api/settings/users/invite/route.ts:321. Company/tenant creation, super-admin and signup paths never do.
  - requireTenantAccess returns FORBIDDEN without a row, and takes the ROLE from memberships.role, not profiles.role.
- Failure scenario:
  1. Self-service signup opens. The founding admin of a new company has a profile but no memberships row, so every /api/accounts route (invoices, payments, Xero, email) answers 403 "You do not have access to this tenant". Accounts is unusable.
  2. A company admin switches to a sibling tenant (allowed by get_tenant_context) and gets 403 everywhere in accounts.
  3. Drift the other way: a user demoted to staff in profiles keeps memberships.role = 'admin' if the two are not updated together, and keeps Xero connect/disconnect and document-email rights.
- Fix:
  - Replace the lookup with the canonical check: call can_access_tenant/can_manage_tenant through the user's JWT (RPC on the user client), or read profiles role + company and check that tenants.company_id matches.
  - Map "admin" to can_manage_tenant.
  - Apply the same change to the subcontractors, subcontractor invite and portal-invites routes. No SQL needed if the existing SECURITY DEFINER helpers are reused.

### [HIGH] ACC-3: Invoice PATCH applies status before the lock check, so any member can unlock and rewrite sent/paid invoices, or mark them paid/void
- File: app/api/accounts/invoices/[id]/route.ts:107-200 (allowed set 122-134, update 152-156, lock check 178-200)
- Verdict: CONFIRMED
- Problem:
  - The field patch, including status, accounting_invoice_id and accounting_sync_status, is written first. Only then is currentInvoice.status re-read and checked against lockedStatuses before the lines are edited.
  - There is no status transition validation at all, and no role gate (member-level).
- Failure scenario:
  - A driver-role member sends `PATCH {tenantId, status:"draft", lines:[{id, quantity:1, unit_price:0, vat_rate:0}]}` against a sent invoice. The status write lands first, the lock check then sees "draft", and the line values are rewritten and totals recalculated. The customer already holds a PDF with different numbers, and the Xero copy (if synced) disagrees.
  - The same member can set status "paid" or "void" with no payment, or write accounting_invoice_id to a fake value so the invoice looks synced and the sync route short-circuits with alreadySynced.
- Fix:
  - Read the current row first and reject any change (field or line) when the status is locked.
  - Implement an explicit transition table (draft -> approved -> sent; paid only via allocations; void admin-only).
  - Remove accounting_invoice_id/accounting_sync_status/accounting_sync_error from the client-writable set.
  - Better: a DB trigger that blocks updates to invoice_lines and value columns when the parent invoice is sent/paid/void/credited (SQL migration).

### [MEDIUM] ACC-4: Approved (and Xero-synced) invoices remain editable, so TMS and Xero diverge
- File: app/api/accounts/invoices/[id]/route.ts:178-200; app/api/accounts/accounting/xero/invoices/[id]/sync/route.ts:376-425
- Verdict: CONFIRMED
- Problem:
  - lockedStatuses is sent/paid/void/credited. "approved" is not locked, yet approved invoices are exactly what the sync route pushes to Xero as AUTHORISED.
  - After sync, a member can edit line prices. The sync route never re-pushes once accounting_invoice_id is set.
- Failure scenario: An invoice is approved and synced for GBP 1,200. Staff then change a line to GBP 900 and email it; the invoice status becomes "sent" with the GBP 900 PDF. Xero still holds GBP 1,200 AUTHORISED, so the ledger and VAT return are wrong.
- Fix: Lock values once accounting_invoice_id is set or the status is approved, and require void plus credit note for changes. Or add an update-to-Xero path.

### [MEDIUM] ACC-5: M1 still open: invoice and quotation email send documents to any caller-supplied address
- File: app/api/accounts/invoices/[id]/email/route.ts:131-134, 408-433, 934-935; app/api/accounts/quotations/[id]/email/route.ts (recipient built at about 358-380)
- Verdict: CONFIRMED
- Problem:
  - recipient = body.to || customer emails, checked only by a loose regex. The invoice route then persists that address into invoices.invoice_email, so later sends default to it.
  - With includePod: true, every POD PDF for the invoice's jobs is attached.
  - Mail goes from the platform's shared Microsoft 365 sender (MS_GRAPH_SENDER), so it is also a relay on the platform domain. The route is admin-gated now, which lowers the severity.
- Failure scenario:
  - A malicious or compromised tenant admin (self-service signup makes this anyone) emails arbitrary text-bearing PDFs from the platform sender to any address. Customer name, notes and line descriptions are attacker-controlled. This is phishing from the platform domain and burns sender reputation for every tenant.
  - Separately, a typo permanently redirects future invoice emails.
- Fix:
  - Restrict `to` to the customer's stored addresses and contacts (customer_contacts), or require a confirmation step for new addresses.
  - Do not persist body.to into invoice_email.
  - Add per-tenant send rate limits (see ACC-18).

### [MEDIUM] ACC-6: Xero sync posts every line with one tax code and ignores per-line VAT rates; no total reconciliation
- File: app/api/accounts/accounting/xero/invoices/[id]/sync/route.ts:636-708 (also 516-543)
- Verdict: CONFIRMED
- Problem:
  - Each line is sent with TaxType: integration.default_tax_code and LineAmountTypes "Exclusive". invoice_lines.vat_rate is selected but never used, so Xero recomputes VAT from the default tax type.
  - Invoices with zero-rated (0%), exempt or mixed lines post the wrong VAT. The TMS invoice.total is never compared to the Xero response Total.
  - Lines with unit_price 0 or negative (discounts, free-of-charge lines) are rejected outright. So a legitimately approved invoice cannot sync, while the PATCH route allows unit_price >= 0.
  - Credit notes and payments are never synced, so the Xero balance never reflects credits.
- Failure scenario:
  - An EU export customer has vat_rate = 0. The TMS invoice is GBP 1,000 with 0 VAT, but Xero books GBP 1,200 with GBP 200 output VAT (20% default), and the VAT return overstates liability.
  - Alternatively, a GBP 0 line blocks the sync entirely.
- Fix:
  - Map each line's vat_rate to a Xero TaxType (config table: rate -> TaxType), and reject the sync if a rate has no mapping.
  - After POST, compare Invoices[0].Total to invoice.total and flag a mismatch.
  - Allow 0-value lines.
  - Plan credit note (ACCRECCREDIT) and payment sync.

### [MEDIUM] ACC-7: Xero sync has no atomic claim; concurrent requests can double-post
- File: app/api/accounts/accounting/xero/invoices/[id]/sync/route.ts:376-385, 562-616, 710-723
- Verdict: PLAUSIBLE (depends on Xero rejecting a duplicate InvoiceNumber)
- Problem:
  - The idempotency guard is "accounting_invoice_id is null" plus a Xero search by InvoiceNumber, followed by a POST. accounting_sync_status = "syncing" is written but never checked or claimed conditionally.
  - Contact find-or-create is also check-then-create, which can create duplicate Xero contacts.
- Failure scenario: A double-click, or two admins, send two requests. Both read accounting_invoice_id = null, both search Xero (not found yet), and both POST AUTHORISED invoices. If Xero accepts both, the receivable is booked twice; at minimum, two duplicate contacts are created.
- Fix:
  - Claim first with a conditional update (set accounting_sync_status = 'syncing' where id and tenant match, accounting_invoice_id is null and the status is not already 'syncing', returning id), and bail if 0 rows.
  - Add a stale-claim timeout.
  - Send the Xero Idempotency-Key header (the invoice id) on POST /Invoices and /Contacts.

### [MEDIUM] ACC-8: Credit note approval and creation race; credits allowed against draft/void invoices; colliding CN numbers
- File: app/api/accounts/credit-notes/route.ts:420-500 (POST), about 660-760 (approve)
- Verdict: PLAUSIBLE (depends on a unique constraint on credit_note_allocations.credit_note_id, which is not in repo)
- Problem:
  - Approve does check existingAllocation, then inserts the allocation with no lock. Two concurrent approves of the same note both pass, and the invoice is credited twice.
  - Creation checks the remaining quantity and gross against other notes, then inserts. Two concurrent creates for the full invoice both pass.
  - The invoice status is never checked, so draft, void or already-credited invoices can be credited.
  - The default credit note number is `CN-<yyyymmddhhmmss>` (second resolution, not per tenant). Two notes in the same second collide, or duplicate if there is no unique index.
  - body.creditNoteNumber is accepted verbatim.
- Failure scenario: A GBP 5,000 invoice gets two approved GBP 5,000 credit notes via a double-submit. credit_total is GBP 10,000 and balance_due goes negative, so the customer is refunded or statemented a phantom credit.
- Fix:
  - Do create and approve in a single SQL function holding `select ... for update` on the invoice row, with a unique index on credit_note_allocations(credit_note_id) and a CHECK that the sum of allocations is at most the invoice total.
  - Block credits on draft/void invoices.
  - Allocate CN numbers from a per-tenant sequence RPC like next_invoice_number.
  - SQL migration needed.

### [MEDIUM] ACC-9: Invoice creation is non-atomic and races on duplicate job invoicing and invoice numbers
- File: app/api/accounts/invoices/route.ts:120-236
- Verdict: PLAUSIBLE (depends on unique indexes on invoice_jobs(job_id) where active and invoices(tenant_id, invoice_number))
- Problem:
  - "Already invoiced" is a read (invoice_jobs where active = true) followed by separate inserts of the invoice, lines and invoice_jobs, with no transaction.
  - body.invoiceNumber bypasses the next_invoice_number allocator with no uniqueness check.
  - If the lines or invoice_jobs insert fails, the invoice row is left orphaned (and the allocated number is burned, a gap in sequential VAT invoice numbering).
  - The recalculate_invoice_totals error is ignored (line 232), so totals can stay 0.
  - An invalid issueDate/dueDate string throws RangeError at toISOString() and returns a 500 with a raw message.
- Failure scenario:
  - Two staff invoice the same completed job at the same moment, and the customer is billed twice for one job.
  - Or a manual invoice number duplicates an existing one.
- Fix:
  - Move creation into one RPC (a transaction) that locks the jobs and inserts everything.
  - Add a unique partial index invoice_jobs(job_id) where active and a unique invoices(tenant_id, invoice_number).
  - Validate dates with a schema. Check the recalc error.
  - SQL migration needed.

### [MEDIUM] ACC-10: M3 still open: subcontractors GET returns all subcontractor columns to any member role
- File: app/api/subcontractors/route.ts:77-107
- Verdict: CONFIRMED
- Problem: The membership role is selected but never checked, and the route returns select("*") via service role. A driver-role member gets every subcontractor with commercial and financial fields. It also inherits the ACC-2 legacy-table problem.
- Failure scenario: A driver account (or a compromised driver phone) calls /api/subcontractors?tenantId=... and harvests every subcontractor record, including any rate, bank or insurance columns.
- Fix: Gate on admin/staff (exclude driver) and select an explicit column list. Better, use the user client so RLS applies.

### [MEDIUM] ACC-11: M5 still open: subcontractor invite leaks employee data before authorization, and silently binds existing accounts
- File: app/api/subcontractor/users/invite/route.ts:140-181 (pre-auth lookups), 207-220 (auth check), 71-95 and 222-229 (listUsers scan)
- Verdict: CONFIRMED
- Problem:
  - subcontractor_employees is fetched by id with no tenant filter. Distinct 404 / 409 / 400 ("needs an email address") responses are returned before the permission check, so any signed-in user learns whether an employee id exists, its employment status and whether it has an email.
  - After authorization, if the employee's email matches ANY existing auth user (including a user of another tenant), that account is linked into subcontractor_users with no invite or consent ("already had an account and now has subcontractor portal access").
  - findAuthUserByEmail pages through every auth user on each call, which is O(users) and an easy slowdown once signup opens. The same pattern is in settings/portal-invites.
- Failure scenario:
  1. A tenant staff member (app/subcontractors/page.tsx writes subcontractor_employees directly under RLS) sets an employee's email to a known user's address at another company.
  2. A subcontractor_admin or tenant admin invites them.
  3. That user is attached to this tenant's subcontractor portal and listed with their email, without the account owner's knowledge.
  Separately, anyone can probe employee UUIDs.
- Fix:
  - Do authorization first: resolve the caller's tenant and subcontractor admin rights, then fetch the employee with a tenant/subcontractor filter, and return a uniform 404.
  - For existing accounts, send a confirmation/magic link rather than binding silently.
  - Look up users by email via a public.users/profiles query, not a full listUsers scan.

### [MEDIUM] ACC-12: Subcontractor portal /me hands every portal role the full employee and subcontractor records, and crashes for multi-link users
- File: app/api/subcontractor/me/route.ts:71-78, 94-137, 150-213
- Verdict: PLAUSIBLE (impact depends on the columns of subcontractor_employees/subcontractors)
- Problem:
  - Any active portal user (role driver or accounts included) receives subcontractors select("*"), all subcontractor_employees select("*") and all portal users with emails. Role is never consulted.
  - subcontractor_users with eq(user_id) and eq(active, true) plus maybeSingle() errors (500) if a user is active for two subcontractors, which the invite route allows (it only dedupes per subcontractor).
- Failure scenario:
  - A subcontractor's driver sees colleagues' personal data (whatever is stored: DOB, licence, phone) and the subcontractor's commercial terms with the haulier.
  - A person employed by two subcontractors on the platform is locked out with a 500 carrying a raw PostgREST message.
- Fix: Scope the payload by portal role with explicit column lists. Handle multiple links (pick by a validated query param).

### [MEDIUM] ACC-13: Cambridge Audio RMA import: a failed import blocks every retry as "duplicate"
- File: app/api/integrations/cambridge-audio/rma/route.ts:162-191, 447-533
- Verdict: PLAUSIBLE (assumes the unique constraint implied by the 23505 handling)
- Problem:
  - The import audit row is inserted first. On any later failure the job is rolled back and the row is set to failed, but not deleted.
  - A retry with the same RMA hits the unique constraint and returns 409 duplicate: true, "has already been received".
- Failure scenario: A transient DB error while creating job_stops leaves the job rolled back and the import marked failed. Cambridge's system retries and gets 409 duplicate, treats it as delivered, and stops. The collection never appears in TMS: a missed job and an SLA breach.
- Fix: On 23505, look up the existing import. If its status is failed, reuse it (update to received and reprocess); return duplicate only for received/processed.

### [LOW] ACC-14: Statements, chase letters, purchase orders and payments accept foreign customer/subcontractor ids
- File: app/api/accounts/statements/route.ts:32-80; chase-letters/route.ts:32-80; purchase-orders/route.ts:45-100; payments/route.ts:32-52
- Verdict: CONFIRMED (write path); impact bounded
- Problem: customerId/subcontractorId from the body are written via service role without checking they belong to tenantId. Queries that derive amounts are tenant-filtered, so no foreign data is read, but rows referencing another tenant's customer are created. Later service-role embeds could surface the foreign record.
- Failure scenario: A tenant creates a PO row pointing at another tenant's customer id. Any later service-role embed customer_purchase_orders -> customers(name) shows the foreign customer's name.
- Fix: Validate each referenced id with a tenant-filtered lookup, or add composite tenant FKs (SQL).

### [LOW] ACC-15: Raw database and provider errors are returned to clients
- File: lib/accounts/server.ts:84-98; app/api/accounts/accounting/xero/test/route.ts:77-86; xero/invoices/[id]/sync/route.ts:762-770; app/api/subcontractors/route.ts:111-119; app/api/subcontractor/me/route.ts:216-227; app/api/integrations/cambridge-audio/rma/route.ts:524-531
- Verdict: CONFIRMED
- Problem: errorResponse returns error.message with 500 for every non-auth failure (PostgREST messages with table and column names, constraint names, Xero/Graph error text, "ACCOUNTING_TOKEN_ENCRYPTION_KEY must be ..."). The Xero test and sync routes return the full Xero payload.
- Failure scenario: Probing with malformed ids or dates reveals schema, constraint and env-var names, which helps target other bugs.
- Fix: Log server-side and return a generic message with a correlation id. Map known validation errors to 400/409.

### [LOW] ACC-16: Xero: accounting settings POST can fake a "connected" Xero row, and disconnect then fails permanently
- File: app/api/accounts/accounting/route.ts:40-100; app/api/accounts/accounting/xero/disconnect/route.ts:34-70; lib/accounts/providers/xero.ts:353-375, 421-453
- Verdict: CONFIRMED (admin-only)
- Problem:
  - The generic POST accepts provider "xero" with connectionStatus "connected" and an arbitrary externalTenantId, bypassing OAuth.
  - Disconnect calls revokeXeroConnection first. That throws "No stored Xero credentials were found." when no credential row exists, or when the Xero revocation returns non-2xx (an already revoked token). The local row is then never deactivated: disconnect is stuck with a 500.
- Failure scenario: An admin toggles settings, or the app's access is removed on Xero's side. The integration shows connected forever, every sync fails, and disconnect errors.
- Fix:
  - Reject the xero provider in the generic POST, except for account/tax code fields.
  - In disconnect, treat missing credentials and a revocation 400/401 as success, and always deactivate locally.

### [LOW] ACC-17: Xero token refresh race and connection selection
- File: lib/accounts/providers/xero.ts:377-419; app/api/accounts/accounting/xero/callback/route.ts:92-102
- Verdict: PLAUSIBLE
- Problem:
  - Concurrent requests near expiry all refresh the same rotating refresh token and last-write-wins the credential row. Xero's refresh grace window usually absorbs this, but a slow request can persist an older token pair after a newer one.
  - The callback picks the most recently updated connection. If authentication_event_id is absent from the token, that may be an organisation authorised earlier rather than the one just chosen.
  - Nothing prevents the same Xero organisation being bound to two TMS tenants, which would push both tenants' invoices into one ledger.
- Failure scenario: Two syncs at the expiry boundary leave a stale refresh token, and the next refresh fails with invalid_grant. The integration needs a manual reconnect.
- Fix:
  - Serialize refresh with an advisory lock or a conditional update on updated_at.
  - Fail the callback if authEventId is missing and more than one connection is returned.
  - Add a unique index on accounting_integrations(provider, external_tenant_id) where active (SQL).

### [LOW] ACC-18: M6 still open: no throttling on document email and portal invite routes
- File: app/api/accounts/invoices/[id]/email/route.ts; app/api/accounts/quotations/[id]/email/route.ts; app/api/subcontractor/users/invite/route.ts; app/api/settings/portal-invites/route.ts
- Verdict: CONFIRMED
- Problem: Each call sends mail through the shared Graph sender or Supabase invite mail with no per-user or per-tenant limit.
- Failure scenario: With self-service signup, a throwaway tenant loops the email route, exhausting Graph/Supabase send quotas and getting the sender domain blocklisted for all tenants.
- Fix: A per-tenant rate limit backed by the DB (document_delivery_log count in a time window) before sending.

### [LOW] ACC-19: L2 still open: customers search only strips commas before building a PostgREST .or() filter
- File: app/api/customers/route.ts:147-151
- Verdict: CONFIRMED
- Problem: Parentheses, dots, asterisks and percent signs in `search` are interpolated into the .or() expression. The route uses the user client (RLS) and is AND-ed with the tenant filter, so the impact stays within the tenant: broken queries (400 with raw PostgREST text) or filter manipulation.
- Failure scenario: A search like `a),id.not.is.null` changes filter semantics or returns a 400 leaking parser text.
- Fix: Strip or escape the PostgREST reserved characters and double-quote the value, or move search into an RPC.

### [LOW] ACC-20: Quotation PATCH returns early after replacing lines and stops, without restoring them
- File: app/api/accounts/quotations/route.ts:1168-1192 (inside the mutation try at 975)
- Verdict: CONFIRMED
- Problem: `if (!quoteDate) return NextResponse.json(... 400)` sits after the lines/stops delete-and-insert, but uses return rather than throw, so restoreChildren() never runs.
- Failure scenario: A client sends {lines:[...], quoteDate:""}. The response says "Quote date is required" but the lines are already replaced and totals recalculated.
- Fix: Validate all scalar fields before any mutation. Better, do the replacement in a single RPC transaction.

### [LOW] ACC-21: Invoice email fetches branding from a URL built from the request Host, forwarding the caller's cookies
- File: app/api/accounts/invoices/[id]/email/route.ts:51-112
- Verdict: PLAUSIBLE (depends on the hosting layer honouring a spoofed Host/X-Forwarded-Host; Vercel normally routes by host)
- Problem: new URL("/api/settings/documents", request.url) plus forwarded cookie/authorization headers. If request.url's host can be influenced, the server sends the admin's session cookie to that host and embeds the JSON it returns into a PDF that is then mailed out.
- Failure scenario: Behind a proxy that trusts X-Forwarded-Host, a crafted request makes the server call an attacker host with the session cookie attached.
- Fix: Call the branding loader function directly (shared lib) instead of an HTTP self-fetch. Never forward cookies to a derived origin.

### [LOW] ACC-22: Any member can set quotation status to "accepted", bypassing the customer acceptance portal
- File: app/api/accounts/quotations/route.ts:569-601, 1158-1161; app/api/accounts/quotations/[id]/convert/route.ts:54-70
- Verdict: CONFIRMED
- Problem: The PATCH accepts any status in the allowed set with no transition rules or role gate (accepted, declined, and re-opening an expired or declined quote back to draft). Convert only requires "accepted".
- Failure scenario: Staff mark an unaccepted quote accepted and convert it to a job, losing the audit trail that the customer accepted (the acceptance portal records the company position).
- Fix: Only allow "accepted" through the public acceptance flow, or record who accepted manually. Enforce a transition table.

### [LOW] ACC-23: Customers API lets any member set webhook_url/api_enabled; latent SSRF
- File: app/api/customers/route.ts:68-126; app/api/customers/[id]/route.ts:220-278
- Verdict: PLAUSIBLE (no consumer of webhook_url exists today)
- Problem: The stored URL is unvalidated (scheme, host) and writable by any member role (RLS is any-member for customers).
- Failure scenario: When a webhook sender is added, a member points it at http://169.254.169.254/ or an internal host.
- Fix: Validate https plus a public host now. Restrict the integration fields to admins. Resolve and block private IP ranges in the future sender.

---

## Verified clean in this area
- Xero OAuth: state is 32 random bytes in an httpOnly cookie compared on callback. The tenant is taken from a cookie set only after the admin check, and the callback re-runs the admin check.
- Xero tokens: AES-256-GCM with random IV and auth tag. accounting_oauth_credentials has RLS enabled with no policies and revoked grants. Status and GET routes never select credential columns.
- Xero where-clause values are escaped; all Xero hosts are constant, so there is no SSRF.
- Cambridge RMA: constant-time bearer compare, fails closed when the secret is unset, zod-validated, listed in lib/auth/publicRoutes.ts.
- Email: subject CRLF stripped; buildDocumentEmailHtml escapes values; attachments are generated from tenant-filtered rows (loadSharedPod filters by tenant_id).
- Invoice, quotation and credit-note reads and child queries all filter by tenant_id; ids from the URL are always paired with the tenant filter.
- Quotation share links: DB-backed hash, expiry, single active link, revoked on failure.
- settings/portal-invites: admin-gated, and driver and employee lookups are tenant-filtered (subject to ACC-2 and the ACC-11 silent-binding point).
- lib/validation/requestAccess.ts: bounded lengths, zod v4 email.

---

# Review 06: customer invoicing, quotations, public quote endpoints

Scope read: app/invoices/page.tsx (key flows: load, tenant handling, create, edit, preview, email, payments, credit notes, render helpers), app/invoices/QuotationPanel.tsx (state, draft, totals, create/edit/status/convert), app/invoices/QuoteRequestsInbox.tsx, lib/invoices/generatePdf.ts (full), lib/quotations/{generatePdf,publicShare,shareToken}.ts, app/quotation/share/[token]/*, app/api/public/quote-request and quotation-share (full), lib/quoteRequests/publicIntake.ts (full), lib/documents/{delivery,emailTemplate}.ts (full), lib/payments/*, lib/format/date.ts, components/DataTable.tsx, plus the accounts routes the UI calls (invoices, invoices/[id], invoices/[id]/email, quotations, quotations/[id]/{share,email,convert}, quote-requests, lookups, ready-to-invoice, payments) and the two quotation acceptance migrations in supabase/migrations.

Not found in repo (so anything depending on them is PLAUSIBLE): definitions of recalculate_invoice_totals, recalculate_quotation_totals, next_invoice_number, next_quotation_number, convert_quotation_to_job, accept_quotation_share (3-arg legacy), decline_quotation_share, mark_quotation_share_viewed, and any unique constraints on invoices / invoice_jobs. No code in the repo mints quote_request_form_tokens.

lib/printing (labels, load manifest) and components/DataTable.tsx: scanned, no HTML injection sinks or tenancy issues found; nothing to report.

Verification note for INV-1: ran pdf-lib locally (no Supabase) against StandardFonts.Helvetica. Results: "Zoe with diaeresis, Muller with umlaut, pound, euro" OK; "Ł" FAIL, "ş"/"Ş" FAIL, "ő" FAIL, "İ" FAIL, "→" FAIL, emoji FAIL, TAB (0x09) FAIL, U+202F narrow no-break space FAIL. Error text: `WinAnsi cannot encode "Ł" (0x0141)`.

Totals: CRITICAL 0, HIGH 4, MEDIUM 8, LOW 14.

---

### [HIGH] INV-1: Invoice PDF generation throws on any character outside WinAnsi, so the invoice cannot be emailed
- File: lib/invoices/generatePdf.ts:1-8 (StandardFonts.Helvetica), every drawText call, e.g. :224, :297, :530 (displayCompany), :611 (contacts), :869 (job reference), :1035 (line description); caller app/api/accounts/invoices/[id]/email/route.ts:604
- Verdict: CONFIRMED (reproduced with pdf-lib)
- Problem: The invoice PDF uses the 14 standard fonts, which only encode WinAnsi (CP1252). pdf-lib throws `WinAnsi cannot encode` for anything else, both in `widthOfTextAtSize` (called by splitText/rightText) and in `drawText`. There is no sanitising at all in this file (the quotation PDF has a `pdfSafe`, the invoice PDF does not). Characters that occur routinely in UK/EU haulage data and fail: Polish (Ł, ł, ś, ż, ć, ń), Turkish/Romanian (ş, ţ, İ), Hungarian (ő, ű), Czech (ř, ě), arrows, emoji, and TAB. TAB survives splitText only because it splits on whitespace, but it reaches `rightText` (registration number, VAT number, status) and the direct `page.drawText` calls (company name, contacts, job references, POD status) unchanged. The thrown error propagates to the email route's catch, returns 500 with the raw pdf-lib message, and the invoice is never sent.
- Failure scenario: Customer "Łódź Logistics Sp. z o.o.", a driver-entered job reference with a tab pasted from Excel, a line description "Leeds → Gdańsk", or the operator's own trading address containing "ő". Clicking "Email Invoice + POD" shows "WinAnsi cannot encode ..." and there is no way to send that invoice short of editing customer data.
- Fix: Preferred: embed a Unicode TTF with fontkit. `npm i @pdf-lib/fontkit`, `pdf.registerFontkit(fontkit)`, then `pdf.embedFont(bytes, { subset: true })` for regular and bold (IBM Plex Sans is already the app's typeface; Noto Sans covers Latin Extended, Greek, Cyrillic). Load the font bytes once per process from a file under `lib/` or `public/` via `fs.readFile` (route is `runtime = "nodejs"`). Do the same in lib/quotations/generatePdf.ts and lib/pod/generatePdf.ts so all customer documents share one font module (e.g. `lib/documents/pdfFonts.ts`). Fallback if a font file is not acceptable: add one `pdfText(font, value)` helper used by splitText, drawText, rightText and every direct `page.drawText`, which (1) replaces `\t` and U+202F/U+00A0 with a space, strips `\r` and other C0 controls, (2) applies a transliteration map for smart quotes and dashes, (3) `normalize("NFKD")` then drops combining marks only for characters the font cannot encode, (4) replaces anything still not in `font.getCharacterSet()` with "?". Add a vitest in lib/invoices that generates a PDF with "Łódź\tGdańsk → ő 🚚 €" and asserts it does not throw.

### [HIGH] INV-2: "Email Invoice + POD" always forces POD attachment, blocking email for customers that do not require POD
- File: app/invoices/page.tsx:852 (`includePod: true`); app/api/accounts/invoices/[id]/email/route.ts:119 (`includePodRequested`), :486 (`attachPod = requiresPodAttachment || includePodRequested`), :553-590 (409 when any job POD is not ready), :700-722 (generatePodPdf per job)
- Verdict: CONFIRMED
- Problem: The UI hard-codes `includePod: true` on every send. The server treats that as `attachPod`, then refuses with 409 if any linked job's `pod_status` is not in the ready set, and otherwise calls `generatePodPdf` for every job (any failure there aborts the whole email). The confirm dialog promises "available POD attachments", which is not what happens: it is all-or-nothing.
- Failure scenario: A customer with `pod_required = false` (e.g. a pallet network member who never wants PODs) has an invoice covering a job whose `pod_status` is "pending". The operator approves and clicks Email: "Invoice cannot be emailed because POD is incomplete for one or more jobs." There is no UI path to send the invoice PDF alone.
- Fix: Send `includePod` only when the customer requires it or the user opts in (a checkbox defaulting to `customer.invoice_pod_attachment_required`). Server side, when POD is merely requested (not required), attach only jobs whose POD is ready and whose PDF generates, and report the skipped ones in the response instead of 409.

### [HIGH] INV-3: Stale invoice list survives tenant switch, feeding KPIs and the payment allocation dropdown with the previous tenant's invoices
- File: app/invoices/page.tsx:400-412 (`setInvoices(current => current.length > 0 ? current : ...)`), :589-605 (openInvoices / overdue / outstanding from `invoices`), :2378-2395 (payment "Allocate to Invoice" options from `openInvoices`), :1152-1172 (createPayment); app/api/accounts/payments/route.ts:62-77 (allocation insert with no invoice ownership check)
- Verdict: CONFIRMED for the stale UI state; PLAUSIBLE for the cross-tenant allocation effect (depends on DB triggers/FKs)
- Problem: `loadLookups` refuses to replace `invoices` if the array is non-empty, and only the Invoices and Credits tabs overwrite it. After an admin switches tenant while on Ready, Payments, Statements, Chase or POs, `invoices` still holds tenant A's rows. The header KPIs (open, overdue, outstanding) show tenant A's figures under tenant B, and on the Payments tab the allocation dropdown lists tenant A's invoices. Picking one posts `{tenantId: B, customerId: <B customer>, invoiceId: <A invoice>}`. The payments route inserts `payment_allocations` with `tenant_id = B` and `invoice_id = A` without checking that the invoice belongs to the tenant or the customer (service-role client, RLS bypassed).
- Failure scenario: Admin with two tenants records a GBP 5,000 receipt for tenant B against what looks like the right invoice number; the allocation row points at tenant A's invoice. If a trigger recalculates `amount_paid`/`balance_due` from allocations by `invoice_id`, tenant A's invoice is marked paid by a tenant B payment and tenant B's real invoice stays overdue (cross-tenant financial corruption). Even without a trigger, the KPIs are wrong for the selected tenant.
- Fix: UI: in `loadLookups` always `setInvoices(body.invoices ?? [])` (drop the `current.length > 0` guard), and clear `invoices`, `readyJobs`, `rows`, `creditNotes`, `selectedJobs`, `paymentInvoiceId`, `creditInvoiceId`, `editingInvoice`, `previewInvoice` when `tenantId` changes. Server (payments route owner): select the invoice with `.eq("id", invoiceId).eq("tenant_id", tenantId).eq("customer_id", customerId)` before allocating and reject otherwise; do the same for every route that accepts a foreign-key id from the body.

### [HIGH] INV-4: Customer acceptance is not bound to the prices accepted; an accepted quotation can be reverted to draft and repriced
- File: app/api/accounts/quotations/route.ts:563-600 (status allowlist, no transition rules), :603-640 (content edits allowed for draft or sent), :1158 (`updates.status = status`); supabase/migrations/20260823193000_quotation_acceptance_company_position.sql:245-300 (acceptance header stores terms snapshot, no lines or totals); app/invoices/QuotationPanel.tsx:1523-1567 (setStatus sends any status)
- Verdict: CONFIRMED (code paths); the legacy accept_quotation_share body is not in repo
- Problem: (a) PATCH accepts any status in the allowlist from any current status, as long as `converted_job_id` is null. `accepted -> draft` is allowed, after which lines, prices and customer are editable again, and `draft -> accepted` can be set manually without any customer acceptance. (b) While a quotation is "sent" and the share link is live, content edits are allowed and the share link is not revoked. (c) `quotation_acceptances` snapshots the T&C text and hash but not the subtotal, VAT, total, currency or lines. So the immutable acceptance evidence cannot prove what price was accepted.
- Failure scenario: Customer accepts QUO-0042 at GBP 1,200 via the portal. An operator sets status back to draft, changes the line to GBP 1,800, sets it to accepted and converts to a job. The acceptance record still says "accepted by J. Smith, Buyer, Acme Ltd" and now attaches to a GBP 1,800 quotation. Or: operator edits prices while the customer has the share page open in a tab; the customer accepts the stale page's price, the DB records acceptance of the new one.
- Fix: (1) Enforce a transition table server side: `accepted` and `declined` are terminal except `accepted -> converted` (via RPC) and an explicit "withdraw acceptance" that also voids the acceptance row; only the public RPC may set `accepted`. (2) Snapshot `subtotal, vat_total, total, currency_code` and a hash of the lines (or the lines JSON) into `quotation_acceptances` and into `quotation_share_links` at share time; in the accept RPC, refuse if the quotation's current totals/lines hash differs from the share snapshot ("This quotation has changed, please reload"). (3) Revoke active share links whenever content of a sent quotation changes. (4) Send the snapshot hash from the share page with the accept POST so a stale tab is rejected.

### [MEDIUM] INV-5: Quotation PDF silently deletes the euro sign and every accented letter
- File: lib/quotations/generatePdf.ts:101-113 (`pdfSafe` final regex `[^\x09\x0A\x0D\x20-\x7E£]`), :115-133 (money passes through pdfSafe)
- Verdict: CONFIRMED (regex)
- Problem: The quote PDF avoids INV-1's crash by deleting everything outside printable ASCII plus the pound sign. That removes "€" (so EUR quotations print "12.50" with no currency), and removes Latin-1 letters that WinAnsi could actually render (é, ü, ö, ñ, ß) as well as Polish/Czech letters.
- Failure scenario: A EUR quotation to "Müller Spedition GmbH, Köln" prints "Mller Spedition GmbH, Kln" with unsymboled prices; the customer receives a document whose party name and currency are wrong.
- Fix: Same font fix as INV-1 (embed a Unicode font and delete the stripping). If staying on Helvetica, whitelist the full WinAnsi set via `font.getCharacterSet()` and transliterate the rest instead of deleting, and render the ISO code ("EUR 12.50") if the symbol is ever unencodable.

### [MEDIUM] INV-6: Share link stays acceptable after the operator cancels, declines or expires the quotation
- File: lib/quotations/publicShare.ts:79-93 (checks only revoked/expired on the share row), app/api/public/quotation-share/[token]/route.ts:141-166; supabase/migrations/20260823193000_quotation_acceptance_company_position.sql:107-137 (RPC checks share row only); app/invoices/QuotationPanel.tsx:1523 (setStatus does not revoke links); app/api/accounts/quotations/route.ts (status PATCH does not touch quotation_share_links)
- Verdict: PLAUSIBLE (the legacy 3-arg accept_quotation_share invoked at the end may or may not check quotation.status; it is not in the repo)
- Problem: Neither the page loader nor the acceptance wrapper checks `quotations.status` or `valid_until`. Link expiry is fixed at share time from `valid_until` at that moment. Marking a quotation cancelled/declined/expired, or shortening `valid_until`, leaves the emailed link fully functional.
- Failure scenario: Operator cancels a quote because the fuel price moved; the customer accepts from the week-old email anyway and, with `auto_create_job_on_accept`, a job is created at the old price.
- Fix: In `loadQuotationShare` and in the accept/decline RPCs, reject when `quotation.status not in ('sent','draft')` or `valid_until < operator today`. Revoke all active share links in the same transaction whenever status moves to cancelled/declined/expired/converted.

### [MEDIUM] INV-7: M4 and M6 still open: quote-request intake accepts requests with no Origin and has no throttling
- File: app/api/public/quote-request/[token]/route.ts:219-233 (`if (!requestOrigin) return true`), whole route (no rate limit, no captcha/honeypot); app/api/public/quotation-share/[token]/route.ts (no rate limit)
- Verdict: CONFIRMED
- Problem: `allowed_origin` is only enforced when the client volunteers an Origin header, so curl or any server bypasses it. There is no per-token, per-IP or global limit, no honeypot, and each accepted request inserts a row with up to ~60 KB of raw payload. With self-service signup, every tenant's form token will be embedded in public HTML, so harvesting is trivial.
- Failure scenario: A bot posts 100k junk quote requests per hour to a tenant's token; the operator's Quote Requests inbox (unpaginated, see INV-11) becomes unusable and storage grows unbounded.
- Fix: When `allowed_origin` is configured, require `Origin` (or fall back to `Referer` origin) and reject when both are absent. Add a rate limit keyed on `token_hash` and on client IP (the same mechanism request-access uses; a Postgres counter table or Upstash/Vercel KV), e.g. 10/min per IP and 500/day per token. Add a hidden honeypot field that is rejected if filled. Also wrap `decodeURIComponent` in try/catch (malformed `%` currently yields 500) and cap `quote_requests` rows per token per day.

### [MEDIUM] INV-8: Invoice PATCH writes header and status before the lock check and before line validation
- File: app/api/accounts/invoices/[id]/route.ts:122-158 (status and header applied), :178-200 (lock checked after, against the already-updated status), :202-234 (line validation after header update); UI caller app/invoices/page.tsx:1068-1147
- Verdict: CONFIRMED
- Problem: The lock is evaluated after `update(patch)` has run, so a body `{status: "draft", lines: [...]}` on a sent or paid invoice first flips it to draft, then passes the lock check and rewrites the values. Separately, when the UI editor saves and a line fails server validation, the header fields (issue date, due date, PO, notes) are already persisted while the response is 400, so the UI shows an error for a partially applied save. `status` is also free text: any value, including "paid", can be set without a payment.
- Failure scenario: Via API (or a future UI change that sends status with lines), an invoice already emailed to a customer is silently repriced; the emailed PDF and the ledger disagree.
- Fix: Load the invoice first, apply the lock to both header and lines, validate all lines before any write, restrict `status` to an allowed transition set (draft -> approved -> sent; paid/credited only via allocation logic), and do the header + lines + recalc in one RPC/transaction. Owner of the accounts routes should take this; it is reported here because the UI editor relies on the lock.

### [MEDIUM] INV-9: Invoice creation is non-atomic, can double-invoice a job under concurrency, and ignores the totals recalculation error
- File: app/api/accounts/invoices/route.ts:120-133 (duplicate check), :178-230 (three separate inserts), :232-234 (`await admin.rpc("recalculate_invoice_totals")` result discarded), :152 (client-supplied invoiceNumber accepted)
- Verdict: CONFIRMED (ignored error, non-atomic sequence); PLAUSIBLE (double invoicing depends on a unique partial index on invoice_jobs(job_id) where active, not visible in repo)
- Problem: Check-then-insert with no transaction: two clicks from two users (or two tabs) both pass the "already invoiced" check. A failure on the lines or invoice_jobs insert leaves an orphan invoice consuming a sequence number with no lines. If the recalc RPC fails, the route still returns 201 and the invoice shows GBP 0.00 totals, which then flow to the PDF and email. The route also accepts an arbitrary `invoiceNumber` from the body, bypassing `next_invoice_number` (UI does not send it, API callers can), so collisions rely entirely on a DB constraint that is not in the repo.
- Failure scenario: Two account clerks invoice the same completed job within a second; the customer receives two invoices for one delivery. Or the invoice_jobs insert fails on a constraint and an empty "INV-2026-0107" remains in draft, leaving a gap in the numbering sequence (a VAT audit question in the UK).
- Fix: Move create into a single SECURITY DEFINER RPC (`create_invoice_from_jobs`) that locks the job rows (`select ... for update`), checks active invoice_jobs, allocates the number, inserts invoice/lines/invoice_jobs and recalculates totals in one transaction. Add `create unique index ... on invoice_jobs(job_id) where active` and `unique(tenant_id, invoice_number)`. Drop `body.invoiceNumber` or restrict it to admins with a uniqueness check.

### [MEDIUM] INV-10: Payment form over-allocates and records every payment as GBP
- File: app/invoices/page.tsx:1152-1172 (`allocateAmount: paymentInvoiceId ? Number(paymentAmount) : 0`, no `currency`); app/api/accounts/payments/route.ts:41-47 (`currency: body.currency || "GBP"`), :62-77 (no balance check)
- Verdict: CONFIRMED (UI/server contract); effect on balance PLAUSIBLE (depends on DB constraints)
- Problem: The full receipt amount is allocated to the chosen invoice even when it exceeds `balance_due`; nothing client or server side compares them. The UI never sends `currency`, so a EUR customer's payment is stored as GBP against a EUR invoice. The two inserts (payment then allocation) are not atomic, so an allocation failure leaves an unallocated payment and a 500. `Number("")`/`NaN` amounts are guarded only by `amount <= 0` (NaN passes `<= 0` as false, so `NaN` reaches the insert).
- Failure scenario: Customer pays GBP 3,000 covering two invoices; clerk allocates to the first (GBP 1,200 balance). Balance becomes GBP -1,800 (or the insert fails on a check constraint after the payment row was already created). EUR receipts show in GBP in statements.
- Fix: UI: default and cap allocate to `min(amount, invoice.balance_due)`, send `currency` from the selected invoice or customer, and show the unallocated remainder. Server: validate `Number.isFinite(amount)`, verify invoice tenant/customer/currency, cap allocation at the invoice's current balance inside a transaction/RPC.

### [MEDIUM] INV-11: Every list is unpaginated and silently truncates at the PostgREST row cap, and KPIs are computed from the truncated list
- File: app/api/accounts/invoices/route.ts:27-33, app/api/accounts/lookups/route.ts:37-44, app/api/accounts/ready-to-invoice/route.ts:17-21, app/api/accounts/payments/route.ts:15-19, app/api/accounts/quote-requests/route.ts:52-99, app/api/accounts/quotations/route.ts (GET); consumers app/invoices/page.tsx:589-605, QuotationPanel.tsx:265-296, QuoteRequestsInbox.tsx:103-150
- Verdict: PLAUSIBLE (Supabase projects default to max_rows 1000; setting not in repo)
- Problem: No `.range()`, no count, no server-side aggregates. At 1,000 invoices the oldest ones disappear from the list and from `openInvoices`, so "Outstanding" and "Overdue" understate exactly the old debts that matter most, and the payment allocation dropdown cannot find old invoices. Ready-to-invoice beyond 1,000 jobs means some completed jobs never appear to be invoiced (lost revenue). Also, `customerIds` in the invoices GET is passed to `.in()`, which with ~1,000 UUIDs produces a URL of roughly 37 KB and can exceed request-line limits.
- Failure scenario: A mid-size haulier creating 25 invoices a day passes 1,000 invoices in about six weeks; overdue KPI drops and old unpaid invoices vanish from the page with no indication.
- Fix: Paginate lists with `.range()` plus `count: "exact"`, filter server side (status/open/customer), and compute outstanding/overdue totals with a SQL aggregate or view rather than client-side reduce. Use an embedded select `customers(name)` instead of the `.in(customerIds)` second query.

### [MEDIUM] INV-12: Accounts page fetches have no staleness guard, and dataTenantId is never set on success
- File: app/invoices/page.tsx:415-546 (`loadTab`), :541 (`setDataTenantId(tenantId)` only in catch), :416-417 (only on no-tenant path), :554-560 (skeleton rule)
- Verdict: CONFIRMED (dataTenantId); PLAUSIBLE (race, timing dependent)
- Problem: `loadTab` has no request id or AbortController. Switching tenant A -> B (or tab X -> Y) quickly lets the slower A response call `setInvoices`/`setReadyJobs`/`setRows` after B's, showing A's data under B's selector. The skeleton rule was built to prevent this, but because `dataTenantId` is only written on error, it is `undefined` after every successful load, so the guard never matches: the page instead flashes a skeleton on every refetch (including after every save through `postJson`, which the comment at :264 says must not happen) and gives no protection once `fetching` is false.
- Failure scenario: Admin toggles tenants on a slow connection and approves or emails an invoice from the wrong tenant's list; the server rejects on tenant filter, but the user sees confusing errors, and the Ready tab can show another tenant's jobs to select.
- Fix: Keep a `requestIdRef`; increment at the start of `loadTab`, and ignore results whose id is not current. Call `setDataTenantId(tenantId)` after a successful load (inside the try, after state updates). Apply the same pattern to QuotationPanel `load` and QuoteRequestsInbox `load`.

### [LOW] INV-13: Quotation form totals use unrounded float math, so on-screen totals can differ from the saved and PDF totals
- File: app/invoices/QuotationPanel.tsx:238-262
- Verdict: PLAUSIBLE (recalculate_quotation_totals not in repo)
- Problem: `quantity * unitPrice` and `subtotal * vatRate/100` are summed without per-line rounding, while the DB presumably rounds per line (the credit note code rounds per line at page.tsx:1178-1230, showing the intended convention). With fractional quantities or rates, the form's "Total" can be 1p off the saved `total` that the customer sees on the PDF and share page.
- Fix: Share one money helper in lib (e.g. `lib/invoices/money.ts`) that works in integer pence, rounds VAT per line with the same rule as the SQL function, and add a vitest pinning it against a few known cases (e.g. 3 x 33.335 at 20%). Use it for quotation, invoice editor preview and credit notes.

### [LOW] INV-14: Creating a quotation from a quote request can create duplicates when the request link step fails
- File: app/invoices/QuotationPanel.tsx:1473-1506
- Verdict: CONFIRMED
- Problem: The quotation POST succeeds, then the quote-request PATCH fails and throws. The catch shows an error, but the form, the draft in localStorage and `activeQuoteRequestId` are kept, so clicking Create again allocates a second quotation number for the same request. `working` also only prevents concurrent clicks, not a retry after an error.
- Fix: After a successful POST, clear the draft and form immediately; treat the link failure as a warning ("Quotation QUO-x created, but the request could not be linked") with a retry-link action rather than a thrown error. Better: pass `quoteRequestId` to the create endpoint and link in the same transaction.

### [LOW] INV-15: Dates, due dates and overdue use UTC or server-local time instead of the operator's timezone
- File: app/invoices/page.tsx:596-600 (overdue uses `new Date().toISOString().slice(0,10)`), :296, :1473, :1673; app/api/accounts/invoices/route.ts:142-150 (issue date from UTC today, due via `new Date("YYYY-MM-DDT00:00:00")` in server-local time then `toISOString`); app/api/accounts/quotations/[id]/share/route.ts:39-42 (expiry at 23:59:59Z); app/api/accounts/payments/route.ts:43
- Verdict: CONFIRMED
- Problem: Between 00:00 and 01:00 BST the "today" used is yesterday, so default issue/payment dates are a day early and invoices due today show overdue only from 01:00. The due date calculation is correct on Vercel (UTC) but shifts one day earlier on any non-UTC server or local dev during BST, because local midnight converts to 23:00Z of the previous day. Share links for "valid until 14 Sept" expire at 00:59 BST on the 15th. None of this uses `lib/time.ts` OPERATOR_TIME_ZONE.
- Fix: Use the operator-day helpers in lib/time.ts for "today" and pure calendar arithmetic on `YYYY-MM-DD` (e.g. parse as UTC noon or use a date-only add-days helper) for due dates; compute share expiry as end of `valid_until` in the operator timezone.

### [LOW] INV-16: Mojibake null placeholder on invoice cards
- File: app/invoices/page.tsx:4779 (`if (!value) return "â€”";`)
- Verdict: CONFIRMED
- Problem: The em dash placeholder was double-encoded, so invoices with no issue or due date render the three characters "â€”".
- Fix: Replace with a plain "-" or the correct Unicode character, and consider using lib/format/date.ts (after the behavioural diff its header warns about).

### [LOW] INV-17: Quotation email failure cleanup can never run, so a failed send leaves an orphan active share link
- File: app/api/accounts/quotations/[id]/email/route.ts:960-1000 (`await request.clone().json()` inside catch)
- Verdict: CONFIRMED (fetch spec: cloning a Request whose body was already read throws TypeError)
- Problem: The body was consumed at the start of the handler, so `request.clone()` throws, the inner catch swallows it, and the newly inserted share link is never revoked. Impact is limited because a failed send usually means the token never left the server, but links accumulate, and if the failure happens after Graph returned 202 (for example the `quotation_share_links` or `quotations` update failed) an email with a live link has been sent while the UI reports failure and older links were not revoked.
- Fix: Hoist `tenantId` (and the admin client) into variables declared before the try and use them in the catch; do not re-read the body.

### [LOW] INV-18: Public share page leaks raw internal errors and records a "view" on every render, including link scanners
- File: app/quotation/share/[token]/page.tsx:347-362 (renders `error.message`), lib/quotations/publicShare.ts:247-264 (markViewed on every GET, and throws if the RPC errors); app/api/public/quotation-share/[token]/route.ts:212-223 (500 returns `error.message`), :168-172 and :196-199 (RPC error messages returned verbatim)
- Verdict: CONFIRMED
- Problem: PostgREST/pg error text (column names, "QUOTATION_SHARE_SECRET must be configured with at least 32 characters.") is shown to anonymous visitors. `mark_quotation_share_viewed` runs on every server render, so Outlook Safe Links / Mimecast pre-fetches set `first_viewed_at` before the customer opens anything, and a transient failure of that RPC makes the whole quotation unavailable.
- Fix: Map known business errors (revoked, expired, already accepted) to fixed messages and return a generic message for everything else, logging the detail server side. Make markViewed best effort (log, do not throw), and consider recording the view from a client effect after hydration so scanners without JS do not count.

### [LOW] INV-19: Public accept/decline endpoint lacks input bounds and crashes on a non-object body
- File: app/api/public/quotation-share/[token]/route.ts:47-125
- Verdict: CONFIRMED
- Problem: `await request.json()` of `null` makes `body.action` throw (500 with the TypeError message). Name, email, company and position have no length cap or email format check server side (the client `maxLength` is advisory), `clauseKeys` is an unbounded array, and `x-forwarded-for` first hop is trusted as the evidence IP (on Vercel prefer `x-real-ip` or `request.ip`). The duplicate `if (!email)` block is dead code. Replay itself is correctly prevented by the RPC's `for update` lock and accepted/declined checks.
- Fix: Validate body is a plain object; cap strings (e.g. 150/254/200/150), validate email with the same EMAIL_PATTERN used elsewhere, cap clauseKeys length to the clause count, and take the client IP from the platform-provided header.

### [LOW] INV-20: Invoice PDF layout breaks on long text and multi-page invoices
- File: lib/invoices/generatePdf.ts:138-160 (splitText never breaks a word wider than maxWidth), :185-246 (drawText with explicit `y` ignores the page break that ensureSpace just created), :530-620 (company name, contacts and address not bounded against the right-hand Company No / VAT No), :850-915 (job reference drawn unwrapped in a 172pt box), :1004-1100 (description width 295 but unbreakable tokens overflow into Qty/Rate), :166-174 (continuation pages have no header, invoice number or page numbers), :310-349 (logo fetch has no timeout)
- Verdict: CONFIRMED (code reading)
- Problem: An IBAN or URL in bank details, a long reference like "RMA-2026-000123-CAMBRIDGE-AUDIO-RETURNS", or a long trading name overlaps adjacent columns or runs off the page. Pages after the first carry no invoice number or "Page x of y", which matters for multi-page invoices with many jobs. A slow or hanging logo URL stalls the email request until the platform timeout.
- Fix: In splitText, hard-break any word wider than maxWidth by characters; wrap/truncate header and job box text to their widths; draw a compact running header (company, invoice number) and page footer on every page after layout (as the quotation PDF already does for page numbers); add `AbortSignal.timeout(5000)` to the logo fetch.

### [LOW] INV-21: No code manages quote-request form tokens (issue, rotate, revoke, set allowed_origin)
- File: app/api/public/quote-request/[token]/route.ts:295-316 (lookup only); no other reference to `quote_request_form_tokens` in app/ lib/ supabase/ docs/
- Verdict: CONFIRMED
- Problem: Tokens can only be created by hand in the database, so with self-service signup a new tenant cannot get a form token, cannot rotate a leaked one and cannot set `allowed_origin` (which is why INV-7's bypass matters: most tokens will have none). The only length check is `>= 32` characters, with no charset or entropy guarantee for hand-made tokens.
- Fix: Add a settings route and UI to create (32 random bytes, base64url, store the sha256 only), rotate, deactivate and set allowed origin, with the plaintext shown once.

### [LOW] INV-22: Public intake has no CORS handling, which causes duplicate submissions from browser-based forms
- File: app/api/public/quote-request/[token]/route.ts (no `OPTIONS` export, no `Access-Control-Allow-Origin` on responses)
- Verdict: PLAUSIBLE (depends on how customers embed the form)
- Problem: A website form that posts with `fetch` and `application/json` fails its CORS preflight outright. A `fetch` using form-urlencoded content is a simple request: it goes through and the row is inserted, but the browser then blocks reading the response, so the page shows a network error and the visitor retries, creating duplicate quote requests.
- Fix: When `allowed_origin` is set, answer `OPTIONS` and add `Access-Control-Allow-Origin: <allowed_origin>` (and `Vary: Origin`) to responses; document form-post plus redirect as the alternative. Consider an idempotency key (hash of payload plus minute) to collapse retries.

### [LOW] INV-23: Quotation drafts persist customer personal data in localStorage indefinitely
- File: app/invoices/QuotationPanel.tsx:233-234, :544-700
- Verdict: CONFIRMED
- Problem: The autosaved draft includes contact names, phone numbers, emails and addresses copied from public quote requests, keyed per tenant, with no expiry, and survives sign-out on shared depot or office PCs.
- Fix: Store a timestamp and discard drafts older than e.g. 24 hours, clear all `tms:quotation-draft:*` keys on sign-out, or move drafts server side.

### [LOW] INV-24: Invoice creation sends raw selectedJobs rather than the jobs actually visible
- File: app/invoices/page.tsx:643-677 (`jobIds: selectedJobs` while validation uses `selectedReady`)
- Verdict: CONFIRMED
- Problem: `selectedJobs` is never cleared on tenant switch or reload, so ids no longer in `readyJobs` (invoiced by a colleague, or from another tenant) are still posted. The server rejects with "One or more selected jobs were not found" or "must belong to the same customer", which is confusing when the on-screen selection looks valid.
- Fix: Post `selectedReady.map(job => job.job_id)` and prune `selectedJobs` whenever `readyJobs` or `tenantId` changes.

### [LOW] INV-25: Invoice email marks the invoice sent only after the provider call, and resends need only a confirm
- File: app/api/accounts/invoices/[id]/email/route.ts:886-960; app/invoices/page.tsx:814-940, :4580-4600
- Verdict: CONFIRMED
- Problem: If the `invoices` status update or the `invoice_jobs` update fails after Graph returned 202, the UI reports failure although the customer received the email, inviting a resend. "sent" invoices keep the same "Email Invoice + POD" button with no "already sent on <date> to <recipient>" warning, so duplicate invoice emails are easy.
- Fix: Treat post-send bookkeeping failures as warnings in the response (the send succeeded), and for status "sent" change the button label and confirm text to "Resend (last sent <sent_at> to <invoice_email>)".

### [LOW] INV-26: Share URLs in emails are built from the request's Host
- File: app/api/accounts/quotations/[id]/share/route.ts:272-280; app/api/accounts/quotations/[id]/email/route.ts:541-548
- Verdict: PLAUSIBLE (Vercel normalises Host, so low risk today)
- Problem: `new URL(request.url).origin` reflects the Host the request arrived on (preview deployment URLs, or a spoofed Host behind a misconfigured proxy), so customers can receive acceptance links pointing at a Vercel preview domain or an attacker-controlled host.
- Fix: Build public links from a configured `NEXT_PUBLIC_APP_URL` / `APP_ORIGIN` env var, falling back to request origin only in development.

---

# Review 07: POD, driver app, jobs, load manifests, file storage

Scope: app/pod/**, lib/pod/**, app/api/pod/**, PodLink, app/driver/**, app/api/driver/**, lib/driver/**,
app/drivers/**, app/jobs/**, app/api/jobs/**, lib/jobs/**, app/api/load-manifests/**, supabase migrations
(job_items_baseline, job_item_scans, load_manifests, driver_activity_timezone_ferry, driver_planning_profile),
all storage upload/download/sign code. Review only. No repo files changed, nothing run against Supabase.

## Carry-over status from the 2026-08-25 audit

| Item | Status | Notes |
|---|---|---|
| M1 POD email to any recipient | STILL OPEN | `app/api/pod/share/email/route.ts:292-316`. `body.to` is used as-is after a format regex. See POD-3 (raised to HIGH because of self-service signup). |
| M2 POD share tokens can't be revoked | STILL OPEN | `lib/pod/shareToken.ts` unchanged: stateless HMAC, 7-day lifetime, no DB record. See POD-9. |
| H2 job-files bucket | STILL OPEN (as far as the repo shows) | `docs/sql/rls_12_job_files_lockdown.sql` still says NOT YET APPLIED, and the README roadmap still lists it. No app/lib code touches `job-files`. The draft migration also has a logic flaw. See POD-4. |
| Data gap: /jobs savePod omits pod_updated_at | STILL TRUE | `app/jobs/page.tsx:721-731` does not write `pod_updated_at`. `app/pod/page.tsx:519` and the driver complete route do. `lib/tracking/activity.ts:18-73` works around it. See POD-14. |

Checked and clean in this pass:
- Driver API routes take `tenant_id`, `driver_id` and `subcontractor_id` from the session, never from the request.
- Path ids are UUID-validated, and each stop is re-checked against its job and tenant.
- The driver evidence storage path is built from the session tenant, validated ids and a sanitised filename, so path traversal isn't possible. Photo content is checked by magic bytes.
- Share token signatures are compared with a length-guarded `timingSafeEqual`. The secret must be at least 32 characters, and a missing secret fails closed.
- The token payload binds tenantId and jobId, and every lookup re-filters on both.
- `/api/pod/share` and `/api/pod/share/email` are correctly left out of the public allowlist. Only `/api/pod/share/*/pdf` is public.
- The load manifest RPCs are service-role only. They re-check tenant, driver, vehicle and job ownership and lock the manifest row.
- Scan dedupe is backed by a unique index, and the 23505 error is handled.

---

### [HIGH] POD-1: Editing any job deletes and recreates all its stops, wiping the POD and breaking deliveries in progress
- File: app/jobs/page.tsx:340-366 (saveJob), app/jobs/page.tsx:1404-1412 (Edit button shown for every status), supabase/migrations/20260902133000_job_item_scans.sql:6-9
- Verdict: CONFIRMED for the code path. PLAUSIBLE for how the pod_evidence FK behaves (the pod_evidence DDL isn't in the repo).
- Problem: Saving an edit updates `jobs`, runs `delete from job_stops where job_id = ...`, then inserts brand-new stop rows with `status: "planned", pod_status: "pending"`. None of this runs in a transaction. The Edit button shows for every job status, including `completed`.
- Failure scenario:
  1. Someone in the office fixes a typo in the reference on a completed job. Every stop is recreated. recipient_name, delivered_at, collected_at, pod_notes and pod_photo_url are lost and every stop goes back to pending, but the job row still says completed. The public POD share page and PDF now show an empty POD.
  2. If `pod_evidence.stop_id` cascades, every POD photo and document row for the job is deleted and the storage objects are left orphaned. If it restricts, see 3.
  3. `job_item_scans.stop_id` is `on delete restrict`. Once a job has a single barcode scan it can't be edited. The stop delete fails with 23503 after the jobs row update has already committed, so the edit is half-applied and the user sees "Delete old stops error".
  4. If a dispatcher edits a job while the driver is on site, the stop ids change. The driver's upload and complete calls return "Job stop not found", and the photo they just uploaded points at a stop that no longer exists.
- Fix: Stop deleting and reinserting stops. Diff the stops instead, ideally in a SECURITY DEFINER RPC that runs in one transaction: update existing rows by id, insert new ones, and delete only removed stops that have no POD, evidence or scans. Block stop edits (or the whole job) once any stop's pod_status is past pending or the job is completed. An RPC would need a SQL migration.

### [HIGH] POD-2: Vercel's 4.5 MB request limit blocks most driver POD photo uploads, so drivers can't complete deliveries
- File: app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/route.ts:134-166, lib/driver/pod.ts:1-2, app/driver/jobs/[jobId]/page.tsx:359-392
- Verdict: CONFIRMED. Vercel Functions reject request bodies over 4.5 MB before the handler runs, and CLAUDE.md says the app is deployed on Vercel.
- Problem: The driver app posts the raw camera file as multipart to a Next route handler. The code advertises and checks a 15 MB limit, but the platform rejects anything over about 4.5 MB with a 413 `FUNCTION_PAYLOAD_TOO_LARGE` and a body that isn't JSON. The client calls `response.json()` on that body, which throws, so the driver gets a generic parse error. Nothing resizes or compresses the photo on the client. `request.formData()` also reads the whole body into memory before any size check.
- Failure scenario: A driver with a modern Android phone (50 MP camera, 6 to 12 MB JPEGs) takes the POD photo and the upload fails every time. The complete route needs at least one evidence row, so the driver can't complete the delivery from the driver app at all.
- Fix: Compress and resize on the client before upload (canvas to a JPEG of about 2 MB). Alternatively, have a driver-authenticated route mint a signed upload URL (`createSignedUploadUrl`) for a server-chosen path, let the client PUT straight to Storage, and have the route record the row after checking the object exists. Make the advertised limit match reality and handle error bodies that aren't JSON.

### [HIGH] POD-3: The POD email route is an open relay for attacker-written content to any recipient (M1 still open, worse once self-service signup opens)
- File: app/api/pod/share/email/route.ts:60-99, 272-316, 355-410
- Verdict: CONFIRMED
- Problem: Any signed-in user with any membership row in the tenant can send the POD email to any address. The access helper ignores role, so invited `driver` members qualify. The tenant controls every piece of content:
  - The subject contains the job reference, with only CR/LF stripped.
  - The body contains the customer contact name.
  - The PDF contains addresses, notes and recipient names.
  
  There is no rate limit, and mail goes out through the platform's MS Graph sender.
- Failure scenario: Once self-service signup is open, an attacker can:
  1. Sign up and create a customer named "Your account is suspended, call 0800...".
  2. Create a job with a phishing reference and mark a stop delivered with a photo.
  3. Call POST /api/pod/share/email in a loop, setting `to` to victim addresses.
  
  The platform's sending domain then delivers phishing mail with a PDF attachment, which damages sender reputation for every real tenant.
- Fix: Unless the caller is an admin, only allow the job customer's stored contacts (or a tenant-verified allowlist) as recipients. Add per-user and per-tenant rate limits stored in the DB, not in memory. Require the admin or staff role and reject drivers. Consider holding outbound mail for new, unverified companies.

### [HIGH] POD-4: The job-files bucket is still not locked down, and the drafted fix may not close it
- File: docs/sql/rls_12_job_files_lockdown.sql:31-38, README.md:213
- Verdict: PLAUSIBLE (live policy state not inspected)
- Problem: rls_12 is still marked unapplied, so per the audit the bucket is still public and its permissive policies check the bucket only. The draft also has a flaw. It drops policies by guessed names ("job-files insert" and so on) and says a drop that matches nothing is harmless because the new grants "define access on their own". That's wrong. Permissive policies are OR-ed together. If the real legacy names are different, the old bucket-wide policies survive and keep giving every signed-in user read, insert, update and delete across tenants. The verify query only lists `job_files_%`, so it still reports success.
- Failure scenario: Ethan runs rls_12, sees job_files_read and job_files_insert present with public=false, and marks H2 closed. The Supabase template policies, which have different names, are still in place. Any signed-in user can still list, read, overwrite and delete other tenants' files through the Storage API.
- Fix: Before applying, list the actual policies (`select policyname, cmd, qual from pg_policies where schemaname='storage' and tablename='objects'`) and drop, by their real names, every policy whose qual mentions job-files. Extend the verify step to assert that no other policy mentions `job-files`. This needs a SQL migration. Since no code uses the bucket, the simplest option is to empty it and delete it.

### [HIGH] POD-5: The POD PDF and email say "ADR Carriers" for every tenant
- File: lib/pod/generatePdf.ts:75, app/api/pod/share/email/route.ts:371-405
- Verdict: CONFIRMED
- Problem: The PDF header is hardcoded as "ADR CARRIERS". The email signs off "Regards, ADR Carriers", passes `companyName: "ADR Carriers ltd"`, and has the footer "Thank you for choosing ADR Carriers". The Cambridge Audio RMA handling is also hardcoded into a route every tenant uses.
- Failure scenario: A haulier who just signed up emails a POD to their customer. The customer gets a proof of delivery branded as a different, real haulage company. A legally significant document is misattributed, which confuses the customer and risks both firms' reputations.
- Fix: Load the tenant's or company's document settings (name, logo, footer) inside generatePodPdf and the email route. `settings/documents` already exists. Put the Cambridge special case behind a per-tenant integration flag.

### [HIGH] POD-6: POD PDF generation crashes on characters outside the basic Western (WinAnsi) set, so both the PDF download and the POD email fail
- File: lib/pod/generatePdf.ts:59-67, 102-122 (drawText with StandardFonts.Helvetica)
- Verdict: CONFIRMED. pdf-lib's standard fonts only support WinAnsi, and `node_modules/@pdf-lib/standard-fonts/lib/Encoding.js:22` throws "cannot encode".
- Problem: Every text value goes through `drawText` with a standard font: reference, customer name, addresses, recipient name, notes and evidence filenames. Characters WinAnsi can't encode throw: Polish ł, Czech and Romanian diacritics such as č, ř and ș, Cyrillic, emoji. Only image embedding is inside a try/catch.
- Failure scenario: A delivery goes to "Łukasz Wiśniewski", or to a Polish address, or the notes contain an emoji. `/api/pod/share/[token]/pdf` returns 500 and `/api/pod/share/email` fails before sending, so the customer never gets the POD. This will be common in UK and EU haulage.
- Fix: Embed a Unicode TTF through `@pdf-lib/fontkit` (for example IBM Plex Sans, which the app already uses), or run strings through a WinAnsi-safe transliteration filter before drawing. Add a unit test with Polish and Czech diacritics.

### [MEDIUM] POD-7: The POD PDF silently drops every stop after the fourth
- File: lib/pod/generatePdf.ts:156-159
- Verdict: CONFIRMED
- Problem: The stop loop runs on a single page and stops with `if (y < 170) break;`. Each stop takes about 140pt and the first starts near y=630, so only stops 1 to 4 are drawn. There is no continuation page and no "N more stops" note.
- Failure scenario: A multi-drop job with 6 deliveries is completed. The emailed POD PDF shows only the first 4 stops, so deliveries 5 and 6 look as if they have no proof of delivery.
- Fix: Start a new page when y runs low instead of breaking. Add a test with 10 stops.

### [MEDIUM] POD-8: WebP and HEIC POD photos, which the driver app accepts, never appear in the PDF
- File: lib/pod/generatePdf.ts:256-264, lib/driver/pod.ts:4-9
- Verdict: CONFIRMED
- Problem: The driver upload accepts JPEG, PNG, WebP and HEIC, but the PDF only embeds JPEG and PNG. The text still says "Evidence: 1 file(s)".
- Failure scenario: An iPhone driver uploads a HEIC photo. The customer's PDF claims one evidence file but shows no photo.
- Fix: Convert to JPEG at upload or at PDF time (sharp is already a dependency). Or limit driver uploads to JPEG and PNG and convert on the client.

### [MEDIUM] POD-9: POD share links can't be revoked and keep working after the job changes (M2 still open)
- File: lib/pod/shareToken.ts:12-55, app/pod/share/[token]/page.tsx:120-143, app/api/pod/share/[token]/pdf/route.ts:16-44
- Verdict: CONFIRMED
- Problem: Tokens are stateless 7-day HMACs with no stored record and no way to revoke one. Nothing re-checks that the job is still completed. The only kill switch is rotating POD_SHARE_SECRET, which kills every tenant's links. The page and PDF are rebuilt from live data on every hit. Each PDF request downloads every full-size image from storage with the service role, with no caching and no rate limit.
- Failure scenario:
  - A link emailed to the wrong address (see POD-3) keeps serving delivery addresses, recipient names and photos for a week.
  - If the job is later reopened or edited (POD-1), the link serves whatever is there now.
  - Anyone holding a leaked link can hit it repeatedly, forcing large image downloads and PDF builds each time.
- Fix: Follow the `quotation_share_links` pattern:
  - Store a token hash, expires_at and revoked_at for each share, and check tokens against that table.
  - Re-check the job status on every read.
  - Cache the generated PDF per job version.
  - Rate-limit the public PDF route.
  
  This needs a SQL migration.

### [MEDIUM] POD-10: The service role signs any storage_path saved in pod_evidence, so a tenant can trick it into serving another tenant's files
- File: lib/pod/shareData.ts:89-121, lib/pod/generatePdf.ts:266-275, app/jobs/StopCard.tsx:241-253, app/pod/page.tsx:374-386
- Verdict: PLAUSIBLE. It depends on the pod_evidence insert policy, which isn't in the repo.
- Problem: The console pages insert `pod_evidence` rows from the browser with a `storage_path` the client chooses. As far as the repo shows, the table policy only checks `tenant_id`, not the path. The public share page and PDF then sign or download those paths with the service-role client. The service role bypasses the pod-files per-tenant path policy. Signed URLs contain the full object path, so anyone who has ever received a tenant's POD link knows real paths.
- Failure scenario: Tenant B is a haulier that subcontracts for tenant A and has received A's POD links, so B knows A's object paths.
  1. B inserts a pod_evidence row on one of B's own jobs with `storage_path = "<A tenant>/<job>/<stop>/photos/..."`.
  2. B completes that job and opens B's own share link.
  3. The service role signs A's file, so B can keep reaching it after A's link has expired.
- Fix: In loadSharedPod and generatePodPdf, skip any evidence whose path doesn't start with `${tenantId}/${jobId}/${stopId}/`. Add a CHECK constraint or trigger on pod_evidence that enforces that prefix (SQL migration). Prefer server routes for console uploads, as the driver app already does.

### [MEDIUM] POD-11: The driver job page throws away the typed recipient name and notes after every photo upload or scan
- File: app/driver/jobs/[jobId]/page.tsx:106-159, 310-346, 408, 458; BarcodeVerification.tsx:190
- Verdict: CONFIRMED
- Problem: `onChanged` is `loadJob`, which sets `loading=true`. The page then renders only "Loading job...", so every StopCard and the camera scanner unmount. When they remount, the form state is reset from the server row, where recipient_name is still null.
- Failure scenario: The driver types the recipient name (the field sits above the photo buttons), then takes the POD photo. The upload succeeds, the page flashes, and the name field is empty. On a multi-drop job, every scan or upload wipes the unsaved inputs on every stop. The camera scanner also closes after each scan, so the driver never gets to the "Scan again" button.
- Fix: Only show the full-page loader on the first load and keep the existing `job` on screen while refetching, or hold draft form state in the parent keyed by stop id. The same change fixes the scanner.

### [MEDIUM] POD-12: The server doesn't enforce job status changes, so cancelled or unaccepted jobs can be completed and a finished POD can still be changed
- File: app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route.ts:239-345, evidence/route.ts:650-681, app/jobs/page.tsx:721-755, app/pod/page.tsx:468-600
- Verdict: CONFIRMED in code. PLAUSIBLE that nothing in the DB enforces it either (no trigger in the repo).
- Problem:
  - None of the three completion paths checks the job's current status. All three set the job to completed without a `status` precondition.
  - The driver evidence route still accepts uploads to stops that are already delivered.
  - Barcode verification is never required before completion, on the client or the server.
- Failure scenario:
  - A dispatcher cancels a job, or it is still pending_acceptance. The driver still has the page open and completes the stop. The job flips to completed and can be shared.
  - After the POD has been emailed, the driver can keep adding photos to the delivered stop, which changes what the customer's share link shows.
  - A driver can complete a serialised delivery with 0 of N items verified.
- Fix: Add `.in("status", [allowed])` preconditions to the stop and job updates and check how many rows changed. Reject evidence uploads once `pod_status = 'delivered'`, unless the office overrides. Decide whether full barcode verification is required, and if so enforce it in the complete route. A DB trigger on jobs.status changes would be the durable guard (SQL migration).

### [MEDIUM] POD-13: Supabase's 1000-row cap silently cuts off the POD and Jobs consoles
- File: app/pod/page.tsx:148-202, app/jobs/page.tsx:115-127
- Verdict: CONFIRMED. There's no range or pagination, and Supabase returns at most 1000 rows by default.
- Problem: /pod loads every job and every pod_evidence row for the tenant with no pagination. /jobs loads every job with its stops and items nested.
- Failure scenario:
  - After a few hundred jobs, pod_evidence passes 1000 rows. Evidence is loaded newest first, so older stops get no evidence at all. `hasPodEvidence` returns false, those stops show as missing their POD, they count toward the overdue KPIs, and "Complete" is refused.
  - On /jobs, jobs past the first 1000 disappear from the list with no warning.
- Fix: Paginate using server-side filters and `range`. Load evidence only for the jobs on screen (`in("job_id", visibleIds)`), or get evidence counts from a view or RPC.

### [MEDIUM] POD-14: The /jobs POD save path behaves differently from /pod and the driver app (pod_updated_at gap confirmed)
- File: app/jobs/page.tsx:721-755
- Verdict: CONFIRMED
- Problem: `savePod` has several gaps compared with the other writers:
  - It doesn't set `pod_updated_at`. It is the only writer that skips it.
  - The stop update filters only on `.eq("id", stopId)`, with no tenant or job filter, so RLS is the only guard.
  - It completes the job without `.eq("tenant_id")`.
  - It accepts a free-text `pod_photo_url`.
- Failure scenario: Anything that relies on pod_updated_at can't see a stop that was PODed from /jobs. Tracking activity has a workaround, but other consumers won't. When an admin works across several tenants, only RLS keeps the writes correct.
- Fix: Pull out one `completeStopPod` helper, ideally a server route or RPC shared with the driver route, and call it from both consoles. Include pod_updated_at and the tenant and job filters.

### [MEDIUM] POD-15: RLS on the new job_items, job_item_scans and load_manifests tables uses auth_tenant_id(), unlike every other tenant table, and that function isn't defined in the repo
- File: supabase/migrations/20260902130000_job_items_baseline.sql:36-81, 20260902133000_job_item_scans.sql:55-62, 20260902140000_load_manifests.sql:136-158
- Verdict: PLAUSIBLE. auth_tenant_id isn't defined anywhere in docs/sql or supabase, so its live behaviour is unverified.
- Problem: Every other tenant table uses `can_access_tenant(tenant_id)`, which lets company admins reach every tenant in their company. These policies compare against `auth_tenant_id()`, which by its name is the caller's single home tenant.
- Failure scenario: A company admin views tenant B, which isn't their profile tenant, on /jobs.
  - Jobs and stops load, but `job_items` comes back empty.
  - Labels print nothing and Master Load Builder can't build a manifest.
  - Inserting job_items for tenant B is refused.
- Fix: Check auth_tenant_id in the live DB. Replace it with `can_access_tenant(tenant_id)` for select, and `can_access_tenant` or `can_manage_tenant` for writes. This needs a SQL migration. If auth_tenant_id stays, add its definition to version control.

### [MEDIUM] POD-16: Driver GPS tracking stops for good after one failed POST (no offline handling)
- File: app/driver/DriverGpsTracker.tsx:60-111, 136-158
- Verdict: CONFIRMED
- Problem: Any failed request clears the geolocation watch and sets an error state: a dropped signal in a tunnel, a 5xx, or a 409 from a brief assignment change. There's no retry and no queue for positions recorded while offline. The geolocation error callback also clears watchId without calling clearWatch. A TIMEOUT doesn't end the watch, so pressing Start again creates a second watch running alongside the first.
- Failure scenario: A driver passes through an area with no signal 20 minutes into the shift. Tracking silently stops for the rest of the day unless the driver notices a small red message and taps Start again. The office sees the vehicle as stationary.
- Fix: On network errors and 5xx responses, keep the watch and back off. Buffer positions while offline and send them when the connection returns. Only stop on 401, 403 or permission-type 409 errors. Call clearWatch in the error callback.

### [LOW] POD-17: Deleting POD evidence from the console leaves the file in storage, and cleanup after a failed insert silently does nothing
- File: app/jobs/StopCard.tsx:282-330, app/pod/page.tsx:423-466, 386-392; docs/sql/rls_10a_pod_files_restrictive.sql (pod_files_delete_deny)
- Verdict: PLAUSIBLE. The file documents the restrictive delete-deny policy as live.
- Problem: The restrictive `pod_files_delete_deny` policy blocks DELETE on pod-files for signed-in users (the comment says "app never removes uploads"). Both consoles still call `storage.remove()` with the browser client and then delete the row. When RLS blocks a storage remove, it returns an empty result with no error. So the row is deleted and the file stays. The cleanup after a failed pod_evidence insert has the same problem.
- Failure scenario: An operator deletes a photo uploaded by mistake, for example one showing a customer's ID. The UI says it's deleted, but the file stays in the bucket indefinitely with nothing in the DB pointing to it. That's an orphaned file and a data retention (GDPR) issue.
- Fix: Send deletes through a server endpoint that uses the service role after an authorisation check, and check how many items `remove()` actually returned. Or keep uploads immutable and replace delete with a soft-hide flag.

### [LOW] POD-18: The POD share and email access check ignores role and company-admin scope
- File: app/api/pod/share/route.ts:60-100, app/api/pod/share/email/route.ts:60-99
- Verdict: PLAUSIBLE
- Problem: `userHasTenantAccess` accepts either the profile tenant or any membership row, whatever the role, and doesn't use `can_access_tenant`. As a result:
  - A driver-role member can create share links and send emails.
  - A company admin with no explicit membership row for a sibling tenant is refused, even though RLS would let them in.
- Fix: Use a shared server-side access helper that calls `can_access_tenant` through an RPC and enforces allowed roles (admin, staff, super_admin).

### [LOW] POD-19: Creating a load manifest has no role check, no job status check, and no check across manifests
- File: app/api/load-manifests/route.ts:59-120, supabase/migrations/20260902140000_load_manifests.sql:51-56, 293-310
- Verdict: CONFIRMED
- Problem:
  - Any tenant member, including drivers, can create manifests.
  - The RPC doesn't check job status, so completed or cancelled jobs can go on a manifest.
  - The same serial can go on any number of manifests, because uniqueness is only enforced within one manifest.
  - In the "All tenants" view, MasterLoadBuilder leaves out x-tenant-id (app/jobs/MasterLoadBuilder.tsx:328-335). requireTenant then falls back to the profile tenant, and the RPC fails with an ownership error instead of a clear message.
- Failure scenario: The same box appears on two open manifests, so loaded and unloaded counts are doubled.
- Fix: Require admin or staff. Reject jobs that aren't in an active status. Optionally add a partial unique index on (job_item_id, serial_number) across manifests that haven't been unloaded yet (SQL migration). Make the builder send an explicit tenant.

### [LOW] POD-20: Barcode scans count for the whole job but are saved against whichever stop card was used
- File: app/api/driver/jobs/[jobId]/stops/[stopId]/scans/route.ts:197-341, app/driver/jobs/[jobId]/page.tsx:547-553
- Verdict: CONFIRMED
- Problem: The verification widget appears on every stop, including collections. Dedupe is keyed on job, item and serial, and the saved stop_id is whichever stop card the driver happened to scan from. Scans don't distinguish collection from delivery.
- Failure scenario: Items scanned at collection count as verified for delivery. On multi-drop jobs, per-stop reports of what was delivered where are meaningless.
- Fix: Decide what the model should be. If scans are meant to be per stop, add stop_id (and the scan purpose) to the unique index and the progress calculation.

### [LOW] POD-21: The driver dashboard works out "today" in UTC
- File: app/driver/dashboard/page.tsx:89, app/api/driver/me/route.ts:16-24
- Verdict: CONFIRMED
- Problem: `new Date().toISOString().slice(0,10)` gives the UTC date, so during BST the dashboard shows yesterday's jobs between 00:00 and 01:00 local time. The API also returns only 100 jobs ordered by `job_date desc`, while the dashboard filters on `scheduled_date ?? job_date`. Jobs dated far in the future can push today's jobs out of the 100.
- Failure scenario: A night-trunk driver starting at 00:30 sees an empty or wrong job list.
- Fix: Get the local date from the tenant timezone helper in lib/time.ts, and filter by date on the server.

### [LOW] POD-22: A user with more than one active driver link gets a 500 on every driver route
- File: lib/driver/server.ts:53-66, 76-86, 99-109
- Verdict: PLAUSIBLE
- Problem: `maybeSingle()` on driver_users, subcontractor_users and subcontractor_drivers throws when it finds two active rows, and every driver route turns that into a generic 500. Nothing in the repo adds a unique constraint to prevent it.
- Failure scenario: A driver who works for two tenants, or who was invited twice, is locked out of the driver app with "Unable to process driver request."
- Fix: Add partial unique indexes on active links (SQL migration), or let the driver choose which context to use.

### [LOW] POD-23: Deleting a planned job orphans any POD files already uploaded, and there's no role check
- File: app/api/jobs/[jobId]/route.ts:14-131
- Verdict: PLAUSIBLE
- Problem: Planned jobs can already have pod_evidence, because uploads are allowed before completion. Deleting the job removes the rows (if the FK cascades) but never deletes the storage objects. Any member, including drivers, can delete planned or pending jobs.
- Fix: Refuse the delete when pod_evidence or job_item_scans rows exist, or clean up storage on the server. Restrict deletes to admin and staff.

### [LOW] POD-24: Debug UI and logging left on the drivers page
- File: app/drivers/page.tsx:658-720
- Verdict: CONFIRMED
- Problem: Vehicle assignment writes "CLICK RECEIVED / CALLING RPC" debug text, including tenant ids, into UI state. It also calls `window.alert` and logs RPC responses to the console.
- Fix: Remove the debug state, alerts and console logs before opening signup.

### [LOW] POD-25: The public PDF route returns raw error text, and share tokens expose internal ids
- File: app/api/pod/share/[token]/pdf/route.ts:60-71, lib/pod/shareToken.ts:26-31
- Verdict: CONFIRMED
- Problem: The public PDF route returns the raw `error.message`, which can include Supabase error text such as "Unable to sign POD evidence: ...". The token payload is plain base64url JSON, so anyone holding the link can read the tenantId and jobId. They aren't secrets, but internal ids end up in customer mailboxes and chat apps.
- Fix: Return a generic message from the public route and log the detail on the server. Consider an opaque random token backed by the table proposed in POD-9.

---

# Review 08: planning, routing, tracking, telematics, tachograph, compliance regimes

Reviewer scope: lib/planning/**, app/planning/**, lib/tomtom/**, app/api/tomtom/**, lib/tracking/**, app/tracking/**,
app/telematics/**, lib/telematics/**, app/tachograph/**, app/api/tachograph/**, lib/tachograph/**, lib/compliance/**,
lib/time.ts, planning/tachograph/telematics migrations. Read-only. Nothing touched Supabase or TomTom.

Verification method: code traced by hand. The rule-logic findings were also run through the real modules in a scratch vitest
file outside the repo (scratchpad/verify/verify.test.ts, synthetic inputs, no network). Results are quoted where used.
`npx vitest run lib/planning/driverSchedule.test.ts` passes (23/23); the existing tests do not cover the gaps below.

Regulation references used: Regulation (EC) 561/2006 as assimilated into GB law ("assimilated rules"): Art 6 (9h daily
driving, 10h twice a week, 56h weekly, 90h fortnightly), Art 7 (45 min break after 4.5h, or 15 + 30 split), Art 8(2)
(daily rest must be completed within 24h of the end of the previous daily or weekly rest), Art 8(4) (max 3 reduced daily
rests between weekly rests), Art 8(6) (weekly rest must start no later than the end of six 24h periods after the previous
weekly rest; regular 45h, reduced 24h with compensation), Art 9 (ferry/train interruptions). Road Transport (Working
Time) Regulations 2005 (RTWTR): 6h work then 30 min break, over 9h then 45 min; 60h max in a week; 48h average over the
reference period; 10h night-work limit. DVSA guidance: a "week" is Monday 00:00 to Sunday 24:00.

## Status of the three known gaps

1. **company_profiles.timezone ignored everywhere: PARTIALLY FIXED, but still effectively ignored in most cases.** Planning
   (app/planning/page.tsx:288-293, 360-367) and Tachograph (app/tachograph/page.tsx:195-230) now read it. But both query
   it through `tenant.filterByTenant`, which adds `tenant_id = <active tenant id>`. `company_profiles.tenant_id` holds the
   COMPANY id (docs/sql/rls_04_identity_tables.sql:27). So when an admin picks a specific tenant, or a staff user's home
   tenant id differs from the company id, no row comes back and both pages quietly fall back to Europe/London. Tracking
   (app/tracking/page.tsx:19,35,186), lib/tracking/journey.ts, lib/tracking/onTheRoad.ts and lib/compliance/expiry.ts
   still hard-code London or the browser zone. See PLAN-10.
2. **Nothing writes vehicle_locations / telematics_positions: NO LONGER TRUE for telematics_positions.**
   app/api/driver/location/route.ts:54-64 inserts driver phone GPS into telematics_positions using the service role.
   vehicle_locations is still never written. The comments in lib/tracking/supabasePositions.ts:7-10, 25-27 and
   lib/tracking/position.ts:5-7, 39-43 claiming nothing writes these tables are now stale, and the "harmless" limits they
   describe are now live. See PLAN-14.
3. **Tachograph page white-screens on an unvalidated timezone: STILL TRUE.** See PLAN-9.

---

### [CRITICAL] PLAN-1: Lane "Wizard check ready" ignores the driver's recorded hours and claims breaks/WTD are "calculated"
- File: lib/planning/compliance.ts:35, 116-136; app/planning/page.tsx:2124-2150; app/planning/VehicleLane.tsx:140-178
- Verdict: CONFIRMED (scratch run D: 4.4h planned driving + complete activity data returns `ok`, "Wizard check ready", no warnings)
- Problem: `evaluatePlanningCompliance` takes activity history only as a boolean `activityDataAvailable`. Its only
  hours rule is "total planned route time > 4h30 means review". It never looks at `DriverHoursState`: continuous
  driving so far, daily driving since the last rest, weekly 56h, fortnightly 90h, or working time. When the history is
  "complete" the lane chip reads "Wizard: Wizard check ready", "Actual drive available", "Break due calculated" and
  "WTD calculated". None of those values is calculated anywhere.
- Failure scenario: a driver has already driven 8h since their last daily rest (or 55h this week, or 4h without a
  break). The planner gives them a 4h lane. The lane shows the neutral "Wizard check ready" with no warning. The plan
  breaks Art 6(1) daily or 6(2) weekly limits. The planning-health tile counts 0 warnings.
- Fix: pass the `DriverHoursState` in. Warn when `plannedDrivingSeconds` exceeds
  `min(standardDailyDrivingRemaining, weeklyRemaining, fortnightRemaining)`, and when continuous remaining is shorter
  than the first drive. Include the van to Drop 1 leg. Remove the "Break due calculated" and "WTD calculated" labels, or
  compute them. Rename "Wizard check ready" to wording that makes no compliance claim.

### [CRITICAL] PLAN-2: Driving done earlier today is dropped when planning the rest of today
- File: app/planning/page.tsx:1841-1882 (`.lt("start_time", planningStart)`); lib/planning/driverHoursState.ts:171-176; lib/planning/planningDriverActivity.ts:273-303
- Verdict: CONFIRMED (scratch run C: rest to 06:00 BST, then 4.5h drive, 45m break and 4h drive, planningStart 06:00. Result: `complete: true`, dailyDriving 0, 9h standard remaining)
- Problem: `planningStart` is the selected date at the driver's `normal_start_time`, not "now". The history query and
  `normalizeActivities` throw away every activity that starts at or after `planningStart`. The effect only nulls the
  state when `planningStart` is in the future, so re-planning today at 15:00 for a 06:00-start driver uses history up to
  06:00 only.
- Failure scenario: at 15:00 a planner adds afternoon work for a driver who has already done 8.5h. The state says 0h
  driven, 9h available, `complete: true`. The lane shows "Wizard check ready" (PLAN-1). The schedule preview plans a
  fresh 4.5h block without a break, putting the driver at 13h daily driving.
- Fix: when the planning date is today and now is after `planningStart`, use `max(planningStart, now)` as both the
  history cut-off and the schedule start. Rebase the ETAs on that instant.

### [HIGH] PLAN-3: The scheduler has no 24h daily-rest window: 40h duty days with no rest pass
- File: lib/planning/planningDriverSchedule.ts:77-96 (`maxDutyWindowSeconds: null`); lib/planning/driverSchedule.ts:273-283, 784-842
- Verdict: CONFIRMED (scratch run A: 200 drops, 2 min apart, 10 min service each. One "day" spans 40.75h with 0 daily rests; status `review_required`, not `unschedulable`)
- Problem: a daily rest is only inserted when the next drive would break the 9h daily driving limit. With
  `maxDutyWindowSeconds` null, `dutyWouldExceed` always returns false, so service, loading and other work never trigger
  a rest. Art 8(2) requires the 11h (or 9h reduced) daily rest to be completed within 24h of the end of the previous
  rest, whatever the driving total.
- Failure scenario: a multi-drop urban route with short legs and many 10-minute services produces ETAs running through
  the night and into the next afternoon with no rest. The ETA table presents it as a working schedule. The only caveat is
  the generic "rule profile is not verified" warning.
- Fix: model the 24h window in the scheduler. Rest must end by `restEnd + 24h`, so insert the daily rest when
  `now + nextBlock + dailyRest > dutyStart + 24h`. Set `maxDutyWindowSeconds` to 13h (24h minus 11h) in the advisory
  assimilated profile, and account for the 9h reduced option. Treat an unschedulable window as `unschedulable`.

### [HIGH] PLAN-4: Weekly rest and the six 24-hour period rule are not modelled anywhere
- File: lib/planning/driverSchedule.ts (whole file: no weekly-rest event kind); lib/planning/driverHoursState.ts:366-400, 474-480
- Verdict: CONFIRMED by code (scratch run B: a 7-day tramper plan whose longest rest is 11h; it only stops at the 56h driving cap)
- Problem: the only weekly limit is the 56h/90h driving cap. There is no `weekly_rest` event and no tracking of time
  since the last weekly rest (Art 8(6)). There is no reduced-weekly-rest compensation, and no check that
  reduced daily rests are at most 3 between weekly rests (the history only warns; the scheduler always plans 11h rests
  and never resets). The history builder counts any rest of 24h to 45h as a regular daily rest. It resets the
  reduced-rest counter only on a 45h+ rest, so a legal 24h reduced weekly rest leaves the counter running and gives false
  "more than three reduced rests" warnings.
- Failure scenario: a driver who finished their weekly rest 5 days ago (not tracked) is given a 3-day tramper plan with
  daily 11h rests only. The schedule runs past the end of the sixth 24h period with no weekly rest.
- Fix: add "time since last weekly rest" to `DriverHoursState`, with a rest of 24h or more counting as weekly. Add a
  weekly rest event to the scheduler (45h, or 24h reduced with compensation tracking). Fix the rest classification
  thresholds.

### [HIGH] PLAN-5: Driving times come from car routing without traffic, so HGV driving is systematically underestimated
- File: lib/tomtom/api.ts:27-30 (`travelMode=car&traffic=false`), :91 (matrix `travelMode: "car"`); consumed by lib/planning/compliance.ts:116-123 and lib/planning/planningDriverSchedule.ts
- Verdict: CONFIRMED (parameters are hard-coded; the size of the error depends on the route)
- Problem: HGVs over 7.5t are limited to 56mph on motorways (by speed limiter and law) and lower on single carriageways,
  while car routing assumes 70mph. The planned driving total, the 4h30 review threshold, break placement and every drop
  ETA use car times. There are also no vehicle dimension or weight restrictions, so the route geometry can pass under
  low bridges or through weight-restricted roads.
- Failure scenario: a leg TomTom prices at 4h15 by car takes 5h+ in a 44t artic. The plan shows no break before the
  drop and "Wizard check ready", but the driver must break before arriving. That is an Art 7 breach if they follow the
  plan, and every later ETA slips.
- Fix: use `travelMode=truck` with `vehicleMaxSpeed`, `vehicleWeight`, `vehicleLength`, `vehicleHeight` and
  `vehicleCommercial=true` from vehicle data (mam_kg is already stored). Use traffic-aware times for same-day plans. Until
  then, apply a conservative multiplier and label the times as car estimates.

### [HIGH] PLAN-6: Working Time rules are not modelled, yet the UI implies they are
- File: lib/planning/driverSchedule.ts (service time only increments `serviceSeconds`); app/planning/VehicleLane.tsx:167-172; app/planning/page.tsx:2305-2309
- Verdict: CONFIRMED
- Problem: RTWTR is not implemented at all: the 30 min break after 6h of work, 45 min over 9h, 60h weekly working
  time, the 48h average and the 10h night-work limit. `currentWeekWorkingSeconds` is computed in driverHoursState but
  nothing reads it. Service time (other work) never triggers a break, so a 5h drive plus 2h of loading, with the 561 break
  taken, passes. So does 4h20 of driving plus 3h of multi-drop service with no break: that meets 561 but breaks RTWTR.
- Failure scenario: dense multi-drop days with short legs are planned with no break for 8h or more of work.
- Fix: track cumulative working time (driving plus other work) since the last break of 15 min or more in the scheduler,
  and insert WTD breaks. Surface weekly working time from the history state.

### [HIGH] PLAN-7: Autosave retries forever, every ~1.2s, when a save keeps failing
- File: app/planning/page.tsx:1518-1596 (effect deps include `saving`), 1275-1510
- Verdict: CONFIRMED by trace
- Problem: `persistPlan` sets `saving` true, then false in `finally`. `saving` is a dependency of the autosave effect.
  After a failure, `hasUnsavedWork` is still true, so the effect re-runs, overwrites the "local-only" status with
  "pending", and schedules another `persistPlan` 1.2s later. Nothing backs off and nothing stops it.
- Failure scenario: any persistent error (the itinerary RPC rejecting a job, offline or flaky network, an RLS denial, a
  migration not applied in one environment, an expired session) sends every pending job update plus every RPC to
  Supabase roughly once a second for as long as the tab is open. With a 350-job lane that is hundreds of PATCH
  requests a second from one browser. The error banner flickers and "Changes are kept locally" is never stable.
- Fix: keep a failure counter or ref. Do not re-arm autosave after a failure until the user edits again (key the timer
  on `pendingUpdatesJson` changing since the failed snapshot), or use exponential backoff. Remove `saving` from the
  deps and gate on `saveInFlight.current` instead.

### [HIGH] PLAN-8: With admin "All tenants" active, Save writes jobs and then always errors; lanes can mix tenants
- File: app/planning/page.tsx:1311-1337, 482-556, 1518-1525
- Verdict: CONFIRMED for the save path; PLAUSIBLE for cross-tenant vehicle references (no DB guard found in docs/sql)
- Problem: admins default to `activeTenantId = null` ("All tenants", lib/tenant/context.ts:86-95). In that mode:
  (a) autosave never runs (it requires a string tenant id);
  (b) manual Save runs every `jobs` update first, then hits `if (!activeTenantId) throw "active tenant is unavailable"`.
  The writes have landed, but the baseline is not advanced, the status shows "local-only" and an error, and the next
  click writes the same updates again;
  (c) canonical itineraries are never loaded or saved;
  (d) the board lists vehicles and jobs from every tenant together, so a tenant-A job can be dropped onto a tenant-B
  lane. The update writes `jobs.vehicle_id` / `driver_id` pointing at the other tenant's vehicle and driver. RLS on jobs
  only checks the job row's own tenant.
- Failure scenario: a company admin plans on the default view, sees "Save error: active tenant is unavailable" on every
  save, and believes nothing saved. Worse, they assign another tenant's vehicle to a job, which then shows up in
  tracking and driver views across the tenant boundary.
- Fix: block planning (or at least editing) until a specific tenant is selected, as the tachograph page already does
  with `writeTenantId`. Server side, add a trigger or check that `jobs.vehicle_id` and `jobs.driver_id` belong to
  `jobs.tenant_id` (needs a SQL migration).

### [HIGH] PLAN-9: Tachograph page crashes on an invalid company timezone (known gap, still present)
- File: app/tachograph/page.tsx:222-230 (no `isValidIanaTimeZone`), 104-116 (`formatStamp`), render at about line 1008-1016, `localParts` 71-102
- Verdict: CONFIRMED
- Problem: whatever string `company_profiles.timezone` holds goes straight into `setTimeZone`. `Intl.DateTimeFormat`
  throws a RangeError for an invalid IANA zone, and `formatStamp` is called during render for every activity row. With
  no error boundary the page unmounts and shows a white screen. The planning page validates the same value
  (page.tsx:364-367); this page does not.
- Failure scenario: a timezone of "GMT+1", "London", "BST" or "" typed into company settings takes out the whole
  tachograph page for that company as soon as any activity row exists.
- Fix: `profileTimeZone && isValidIanaTimeZone(profileTimeZone) ? profileTimeZone : OPERATOR_TIME_ZONE`. Also validate
  the timezone when it is saved in settings. Consider a DB CHECK using `pg_timezone_names` (migration).

### [MEDIUM] PLAN-10: Timezone lookup filters a company-keyed table by tenant id; super_admin "All" breaks the planning load
- File: app/planning/page.tsx:288-293, 351-355; app/tachograph/page.tsx:195-204; docs/sql/rls_04_identity_tables.sql:27-30
- Verdict: CONFIRMED (silent London fallback); PLAUSIBLE (super_admin failure depends on company count)
- Problem: `company_profiles.tenant_id` is the company id, but `filterByTenant` adds the active tenant id. With a
  specific tenant active, no row is found and London is used silently. With super_admin and "All", RLS returns every
  company's profile, `.maybeSingle()` errors with multiple rows, and planning aborts with "Company profile load error"
  before loading any jobs.
- Failure scenario: a Republic of Ireland or EU-based operator sets Europe/Dublin or Europe/Paris and still gets London
  day boundaries, week starts and planning start times, off by one hour in CET. A super_admin cannot open Planning at
  all in "All tenants".
- Fix: resolve the company id from the tenant (`tenants.company_id`) and query `company_profiles` by that, not through
  `filterByTenant`.

### [MEDIUM] PLAN-11: Two planners, or one planner and a stale draft, silently overwrite each other; saves are not atomic
- File: app/planning/page.tsx:1311-1327 (sequential per-job updates, no version check), 1598-1611 (`restoreRecoveryDraft`); lib/planning/saveDiff.ts:26-59
- Verdict: CONFIRMED by trace
- Problem: the diff is computed against the jobs this tab loaded. Updates are unconditional last-write-wins with no
  `updated_at` or version predicate, and are sent one by one, so a failure part-way leaves a half-saved plan. The local
  draft (kept for up to 7 days) is offered on reload. If it does not match the server plan it can be restored and
  autosaved over newer server state, and restore invalidates the canonical itineraries.
- Failure scenario: planner A moves job X to van 1 while planner B (loaded earlier) reorders van 2, which still includes
  X. B's autosave moves X back to van 2 with a clashing route_order and neither is warned. Or yesterday's unsaved draft
  is restored after dispatch has already replanned.
- Fix: send the whole plan through one RPC with an expected `updated_at` per job (optimistic concurrency), rejecting on
  mismatch. Warn before restoring a draft older than the last server change. Subscribe to realtime changes, or re-check
  before saving.

### [MEDIUM] PLAN-12: Smart Optimize beam search blocks the browser main thread for more than 10 seconds
- File: lib/planning/fastPlot.ts:293, 303, 570-618, 639-727, 735-828
- Verdict: CONFIRMED (scratch run F: 30 two-stop jobs (60 visits), synthetic zero-latency cost loader: 14.4s of pure CPU in Node)
- Problem: each candidate expansion computes `remainingCostLowerBound`, which is O(r^2), and runs `visits.filter`. Per
  depth that is beam (96) x candidates x r^2, so the whole search is roughly O(W n^4). Every search depth sorts up to
  5,760 states. It all runs synchronously on the UI thread up to the 60-visit threshold.
- Failure scenario: optimizing a 30-job two-stop lane freezes the planning page for 15s or more (longer on low-end
  laptops). The browser may show "page unresponsive", and autosave and position polling stall.
- Fix: precompute each visit's minimum outgoing edge once per search, which makes the bound O(r) per candidate. Maintain
  it incrementally. Move the optimizer into a Web Worker. Lower the complete-matrix threshold.

### [MEDIUM] PLAN-13: Geocoding burns TomTom quota: failures are never cached and tracking retries them every 30s
- File: app/tracking/page.tsx:41-134, 257-266 (geocodes inside every poll); app/planning/page.tsx:612-646; app/api/tomtom/geocode/route.ts:184-500; lib/tomtom/server.ts:335-376
- Verdict: CONFIRMED
- Problem: a stop that does not geocode keeps lat/lng null and no failure marker is stored. The tracking page calls
  `/api/tomtom/geocode` for every null stop on every 30-second poll. Planning re-geocodes on every load. One geocode
  request can carry 100 stop ids, and each stop can make up to about 5 TomTom calls (full query, address variants,
  postcode) plus a postcodes.io call. The rate limiter counts incoming requests (60 a minute per user, per serverless
  instance), not upstream calls, so one user can cause thousands of billable TomTom calls a minute. Customer postcodes
  are also sent to a third party (postcodes.io) that the privacy documentation may not mention.
- Failure scenario: 20 bad addresses in today's tracking rail equal about 100 or more TomTom calls every 30s per open
  dispatcher tab, all day.
- Fix: store `geocode_failed_at` / `geocode_attempts` on job_stops and skip retries for N hours (migration). Remove
  geocoding from the tracking poll. Rate-limit on upstream calls. Disclose postcodes.io as a data processor.

### [MEDIUM] PLAN-14: Position reads now meet real GPS writes: fleet-wide row budget starves vehicles; the either-or fallback hides vehicles
- File: lib/tracking/supabasePositions.ts:29, 94-131; app/api/driver/location/route.ts:54-64
- Verdict: CONFIRMED (the write path exists; starvation depends on ping frequency)
- Problem: the read limit is `vehicleIds.length * 5` rows across the whole fleet, ordered by time. One phone posting
  every few seconds fills the budget, and every other vehicle shows "No GPS". Planning's Smart Optimize and driver-hours
  preview both refuse to run without a position for the selected vehicle (page.tsx:1650-1661, 2005-2016). The
  vehicle_locations fallback is only consulted when telematics returns zero rows. The code comments call all of this
  "harmless while nothing writes these tables", which is no longer true.
- Failure scenario: two drivers with the app open post every 5s. A 20-vehicle fleet's budget of 100 rows covers about
  4 minutes of their pings. The other 18 vans show no GPS and cannot be optimized.
- Fix: add a `DISTINCT ON (vehicle_id)` RPC or a `latest_vehicle_position` view (migration), and merge both tables per
  vehicle. Update the stale comments.

### [MEDIUM] PLAN-15: Tachograph admin gate checks memberships.role; the UI checks profile role
- File: lib/tachograph/serverAuth.ts:17-50; supabase/migrations/20260911131500_tachograph_activity_ledger.sql:114-122, 226-234; app/tachograph/page.tsx:180-182
- Verdict: PLAUSIBLE (depends on whether company admins and super_admins have a memberships row with role admin for every tenant)
- Problem: `canEdit` uses `tenant.role` (profile role), but the API and both RPCs require a `memberships` row with role
  admin or super_admin for that exact tenant. A company-wide admin (CLAUDE.md: admin covers all tenants under the
  company) or a super_admin with no per-tenant membership row sees the edit form and gets 403. The `can_manage_tenant`
  helper, which is the documented admin predicate, is not used.
- Failure scenario: a company admin cannot record manual driver activity on a sub-tenant, so hours data stays
  incomplete for planning.
- Fix: use `public.can_manage_tenant(p_tenant_id)` in the RPCs and a matching check in the route (migration for the RPC
  bodies).

### [MEDIUM] PLAN-16: Tracking uses scheduled_date only, while Planning uses planning_date
- File: lib/tracking/onTheRoad.ts:54-78; app/tracking/page.tsx:211-213; app/planning/page.tsx:311-313; app/jobs/page.tsx:452
- Verdict: CONFIRMED
- Problem: jobs can be moved to a different planning day (`planning_date`), and Planning honours that. Tracking's "on
  the road", "Due today" and "Late" logic and its server filter use only `scheduled_date`.
- Failure scenario: a job scheduled Monday and re-planned to Wednesday shows as "Late" in tracking on Tuesday. A job
  pulled forward from Friday to today never appears on today's rail.
- Fix: use `coalesce(planning_date, scheduled_date)` in both the query and `isOnTheRoad` / `jobPhase`.

### [LOW] PLAN-17: Driver-hours week boundaries use London local time, not the fixed UTC week tachographs record
- File: lib/planning/planningDriverActivity.ts:330-381
- Verdict: PLAUSIBLE (legal interpretation; DVSA/tacho analysis software works on UTC days and weeks)
- Problem: week start is Monday 00:00 in the operator zone. During BST that is Sunday 23:00 UTC, so one hour of driving
  can be counted in a different week from the tachograph analysis. Near the 56h/90h limits, the planner and the
  enforcement report disagree.
- Fix: compute week and fortnight buckets in UTC, as the digital tachograph does, or document the choice and add a
  1h safety margin.

### [LOW] PLAN-18: Ferry/train (Art 9) interruptions are not handled
- File: lib/planning/activity.ts:77-99 (validation helper only); lib/planning/driverHoursState.ts:366-410
- Verdict: CONFIRMED
- Problem: a daily rest interrupted by ferry boarding and disembarking (allowed twice, max 1h total) is recorded as
  several shorter rests. None reaches 9h or 11h, so the history shows no rest boundary. This is conservative (it gives
  "incomplete"), but UK-EU drivers on ferries will always come out incomplete.
- Fix: merge rest segments separated by an Art 9 interruption before classifying them.

### [LOW] PLAN-19: getCompliance reports "VALID" for any expiry that is not a bare date
- File: lib/compliance/expiry.ts:41-72
- Verdict: CONFIRMED for the function (scratch run E); PLAUSIBLE for impact (depends on column types and inputs)
- Problem: `new Date(`${expiry}T00:00:00`)` is Invalid Date for a timestamp or garbage string. `days` is NaN, every
  comparison is false, and the result is `{level:"ok", label:"VALID • NaNd"}`. The DST off-by-one already noted in the
  file is also still there.
- Fix: validate `^\d{4}-\d{2}-\d{2}$` (or slice the first 10 characters), return amber "DATE INVALID" on NaN, and
  compare calendar-day strings as lib/planning/compliance.ts does.

### [LOW] PLAN-20: DST start-day start times give a misleading "set a valid normal start time"
- File: lib/planning/planningDriverActivity.ts:193-264, 273-303; app/planning/page.tsx:1971-1982
- Verdict: CONFIRMED
- Problem: a 01:00 to 01:59 `normal_start_time` on the last Sunday of March does not exist in London. The function
  returns null, and the UI blames the driver profile.
- Fix: roll a gap time forward to the first valid instant, or show a DST-specific message.

### [LOW] PLAN-21: Garbled "?" separators in user-facing strings
- File: app/planning/VehicleLane.tsx:181, 187 (`join(" ? ")`); lib/tachograph/manualActivity.ts:46, 50 ("Tacho file ? provider"); app/telematics/page.tsx:605
- Verdict: CONFIRMED (a literal "?" in source; other files in the same output render "·" and "•" correctly)
- Problem: an encoding accident, probably a replaced separator glyph. Warnings render as "Tachograph card expired ? Driver CPC expired".
- Fix: replace with " · " or "; ".

### [LOW] PLAN-22: Tachograph routes return raw database and internal error text to the client
- File: app/api/tachograph/activity/route.ts:112-133, 200-217; app/api/tachograph/sync/route.ts:330-356; lib/tachograph/serverAuth.ts:28-31
- Verdict: CONFIRMED
- Problem: `error.message` from Postgres, from the service-role membership lookup, and from provider `testConnection()`
  is returned verbatim. The TomTom routes deliberately use constant messages for this reason.
- Fix: map known RPC exceptions to friendly messages, log the rest and return a constant.

### [LOW] PLAN-23: Itinerary RPC does not check the job's planning date; job edits silently empty itineraries
- File: supabase/migrations/20260908050000_planning_route_itineraries.sql:404-420, 84-87; lib/planning/itineraryPersistence.ts (parser skips visits with no services)
- Verdict: CONFIRMED
- Problem: `replace_planning_route_itinerary` checks tenant, vehicle and stop ownership, but not that the job's
  `coalesce(planning_date, scheduled_date) = p_planning_date`, so a crafted call can put another day's job into today's
  itinerary. Separately, app/jobs deletes and reinserts stops on every edit (per 20260819_planning.sql comment). The
  `on delete cascade` then removes service rows, leaving visits with no services that the parser skips. The canonical
  route quietly loses drops until Smart Optimize is re-run.
- Fix: add the date predicate to the RPC (migration). Invalidate the itinerary when a job's stops change (a trigger, or
  an explicit call from the jobs page).

### [LOW] PLAN-24: Driver-hours preview for a future date starts from the van's current position
- File: app/planning/page.tsx:2005-2044
- Verdict: CONFIRMED
- Problem: Drop 1 travel is measured from the last GPS fix now, but ETAs are anchored to the driver's normal start time
  on the selected date. For tomorrow's plan, the van's overnight location is unknown.
- Fix: use the depot or base, or the previous day's final drop, for future dates, and label the assumption.

### [LOW] PLAN-25: TomTom rate limiter is in memory per serverless instance
- File: lib/tomtom/server.ts:325-376
- Verdict: CONFIRMED (the code comment acknowledges it)
- Problem: each Vercel instance has its own map, so the effective limit scales with concurrency and resets on every cold
  start. Together with PLAN-13 there is no real ceiling on TomTom spend.
- Fix: use a shared store (Upstash/Redis or a Supabase table), and set a TomTom-side quota alert.

---

## Checked and found sound (no finding)
- TomTom key: server-only (`process.env.TOMTOM_API_KEY`), never sent to the client. Fetch errors are logged, not
  echoed. All three routes require a session plus `get_my_company_id()`, which excludes portal drivers and
  subcontractors. Coordinates are range-checked. URLs are fixed to api.tomtom.com with encoded components (no SSRF, no
  open proxy). Point, stop and cell counts are capped.
- `driver_activity_logs` client insert/update/delete is revoked (rls_05), so the manual-activity RPCs are the only write
  path, and imported rows cannot be edited from the client.
- The itinerary RPC validates tenant, vehicle, driver, job and stop ownership, fixes service time at 600s, validates
  coordinates and serialises replacement per vehicle and date.
- Break rule (45 min, or 15 then 30) and the 4.5h continuous check in driverHoursState match Art 7. `planDrive` inserts
  the break before any leg that would pass 4.5h, and rejects single legs over 4.5h.
- Regime classifier: the GB domestic 3.5t split, and the UK-EU 2.5t to 3.5t international light goods rule (in force
  from 1 July 2026), are correct. Missing facts lead to "unknown" with review required, and the driver-hours preview
  refuses anything but a single, fully classified assimilated lane.
- The planning load uses a generation counter to cancel stale loads. The polling intervals clean up and pause on hidden
  tabs. @supabase/ssr 0.9.0 `createBrowserClient` is a browser singleton, so `supabase` in effect deps does not loop.
- The telematics_positions write stores `toISOString()` (UTC) into a naive timestamp, which matches
  `normaliseTimestamp`'s assumption that it is UTC.

---

# Review 09: settings, fleet/compliance, dashboard/stats, tenancy client, nav/theme/layout, landing, dependencies

Scope read in full or traced: app/settings/** (company, users, permissions, documents, invoices, licences), app/api/settings/** (users/invite, users/[userId], documents, documents/logo, portal-invites, stripe connect/status auth), lib/accounts/server.ts + authz.ts (auth helper used by settings routes), lib/tenant/**, app/components/**, app/vehicles/**, app/maintenance/page.tsx, app/assets/page.tsx, app/stats/page.tsx, app/dashboard/page.tsx, lib/dashboard/aggregate.ts, lib/nav/**, lib/loading/**, lib/theme/**, app/layout.tsx, app/page.tsx, components/landing/**, package.json + `npm audit --omit=dev`. SQL cross-checked: rls_02, rls_04, rls_04b, rls_06, rls_07, rls_08, profiles_privileged_columns_guard, billing_03, billing_07.

Counts: CRITICAL 0, HIGH 5, MEDIUM 10, LOW 12.

---

### [HIGH] SET-1: /settings/company and the documents API key company_profiles by TENANT id, but the table is keyed by COMPANY id
- File: app/settings/company/page.tsx:208-210, 256-260, 313-318, 429, 461-465; app/api/settings/documents/route.ts:70-92; policy docs/sql/rls_04_identity_tables.sql:27-38
- Verdict: CONFIRMED (known bug, still present)
- Problem: rls_04 states "company_profiles: tenant_id holds the COMPANY id", and its select/insert/update policies require `tenant_id = get_my_company_id()`. app/api/super-admin/companies/[id]/route.ts:88 agrees. The company page sets `companyId = writeTenantId ?? activeTenantId` (a tenant id) and both reads and upserts `company_profiles` with `tenant_id = <tenant id>`. rls_01b_reseed created fresh tenant ids per company, so tenant id != company id for every reseeded or newly provisioned company. The documents API does the same read with the tenant id through the service-role client.
- Failure scenario: a company admin opens /settings/company: select returns no row (RLS hides the real row), the form renders empty, and Save fails with "new row violates row-level security policy" (tenant_id != my company id). A super_admin saving succeeds and writes an orphan row keyed by a tenant id that nothing else reads. The documents API returns `companyProfile: null`, so document/quotation branding and headers lose company name, VAT and address. For a new self-service company this is the first settings screen they touch.
- Fix: resolve the company id (tenants.company_id for the active tenant, or `get_my_company_id()`), use it for read and upsert on the page and in documents/route.ts `loadSettings`. Put the resolution in a unit-tested lib/tenant helper. No migration needed; optionally a cleanup query for orphan rows whose tenant_id is a tenants.id.

### [HIGH] SET-2: Invited users are never given company_id or role_id, so get_tenant_context answers "no-tenant" and they are locked out
- File: app/api/settings/users/invite/route.ts:276-296 (profile insert/update), 311-338 (membership); app/api/settings/users/[userId]/route.ts:231-252; docs/sql/rls_07_tenant_context.sql:13-19
- Verdict: CONFIRMED in code (lockout depends on get_my_company_id() reading profiles.company_id, which the header of profiles_privileged_columns_guard.sql states it does)
- Problem: the invite inserts `profiles { id, tenant_id }` only. For a non-super, `get_tenant_context()` requires `tenants.company_id = get_my_company_id()`. With profiles.company_id null that never matches, so it returns `status: no-tenant`. role_id is also null, so even with a correct company_id every invitee would be "staff" whatever role was chosen. The PATCH route later syncs role_id (in one branch only) but never company_id. lib/superAdmin/users.ts:40-46 confirms invited users carry a null role_id in practice.
- Failure scenario: a new customer's admin invites a dispatcher. The dispatcher clicks the magic link and gets "Account not linked to a company" on every page, permanently, until a super admin edits their profile by hand. The same happens to an existing platform user whose profile tenant_id was null.
- Fix: in the invite route, look up `tenants.company_id` for tenantId and write `company_id` plus the `role_id` for the invited role, both on insert and in the `!existingProfile.tenant_id` update branch (the service role bypasses the guard). Make the writes one RPC/transaction so a failure cannot orphan an auth user. No migration strictly needed; an RPC would be cleaner.

### [HIGH] SET-3: Every settings API authorizes against the legacy `memberships` table, which RLS, tenant context and provisioning do not maintain
- File: lib/accounts/server.ts:49-88 (requireTenantAccess, used by documents, logo, stripe connect/status); app/api/settings/users/invite/route.ts:51-86; app/api/settings/users/[userId]/route.ts:13-72; app/api/settings/portal-invites/route.ts:52-71; docs/sql/rls_06_lock_secrets.sql:19-30
- Verdict: PLAUSIBLE (depends on which users have memberships rows in the live DB)
- Problem: rls_06 describes memberships as "a legacy user<->tenant table ... unused by the app ... slated for removal". The real role and tenant model is profiles.role_id + profiles.company_id + profiles.tenant_id (get_my_role, can_access_tenant, get_tenant_context). The only code that ever writes memberships is the invite route. So the service-role routes, which bypass RLS and so rely on this check as their ONLY gate, read a second source of truth that drifts from the real one.
- Failure scenarios:
  1. A company created by self-service signup or by a super admin has an admin profile but no memberships row. /settings/users, /settings/documents, logo upload, Stripe Connect and portal invites all answer 403 "You do not belong to the selected tenant", which blocks core onboarding.
  2. A company admin (profile role admin, which RLS treats as company-wide) has a membership in their home tenant only, so they cannot manage users or branding in sibling tenants that RLS says they manage.
  3. Offboarding: a super admin moves a user's profile to another company or downgrades their role_id, but the old `memberships.role = 'admin'` row survives. That user keeps service-role access to the old tenant's document settings, Stripe Connect, user invites (including inviting fresh accounts for themselves) and every accounts route that uses requireTenantAccess. A removed user keeps cross-tenant access.
- Fix: rebase requireTenantAccess / requireTenantAdmin on the profile model. Either call `can_access_tenant` / `can_manage_tenant` (or `get_tenant_context`) through the user-scoped client, or read the caller's profile + tenants.company_id with the admin client and apply the rls_02/rls_08 rules. Then stop writing memberships (or drop it per rls_06). Run an audit query first: `select m.* from memberships m join profiles p on p.id = m.user_id left join tenants t on t.id = m.tenant_id where t.company_id is distinct from p.company_id;`

### [HIGH] SET-4: Deleting a vehicle from /vehicles cascade-deletes paid-charge records
- File: app/vehicles/page.tsx deleteVehicle (about lines 527-545, `supabase.from("vehicles").delete().eq("id", id)`); docs/sql/billing_03_mid_cycle_charges.sql:147-171
- Verdict: CONFIRMED at schema level (the FK behaviour of vehicle_licences itself is not visible in repo SQL; PLAUSIBLE that it cascades too)
- Problem: `vehicle_cycle_coverage.vehicle_id` and `vehicle_addon_charges.vehicle_id` are `on delete cascade`, and an admin can delete a vehicle straight from the browser (vehicles_admin_all policy). billing_07 deliberately revoked DELETE on vehicle_licences to preserve invoice evidence, but deleting the vehicle goes around that.
- Failure scenario: a v1 company pays a pro-rata addon for a vehicle, then an admin deletes the vehicle (a typo, a re-entry). The addon charge row and the coverage row recording the card payment disappear, which destroys the audit trail and the idempotency record `chargeVehicleAddon` relies on. The re-created vehicle (new id) is charged again with no record that it was already paid for. Under v2, if vehicle_licences cascades, the vehicle disappears from the period's arrears invoice (under-billing), and billing_06 line 274 nulls period_invoice_lines.vehicle_id.
- Fix: replace hard delete with a soft delete (archived_at) for any vehicle that ever had a licence or coverage row, and route deletes through a server endpoint that refuses when billing rows exist. SQL migration: change those FKs to `on delete restrict`, or revoke DELETE on vehicles from authenticated and add a guarded RPC.

### [HIGH] SET-5: Vulnerable dependencies: next 16.2.10 (critical, incl. proxy bypass), sharp 0.34.5, postcss, nanoid
- File: package.json ("next": "^16.2.1", installed 16.2.10; sharp 0.34.5 transitive via next)
- Verdict: CONFIRMED (`npm audit --omit=dev`: 7 vulnerabilities, 1 critical, 4 high, 2 moderate)
- Problem: next <=16.3.2 has GHSA-6gpp-xcg3-4w24 "Middleware / Proxy bypass in App Router applications using Turbopack". Next 16 builds with Turbopack by default, and proxy.ts is the edge gate. The same range also has response-body cache confusion (GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q), Server Action DoS/SSRF, and image-optimizer RCE/DoS. sharp <=0.35.4-rc.0 has libvips/libheif CVEs (audit M8 is still open). postcss (bundled in next) and nanoid have high advisories with fixes available. lodash and uuid, pulled in by @tomtom-international/web-sdk-maps, have no fix.
- Failure scenario: the proxy bypass lets anonymous requests reach auth-gated pages and API handlers without the edge check, so any handler that assumes proxy.ts already turned anonymous callers away is left as the only line of defence. Cache confusion could serve one user's response body to another user on a shared cache key.
- Fix: `npm install next@latest` (>=16.3.3, or whatever version the advisory lists as patched), then `npm audit fix`, rebuild and typecheck. Confirm every API route still calls getUser() itself (most do). Track the tomtom lodash/uuid issue; that SDK runs client-side only, so the risk is low.

---

### [MEDIUM] SET-6: Re-inviting an existing member silently changes their role and bypasses the last-admin guard
- File: app/api/settings/users/invite/route.ts:311-323
- Verdict: CONFIRMED
- Problem: when a membership already exists, POST updates `memberships.role` to the invited role with no check. The PATCH route's "cannot demote the final administrator" guard is not applied, and profiles.role_id is not updated.
- Failure scenario: the only admin re-invites their own email (or a colleague's) as "driver". The tenant now has zero admin memberships, so every membership-gated settings route answers 403 for everyone (SET-3), and only a super admin can undo it. profiles.role_id still says admin, so RLS and the UI now disagree with the API.
- Fix: when the membership exists, return 409 "already a member, edit their role instead", or run the same last-admin check and role_id sync that PATCH does. Refuse self-invites.

### [MEDIUM] SET-7: Membership role and profiles.role_id drift apart after PATCH
- File: app/api/settings/users/[userId]/route.ts:218-252
- Verdict: PLAUSIBLE (depends on roles table contents and profile.tenant_id values)
- Problem: role_id is synced only when `profile.tenant_id === tenantId` AND a `roles` row with exactly the new role's name exists. `lib/tenant/context.ts` normalizes every role except admin/super_admin to staff, which suggests there may be no "driver" row. When the lookup misses, the membership says driver/staff but role_id stays admin.
- Failure scenario: an admin demotes a departing manager from admin to driver. The API accepts it and the users list shows "driver", but get_my_role() still returns admin, so RLS keeps giving them company-wide read and write over every tenant (vehicles, jobs, invoices, company_profiles).
- Fix: treat a missing roles row as an error (500, roll back the membership update), and sync role_id whenever the tenant belongs to the same company, whichever tenant the profile is homed in. Better still, drop memberships and make role_id the single role (SET-3).

### [MEDIUM] SET-8: Any tenant admin can attach any existing platform account to their tenant, edit that person's global profile, and enumerate registered emails
- File: app/api/settings/users/invite/route.ts:191-196, 334-343; app/api/settings/users/[userId]/route.ts:196-209; app/api/settings/portal-invites/route.ts:206-232, 316-331, 385-390
- Verdict: CONFIRMED
- Problem: `findAuthUserByEmail` matches any auth user on the platform. On a match, no invite is sent and no consent is asked: the user is simply added to the caller's tenant. The response text differs ("already had a TMS account"), which reveals whether any given email has an account. Once attached, PATCH updates that user's `profiles.full_name` and `phone` globally (profiles holds one row per person, not per tenant), even when their profile belongs to another company. portal-invites does the same through an admin-controlled driver/employee email, and silently repoints an existing driver_users/subcontractor_users link to another user id.
- Failure scenario: an admin at company A (a self-service signup, so anyone at all) probes competitor emails to learn who uses TMS Wizzard, adds company B's admin to tenant A as "driver", then renames them. B's admin shows up under the altered name in B's user list and in super-admin views. If SET-3 is later fixed through profiles, the attachment could turn into confusing access.
- Fix: for existing accounts outside the caller's company, send a consent invitation instead of attaching. Return one uniform message for both branches. Restrict PATCH profile edits to users whose profile.company_id matches the caller's company.

### [MEDIUM] SET-9: A tenant admin can rewrite the role of a super_admin member
- File: app/api/settings/users/[userId]/route.ts:139-167, 236-244
- Verdict: PLAUSIBLE (requires a super_admin to hold a membership in a customer tenant, e.g. for support access)
- Problem: ALLOWED_ROLES blocks assigning super_admin, but nothing blocks changing a target whose current role is super_admin. The route uses the service-role client, which `guard_profiles_privileged_columns` exempts, so if the super admin's profile.tenant_id is this tenant, their `profiles.role_id` gets rewritten to admin/staff.
- Failure scenario: the platform owner is added to a customer tenant for support, and that customer's admin edits them to "staff", which removes the platform's super admin role.
- Fix: return 403 when the target's membership role or profile role is super_admin, or whenever the target outranks a non-super caller.

### [MEDIUM] SET-10: There is no way to remove a user or revoke a page permission
- File: app/api/settings/users (no DELETE handler); app/settings/users/page.tsx; app/settings/permissions/page.tsx:82-97
- Verdict: CONFIRMED
- Problem: no endpoint deletes a membership, clears a profile's tenant/company, or disables the auth user, and permissions can only be upserted. Combined with SET-3, an offboarded employee keeps membership-based service-role access and RLS access until a super admin edits the DB.
- Failure scenario: a dismissed dispatcher keeps working magic-link access to jobs, customers and invoices.
- Fix: add DELETE /api/settings/users/[userId]: admin-only, protects the last admin, refuses self-deletion. It should remove the membership, null tenant_id/company_id/role_id, and end sessions (`auth.admin.signOut` or a ban). Add revoke to permissions.

### [MEDIUM] SET-11: Staff marking a vehicle VOR is rejected by the vehicles column guard, leaving half-saved state
- File: app/maintenance/page.tsx:399-435 (insert record then update vehicle), 626-635, 685-694; docs/sql/rls_04b_vehicles.sql:31-47
- Verdict: CONFIRMED (given rls_04b is applied)
- Problem: guard_vehicle_columns lets non-admins change only `active` and `updated_at`. VOR writes also set `vor`, `vor_since`, `vor_reason` and `returned_to_service_at`, so the trigger raises for staff. The page shows the VOR controls with no role check, and createRecord inserts the maintenance record before the vehicle update fails.
- Failure scenario: a workshop staff member logs a "vor" maintenance record. The record saves with status vor, but the vehicle stays active and roadworthy in planning, and the staff member sees "Maintenance record saved, but VOR update failed: Staff may change only vehicle status". A defective vehicle can still be dispatched.
- Fix: decide the policy. Either let staff change the VOR columns in the guard (`- 'vor' - 'vor_since' - 'vor_reason' - 'returned_to_service_at'`, SQL migration), since VOR is operational status, or hide the VOR actions from staff. Do the record insert and vehicle update in one RPC.

### [MEDIUM] SET-12: /stats totals are silently truncated at the PostgREST row cap, and it selects a vehicles column that may not exist
- File: app/stats/page.tsx:372-461 (jobs, invoices, vehicles, drivers, customers, licences with no limit/range), 474-508 (.limit(1000)), 419-431 (`billable`)
- Verdict: PLAUSIBLE (Supabase's default max-rows is 1000; `vehicles.billable` appears in no SQL file in the repo)
- Problem: jobs and invoices are fetched unpaginated, newest first, and aggregated client-side for Month/Quarter/Year, so anything past row 1000 is dropped with no error. Driving hours use the newest 1000 activity logs whatever the period. Separately, the page selects `billable` from vehicles, but per CLAUDE.md "billable" is derived from licences and no migration adds that column. A missing column answers 42703 and fails the whole page ("Vehicles load error").
- Failure scenario: an operator with 1,500 jobs this year sees "Year" revenue and margin computed from only the latest 1,000 jobs, understating revenue by a third, with no warning. Alternatively the page never loads at all.
- Fix: aggregate server-side (an RPC or sum/count views) filtered by the period's date range. At minimum add `.gte(date, periodStart)` and paginate with `.range()`. Drop `billable` from the select, or confirm the column exists.

### [MEDIUM] SET-13: /stats can show "All tenants" figures under a specific tenant selection
- File: app/stats/page.tsx:603-644 (effect), 352-593 (loadStats sets state without a cancel check)
- Verdict: CONFIRMED (timing-dependent)
- Problem: the effect does not wait for `tenant.status === "ready"`. On a cold load it first runs with activeTenantId null (unscoped for an admin, meaning every tenant in the company), then runs again once the persisted tenant resolves. `cancelled` is checked only before loadStats is called; loadStats itself calls setJobs, setInvoices and setDataTenantId unconditionally when it finishes. If the first request (bigger and slower) resolves last, it overwrites the scoped data and sets dataTenantId back to null.
- Failure scenario: an admin whose last selection was Tenant North reloads /stats. The selector says North, but revenue and job counts are company-wide.
- Fix: add `if (tenant.status !== "ready") return;` to the effect, and pass a request token or AbortSignal into loadStats so stale results are ignored.

### [MEDIUM] SET-14: Dashboard uses the UTC date for "today" and counts void/credited/draft invoices as overdue
- File: app/dashboard/page.tsx:30-32, 81-85, 107-110; lib/dashboard/aggregate.ts:45-66
- Verdict: CONFIRMED
- Problem: `new Date().toISOString().slice(0,10)` gives the UTC date, which between 00:00 and 01:00 BST is still yesterday. "Jobs today" then shows yesterday's jobs and the overdue cut-off runs a day late. sevenDaysAgo is also UTC while buildRevenueLast7Days keys days in local time, so revenue on an edge day can be missed. The overdue query is `.neq("status","paid")`, which includes void, credited, cancelled and draft invoices (app/invoices/page.tsx treats void and credited as non-collectable).
- Failure scenario: the "Overdue invoices" KPI and the Needs Attention list are inflated with voided and credited invoices, so staff chase money that is not owed. Night-shift planners at 00:30 see the wrong day's jobs.
- Fix: use the lib/time.ts operator-day helpers with company_profiles.timezone. Filter overdue on the open statuses only, e.g. `.not("status","in","(paid,void,credited,cancelled,draft)")`, or an explicit list of the real open statuses.

### [MEDIUM] SET-15: documents PUT stores an unvalidated logo_path (audit L3 still present) and autosave can clobber a new logo
- File: app/api/settings/documents/route.ts:299-302, 164-183; app/settings/documents/page.tsx (autosave sends its hydrated snapshot of logo_path)
- Verdict: CONFIRMED (L3); autosave clobber PLAUSIBLE
- Problem: `logo_path: cleanText(document.logo_path)` is stored as sent, and loadSettings then signs it for an hour with the service-role client. logo/route.ts enforces `isTenantLogoPath`; this route does not. A PUT that omits logo_path also nulls it.
- Failure scenario: an admin of tenant A sets `logo_path` to `<tenantB>/logo/<uuid>.png` and gets back a signed URL to B's file. The bucket is document-branding only, so the exposure is limited to branding images, which is why this is MEDIUM rather than HIGH. Separately, an autosave from state hydrated before a logo upload finished writes the old path back and orphans the new file.
- Fix: ignore logo_path in PUT entirely (the logo route owns it), or reject any value that fails isTenantLogoPath(tenantId, path). Move the helper into a shared lib module.

---

### [LOW] SET-16: No security response headers (CSP, frame-ancestors / X-Frame-Options, nosniff, Referrer-Policy)
- File: no next.config.*, vercel.json has no headers, proxy.ts sets none
- Verdict: CONFIRMED
- Problem: any origin can frame the settings pages that change roles, invite users and connect Stripe (clickjacking), and with no CSP any future XSS is unmitigated.
- Failure scenario: a hostile page frames /settings/users and tricks an admin into clicking "Invite User" on a prefilled form.
- Fix: add headers in proxy.ts or next.config. At minimum send `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. A full CSP must hash-allowlist THEME_SCRIPT (lib/theme/themeScript.ts) and the landing page's JSON-LD script.

### [LOW] SET-17: TenantProvider can hang on "Loading..." if localStorage throws, and concurrent resolves are unsequenced
- File: app/components/TenantProvider.tsx:99-101, 136-152
- Verdict: CONFIRMED (storage throw), PLAUSIBLE (race)
- Problem: `window.localStorage.getItem` sits outside any try. Safari with site data blocked throws SecurityError, which rejects resolve() (fired unhandled via `void resolve(...)`) and leaves status on "loading" forever; setActiveTenantId's setItem has the same problem. Separately, two blocking resolves (SIGNED_OUT then SIGNED_IN for a different account in quick succession) carry no sequence token, so the older response can win.
- Failure scenario: a user with strict browser privacy settings cannot use the app at all. An account switch in one tab briefly shows the previous user's tenant list.
- Fix: wrap storage access in try/catch, as ThemeToggle already does. Keep a `resolveSeq` ref and discard stale completions.

### [LOW] SET-18: Tenant-switch fetch races on list pages
- File: app/vehicles/page.tsx:118-168; app/maintenance/page.tsx:129-296; app/assets/page.tsx:114-152; app/settings/licences/page.tsx:164-271; app/settings/users/page.tsx:43-90; app/settings/permissions/page.tsx:52-80
- Verdict: CONFIRMED (timing-dependent, same company only)
- Problem: loaders are not cancellable, so a slow response for the previous tenant can land after the new tenant's and replace the list. dataTenantId comes from the stale closure, so the skeleton logic can present stale rows as current.
- Failure scenario: an admin switches from North to South, still sees North's vehicles, and deactivates one believing it is South's. RLS confines this to the admin's own company.
- Fix: pass a request id or AbortController and ignore responses whose tenant no longer matches `tenant.activeTenantId`.

### [LOW] SET-19: Vehicles can be linked to another tenant's fleet insurance policy
- File: app/vehicles/page.tsx:123-136 (policies loaded via filterByTenant), 1064-1071 (select), 477-480 (payload)
- Verdict: CONFIRMED (same company only)
- Problem: in the "All tenants" view the policy dropdown lists every tenant's policies, and editing a tenant A vehicle can save a policy id belonging to tenant B. Nothing in the client, or visibly in the schema, enforces the same tenant.
- Fix: filter the dropdown by the vehicle's tenant_id (writeTenantId for inserts); optionally add a composite FK or trigger.

### [LOW] SET-20: /settings/permissions cannot work as written
- File: app/settings/permissions/page.tsx:61-62, 86-89; docs/sql/rls_06_lock_secrets.sql:21
- Verdict: PLAUSIBLE
- Problem: rls_06 says user_permissions is locked deny-all for authenticated, so `grant()` should always fail. `profiles.email` may not exist either (the invite route reads emails from public.users, not profiles). README marks the page PARTIAL. Nothing reads user_permissions, so the page gives admins a false sense of access control.
- Fix: hide the page, or label it unavailable, until a server route and enforcement exist.

### [LOW] SET-21: /settings/invoices counts through an `.in()` of every vehicle id and uses v1 pricing
- File: app/settings/invoices/page.tsx:43-75
- Verdict: CONFIRMED
- Problem: the vehicles fetch is capped at 1000 rows, and `.in("vehicle_id", ids)` puts every uuid in the query string (about 37 characters each), which hits URL length limits at a few hundred vehicles. `computeChargeAmounts` is v1 money and wrong for v2 companies (CLAUDE.md forbids mixing the two).
- Fix: count server-side via lib/billing/vehicleCount.ts and choose the pricing copy by billing_model.

### [LOW] SET-22: Maintenance create path does not validate cost (Stuart finding 28 still present)
- File: app/maintenance/page.tsx:390-393
- Verdict: CONFIRMED
- Problem: `Number(cost)` turns "12,50" or "abc" into NaN, which Postgres rejects with an error, and a negative cost is saved as-is. The edit path validates (line 530).
- Fix: reuse the edit path's validation.

### [LOW] SET-23: Compliance expiry day count is off by one across BST transitions (documented known bug)
- File: lib/compliance/expiry.ts:30-45 (used by /vehicles and fleet policies)
- Verdict: CONFIRMED (self-documented)
- Problem: a millisecond delta rounded with Math.ceil reports one extra day around the autumn clock change, so the red "7 days" MOT/insurance warning fires a day late.
- Fix: compare calendar-day strings, as lib/planning/compliance.ts does.

### [LOW] SET-24: Invite route scans every auth user per invite, is non-transactional, and leaks internal errors
- File: app/api/settings/users/invite/route.ts:88-107, 176-181; portal-invites/route.ts:73-89
- Verdict: CONFIRMED
- Problem: listUsers pages through the entire auth user table on every invite, which gets slow and rate-limited as signups grow. The separate writes have no rollback, so a failure leaves an orphan auth user (lib/superAdmin/users.ts:84-90 acknowledges this). Raw Supabase error messages are returned to the browser.
- Fix: look users up by email via public.users (unique email) or a SECURITY DEFINER RPC, do the provisioning in one RPC, and return generic 500 text while logging the details.

### [LOW] SET-25: GET /api/settings/documents is readable by any member, including drivers
- File: app/api/settings/documents/route.ts:224-229
- Verdict: CONFIRMED
- Problem: requireTenantAccess is called without allowedRoles, so driver-role members receive bank_details, email templates, and registration and VAT numbers. The data is not very sensitive, but drivers have no need for it.
- Fix: pass ACCOUNTS_ADMIN_ROLES for GET, or strip bank_details for non-admins.

### [LOW] SET-26: Landing footer legal links are placeholders ahead of self-service signup
- File: components/landing/Footer.tsx:12-15
- Verdict: CONFIRMED
- Problem: the footer's privacy and terms links are `href="#"`. Opening self-service signup, which collects personal data (UK GDPR) and card details, without a privacy notice or terms is a compliance gap.
- Fix: publish privacy and terms pages and link them from the footer, the request-access form and signup.

### [LOW] SET-27: lodash and uuid advisories via @tomtom-international/web-sdk-maps have no fix
- File: package.json ("@tomtom-international/web-sdk-maps": "^6.25.0")
- Verdict: CONFIRMED
- Problem: lodash has prototype pollution in `_.unset`/`_.omit`, and uuid lacks a buffer bounds check. The map SDK runs client-side only, so exploitability is low.
- Fix: track upstream; consider TomTom's successor SDK, or npm overrides after testing.

---

## Items checked and found OK (no finding)
- Invite/PATCH/portal-invites/documents/logo/Stripe connect routes all check the caller server-side (a role gate is present), apart from the data-source problem in SET-3. In that sense Stuart finding 33 is resolved.
- No client write to `vehicle_licences.active` or `vehicle_id`: /settings/licences create, toggle and delete all go through POST /api/licences/activate.
- No query filters on `vehicles.company_id`. /assets inserts `company_id` into `assets` (a column that table does have), sourced from tenants.company_id, which is correct.
- Admin "All tenants" writes: vehicles, fleet policies, maintenance, assets, licences and users all refuse inserts when writeTenantId is null, and rls_08 also rejects a null tenant_id.
- Theme: no Tailwind `dark:` variants in my area. THEME_SCRIPT is wrapped in try/catch and is the first child of body. themeableRoutes lists every console route in scope. suppressHydrationWarning is scoped to <html>.
- The only NEXT_PUBLIC_ variables in client code are the Supabase URL and anon key, the site URL, the Square app and location ids, and the TomTom map key, all meant to be public. No client file references the service-role key.
- No console.log left in settings/fleet/dashboard/stats/components/landing (restyle finding 5 resolved).
- App code never imports sharp directly (only next does), so M8 exposure comes through Next's image optimization.

## Prior findings re-check (my area)
- Stuart 10 (/assets bypasses tenant switcher): FIXED, uses useTenant/filterByTenant.
- Stuart 11 (asset_types unfiltered): OK, rls_04 makes it a global read-only lookup.
- Stuart 28 (maintenance cost validation): STILL PRESENT (SET-22).
- Stuart 29 (maintenance_records RLS only): FIXED, now filterByTenant.
- Stuart 30/32 (users message state, non-null assertion): still present, cosmetic.
- Stuart 33 (invite auth client-advisory): a server check now exists, but it reads the wrong table (SET-3).
- Restyle 2 (/settings/invoices unscoped licences): FIXED via vehicles scoping; new issues in SET-21.
- Restyle 3 (/settings/permissions unscoped, add-only): scoping FIXED; the add-only grants and the deny-all table remain (SET-10, SET-20).
- Restyle 4 (/settings/company bypasses switcher): the switcher is now used, but with the wrong id (SET-1).
- Restyle 5 (company console.log): FIXED.
- Restyle 6 (/vehicles writes skip filterByTenant): still present; RLS covers it, so this is only a hardening nit.
- Audit L3 (documents logo_path): STILL PRESENT (SET-15). Audit L4 (invite company_id): STILL PRESENT and worse than its rating (SET-2). Audit M8 (sharp): STILL PRESENT (SET-5).
