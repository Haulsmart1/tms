# Handoff: self-serve signup (front page, login and signup flow)

Date: 2026-09-16
Branch: `main` at `a59c954`, clean, nothing unpushed. 174 test files, 2087 tests pass.
Nothing for this feature has been built yet. This document is the starting brief: what exists,
what is missing, where every new route has to be registered, and the traps that will bite.

Read `CLAUDE.md` and `README.md` first. Then this. The design decisions still open are listed at
the end; do not start the backend until they are made.

## 1. What "self-serve signup" means here

Today a prospect fills in the landing page's "Request access" form, which stores a lead row in
`registration_requests`, and someone provisions their company, tenant and admin profile BY HAND in
the Supabase SQL editor. There is no code in `app/` or `lib/` that inserts into `companies` or
`tenants`. The review of 2026-09-14 confirmed this
(`docs/superpowers/reviews/2026-09-14-production-readiness-review.md:123-126`).

The feature is: a visitor signs up on the site, verifies their email, and lands in the console as
the founding admin of a brand-new company with its first tenant, then adds a card. No operator
involvement. The landing spec of 2026-07-22 broke this into six sub-projects; 1, 2 (design system,
landing page) and 5 (billing) are done. This work is sub-projects 3 (signup UI) and 4 (provisioning
backend), plus the login page tidy-up that goes with it.

The rule that was agreed on 2026-07-28 and never built: **the first profile created for a company
is automatically 'admin'** (`docs/superpowers/plans/2026-07-28-rls-tenancy-hardening.md:617`).

## 2. What exists and is reusable

### Landing page (`/`)

`app/page.tsx` is a server component pinned to the light palette (`ds light`). Client components:
`components/landing/LandingNav.tsx` and `RequestAccessForm.tsx`. Sections: `Hero`, `FeatureGrid`,
`PricingCard`, `RequestAccessForm` (section id `request-access`), `Footer`.

Every call to action points at `#request-access`: `Hero.tsx:83`, `LandingNav.tsx:13,38,44`,
`PricingCard.tsx:68`, `Footer.tsx:15`, plus `app/login/page.tsx` ("No account yet? Request access")
and `app/components/TenantGate.tsx` (the no-tenant panel's request-access link). The landing spec
says the primary CTA re-points to `/signup` in one line when signup lands. The request-access form
copy says "Self-serve signup is coming soon" (`RequestAccessForm.tsx:74-83`).

Pricing copy is derived from `lib/billing/rateCard.ts` through `lib/billing/pricingCopy.ts`.
Do not hard-code a price on a signup page; import the same helpers.

### Login (`/login`)

`app/login/page.tsx` posts `{ email, next }` to `POST /api/auth/magic-link`. That route
(`app/api/auth/magic-link/route.ts`) rate limits per IP and per email, calls `signInWithOtp` with
`shouldCreateUser: false`, and always answers the same neutral message so nobody can enumerate
accounts. Pure helpers with tests: `lib/auth/magicLink.ts`.

The email link lands on `/auth/confirm` (a page, not a route handler) which renders a POST form to
`/api/auth/callback`, so an email scanner cannot consume the token. `lib/auth/confirm.ts` holds
`safeAuthNextPath` (same-origin paths only, default `/dashboard`) and the accepted OTP types
`email`, `magiclink`, `invite`. Post-login destination logic is `decidePostLoginDestination` in
`lib/auth/callback.ts`: drivers and subcontractor users go to their portals, everyone else to `next`.

Signup can reuse all of this unchanged. A signup route mints the auth user itself and then sends a
normal magic link, or calls `inviteUserByEmail`, and the confirm page does the rest.

### Provisioning primitives (`docs/sql/prodfix_20_user_management.sql`, UNAPPLIED)

All SECURITY DEFINER, EXECUTE granted to `service_role` only:

| RPC | Does |
|---|---|
| `find_auth_user_id_by_email(text)` | uuid or null, replaces paging through `listUsers` |
| `prodfix_role_id(text)` | roles.name to id, raises `role_missing` / `role_ambiguous` |
| `provision_tenant_user(user_id, email, tenant_id, role)` | writes `public.users`, `profiles` (tenant_id, company_id, role_id) and legacy `memberships` atomically; returns `created / repaired / already_member / other_company` |
| `set_company_user_role`, `remove_company_user` | role change and removal |

`provision_tenant_user` requires an EXISTING tenant with a company (`prodfix_20:127-133`). It
cannot create either. That is the gap signup fills: a new RPC that creates company, tenant, company
profile and founding admin in one transaction, then either calls `provision_tenant_user` or repeats
its writes.

`app/api/settings/users/invite/route.ts` is the worked example of the shape to copy: authorize,
rate limit, look up by email, `inviteUserByEmail` with `redirectTo` on `/auth/confirm`, call the
RPC, and delete the auth user if provisioning fails (`:171-174`).

### Billing on a new company

New companies default to v2 arrears billing via `NEW_COMPANY_BILLING_MODEL = "v2_period"` in
`lib/billing/rateCard.ts:272`. The `company_billing` row does NOT exist at signup. It is created
the first time an admin saves a card in `POST /api/billing/card`
(`app/api/billing/card/route.ts:291-304`), which writes `billing_model: 'v2_period'`, takes no
money, and opens a period only if the fleet is already billable. The period, and the GBP 129
minimum charge, are anchored at FIRST VEHICLE ACTIVATION, not at signup. There is no trial and no
`trialing` status in the check constraint. `/settings/billing` with no row already renders the v2
body and the card form (`PaymentMethodCard.tsx:124-128`), so the "add a card" step of signup can
simply be a redirect to `/settings/billing`, or an inline `components/billing/SquareCardForm.tsx`.

`COOLING_OFF_HOURS = 48` in `lib/billing/cancellation.ts` refunds an accidental signup's minimum
once per company and once per card fingerprint (`card_fingerprint`, `prodfix_33`).

## 3. What must be built

### 3.1 SQL: `create_company_with_admin` RPC (new migration, `docs/sql/signup_01_*.sql`)

SECURITY DEFINER, `search_path` pinned, EXECUTE to `service_role` only, matching prodfix_20's
pattern. Inputs: auth user id, email, company name, optional contact name. In one transaction:

1. `companies (id, name)`. Base table has no `create table` in the repo; it pre-dates `docs/sql/`.
2. `tenants (name, company_id)`. `name` is NOT NULL. Default the first tenant's name to the company name.
3. `company_profiles`. **Its `tenant_id` column holds the COMPANY id** (`rls_04_identity_tables.sql:27`,
   `lib/superAdmin/companyEdit.ts:11-16`). Set `company_name`; the other 27 columns are in
   `EDITABLE_PROFILE_FIELDS` and can wait for `/settings/company`.
4. `public.users (id, email)`, separate from `auth.users`; `memberships.user_id` references it.
5. `profiles`: `tenant_id`, `company_id` = the tenant's company, `role_id` = roles.name `'admin'`.
   All three, or `get_tenant_context()` answers `no-tenant` (`rls_07_tenant_context.sql:15-20`) and
   the user sees "Account not linked to a company". `prodfix_88` (unapplied) will also enforce that
   `profiles.company_id` matches `tenants.company_id` for every role including service_role.
6. `memberships (tenant_id, user_id, role)`: legacy, written for compatibility only. Nothing reads
   it for authorization any more (`lib/accounts/server.ts:71`, `lib/api/server.ts:48` both use
   `authorizeTenant`). The review's warning that accounts would 403 without it is stale.

The `profiles_privileged_columns_guard` trigger refuses `role_id / tenant_id / company_id` on
INSERT except for `service_role`, `postgres` and existing super admins. A SECURITY DEFINER function
owned by `postgres` passes. Never read `raw_user_meta_data` inside it (SQL-13): tenant, company and
role come from the function's arguments, which the service-role route controls.

Raise on a duplicate: if the auth user already has a profile with a company, return `already_member`
rather than creating a second company. Add a unique index if `roles.name` is not already unique
(`prodfix_20:83` suggests it is not).

Also run `docs/sql/prodfix_89_auth_users_provisioning_check.sql` (read-only) BEFORE writing this:
it reports whether a `handle_new_user`-style trigger already exists on `auth.users`. If one does
and it copies user metadata, it must be replaced with the identity-only template in that file.

### 3.2 Route: `POST /api/signup`

Copy the shape of `app/api/auth/magic-link/route.ts` and `app/api/request-access/route.ts`:

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`, origin from `publicAppOrigin(request.url)`
  (`lib/accounts/appUrl.ts`), never the request host. `lib/accounts/publicLinks.test.ts` fails any
  route that builds an outbound link from the request.
- Zod schema in `lib/validation/signup.ts` (Zod v4 API, see `lib/validation/requestAccess.ts`):
  company name, contact name, email, honeypot field.
- Rate limit per IP first, then per email, with new rules in `RATE_LIMITS`
  (`lib/rateLimit.ts`). Use `leadClientKey` from `lib/auth/leadIntake.ts` for the IP key on
  Vercel. Rate limiting is INERT until `prodfix_01` is applied (the helper allows requests when
  the `rate_limit_hit` RPC is missing).
- Honeypot returns `{ ok: true }` 200, indistinguishable from success.
- Look up the email with `find_auth_user_id_by_email`. If a user exists, do NOT create a company
  and do NOT say so: send them an ordinary magic link (or nothing) and return the same neutral
  message. The response must not reveal whether the address has an account.
- Create the auth user with the service-role client (`admin.auth.admin.createUser` with
  `email_confirm: false`, or `inviteUserByEmail`), call `create_company_with_admin`, and on failure
  delete the auth user (compensation, as the invite route does). Send the email LAST.
- The email link must land on `/auth/confirm?token_hash=...&type=...`. If using
  `inviteUserByEmail`, `type` is `invite`, which `lib/auth/confirm.ts` already accepts.
- Return one constant message ("Check your inbox to finish setting up your account").

Do NOT call `supabase.auth.signUp` from the browser. That needs "Allow new users to sign up" ON
in Supabase, which re-opens AUTH-7 (anyone mints auth users and burns the email quota) and
SQL-13. Keep that setting OFF; the service-role client creates users regardless of it.

### 3.3 Page: `/signup`

`app/signup/page.tsx`, client component, same skeleton as `app/login/page.tsx`: root
`className="ds ... bg-canvas font-sans text-ink"`, `Field`, `Button`, `MessageBanner` from
`components/`. Decide whether it pins `light` like `/` (marketing) or follows the theme like
`/login` (first console screen). Fields: company name, your name, email. Show the price from
`pricingHeadline()` and a link to `/login`. On success show the "check your inbox" state, not a
redirect.

Legal: SET-26. The footer's privacy and terms links were removed because they were placeholders
(`components/landing/Footer.tsx`). Signup collects personal data and later card details, so a
privacy notice and terms page must exist and be linked from the signup form before launch.

### 3.4 First-run inside the console

After confirm, `next` defaults to `/dashboard`. The founding admin has no vehicles, no drivers, no
card. Options: `next=/settings/billing` so the first screen is the card form, or a small
"getting started" panel on `/dashboard`. `PaymentMethodCard.tsx:78` has a v1-flavoured default
notice ("Your first charge is taken today") which is wrong for v2 and must not be what a new
signup reads.

Update the no-tenant panel in `app/components/TenantGate.tsx` (its `RecoveryActions` link) and
the login page's "No account yet?" link to point at `/signup`.

### 3.5 Registration checklist for every new route (tests fail otherwise)

| File | Add |
|---|---|
| `lib/auth/publicRoutes.ts` | `"/signup"` and `"/api/signup"` in `PUBLIC_EXACT` (exact paths only, no prefixes) |
| `lib/auth/publicRoutes.test.ts` | both in the "allows" list |
| `lib/auth/routeClassification.test.ts` | both in `PUBLIC_ROUTES`; the test walks `app/` and fails on any unlisted route |
| `lib/nav/themeableRoutes.ts` and its test | `"/signup"`, else the page is pinned dark; the test asserts the verbatim list |
| `lib/nav/shouldShowShell.ts:13` | add `/signup` to the pathname exemption or a signed-in visitor sees console chrome on it |
| `lib/rateLimit.ts` | `signupPerIp`, `signupPerEmail` rules |
| `README.md` | page inventory row, auth paragraph (line 22), roadmap lines 213 and 217 |
| `CLAUDE.md` | the Auth section sentence "Self-service signup does not exist yet" |

`proxy.ts` is the edge gate. Anything not in `publicRoutes.ts` is redirected to `/login` (pages)
or answered 401 (API), so a forgotten entry looks like a broken page, not an error.

## 4. Manual steps (Supabase dashboard and Vercel)

From `docs/sql/prodfix_00_APPLY_ORDER.md:160-176`, none confirmed done as of 2026-09-16:

- Auth, Providers, Email: "Allow new users to sign up" OFF. Stays off with this design.
- Email templates: Magic Link and Invite must link to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`.
- URL configuration: redirect allowlist accepts `/auth/confirm?next=...`.
- Do not enable OTP captcha: the magic-link route sends no token. If signup needs a bot control
  beyond honeypot and rate limit, Cloudflare Turnstile verified server-side in `/api/signup` is
  the documented option (`app/api/request-access/route.ts` header), and needs a site key.
- Vercel: `NEXT_PUBLIC_SITE_URL` (email links), `CRON_SECRET` (still missing; billing never runs
  without it), `SUPABASE_SERVICE_ROLE_KEY`.
- Supabase's built-in email sender has a low shared hourly cap. Signup adds volume. Custom SMTP
  is not configured anywhere; Resend is only used for lead notifications and needs a verified
  domain.

## 5. SQL state you are building on

None of the `prodfix_*` files has been applied (`prodfix_00_APPLY_ORDER.md`). Signup depends on:

| File | Why |
|---|---|
| `prodfix_01` | rate limits are allow-all until this exists |
| `prodfix_20` | `find_auth_user_id_by_email`, `provision_tenant_user`, and the `staff`/`driver` role seeds |
| `prodfix_88` | tightens the profiles guard; write `company_id` consistently now so it passes later |
| `prodfix_89` | read-only probe for an existing `auth.users` trigger; run before writing 3.1 |
| `billing_06`/`07` | applied; the v2 columns and defaults the card route relies on |

Production currently runs code that refuses invites, payments and POD share links until the SQL
is applied. Apply the prodfix series first; add the signup migration after it in the apply order.

## 6. Traps

**Base tables have no DDL in the repo.** `companies`, `tenants`, `profiles`, `roles`, `memberships`,
`company_profiles` were created in the dashboard. Column facts are only known from comments and
the diag script. Run `docs/sql/diag_2026_09_14_live_state.sql` (or describe each table) before
writing the RPC; do not guess NOT NULL columns.

**`get_my_role`, `get_my_company_id`, `current_tenant_id`, `is_super_admin`** exist only in the
live database (`rls_02_helpers.sql:4-7`). `get_tenant_context()` depends on them.

**`company_billing.billing_model` DB default is still `v1_immediate`.** The v2 value only arrives
because the card route writes it. Any other path that inserts that row makes a v1 company.

**`company_profiles.tenant_id` is the company id.** Upsert with `onConflict: "tenant_id"`.

**A vehicle reaches its company through its tenant.** `vehicles` has no `company_id`.

**Cooling-off is a free-trial generator if the once-per-company guard is bypassed.** A new
signup is a new company; the card fingerprint check is the only cross-company guard.

**Billing is opt-in per vehicle.** A signup that adds vehicles and never activates a licence is
never billed (BILL1-1). `prodfix_30` refuses to put an unlicensed vehicle to work, which is the
gate. Without it applied, self-serve customers can run free.

**Enumeration.** Every response from `/api/signup` must be identical whether the email is new,
already a customer, or rate limited by email. `MAGIC_LINK_SENT_MESSAGE` is the model.

**Never read `raw_user_meta_data` for tenant, company or role.** The invite route still puts
`tenant_id` and `role` in `data:` for compatibility; do not copy that into signup.

**No em-dashes** in docs, code comments or copy.

## 7. Open decisions (make before building)

1. Verification first or company first? Recommended: create auth user and company in one go,
   then email. Alternative: collect email only, verify, then ask for company name on first login.
   The second is cleaner against junk companies but needs a "pending signup" state that
   `get_tenant_context` currently reports as `no-tenant`.
2. Is a card required before the console is usable? Today no: v2 charges only at first vehicle
   activation, and activation is refused without a card (`7339f49`). So a cardless signup can
   explore everything but cannot activate a vehicle. Decide whether that is the intended funnel.
3. Bot control: honeypot plus rate limits (current request-access level) or Turnstile.
4. Privacy notice and terms content (SET-26). Blocking for launch, not for development.
5. Whether `/signup` is light-pinned marketing or theme-following console.
6. What happens to `registration_requests` and `/super-admin/requests` once signup is live.

## Map

| Area | Files |
|---|---|
| Landing | `app/page.tsx`, `components/landing/*` |
| Login and confirm | `app/login/page.tsx`, `app/auth/confirm/page.tsx`, `app/api/auth/magic-link/route.ts`, `app/api/auth/callback/route.ts`, `lib/auth/{magicLink,confirm,callback}.ts` |
| Lead intake (closest analogue) | `app/api/request-access/route.ts`, `lib/auth/leadIntake.ts`, `lib/validation/requestAccess.ts` |
| Provisioning today | `docs/sql/prodfix_20_user_management.sql`, `app/api/settings/users/invite/route.ts`, `lib/auth/serverTenantAccess.ts` |
| Tenant context | `docs/sql/rls_07_tenant_context.sql`, `app/components/TenantProvider.tsx`, `TenantGate.tsx`, `lib/tenant/context.ts` |
| Gate and registration | `proxy.ts`, `lib/auth/publicRoutes.ts`, `lib/auth/routeClassification.test.ts`, `lib/nav/themeableRoutes.ts`, `lib/nav/shouldShowShell.ts` |
| Billing on signup | `lib/billing/rateCard.ts`, `app/api/billing/card/route.ts`, `app/settings/billing/*`, `components/billing/SquareCardForm.tsx`, `lib/billing/cancellation.ts` |
| Specs to read | `docs/superpowers/specs/2026-07-22-landing-redesign-design.md` (section 0), `2026-08-26-square-platform-billing-design.md`, `2026-09-10-period-billing-design.md`, `2026-09-11-v2-billing-ui-and-pricing-design.md` (section 7) |
| Review findings that gate this | `docs/superpowers/reviews/2026-09-14-production-readiness-review.md`: AUTH-2, AUTH-5, AUTH-7, AUTH-9, AUTH-11, AUTH-17, SQL-13, BILL1-1, SET-26 |
