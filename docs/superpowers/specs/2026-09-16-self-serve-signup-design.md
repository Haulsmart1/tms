# Self-serve signup: a company creates its own account

Date: 2026-09-16
Status: approved decisions (see the table), built on `feat/self-serve-signup` and proven against
a local Supabase stack before it goes anywhere.

## Problem

A prospect fills in the landing page's "Request access" form, a lead row lands in
`registration_requests`, and somebody provisions the company, its first tenant and its founding
admin by hand in the Supabase SQL editor. No code in `app/` or `lib/` inserts into `companies` or
`tenants`. The landing spec of 2026-07-22 called this sub-projects 3 (signup UI) and 4
(provisioning backend) and left both for later. The rule agreed on 2026-07-28 and never built:
the first profile created for a company is automatically `admin`.

This spec builds that: a visitor signs up, verifies their email through the existing scanner-safe
confirm page, and lands in the console as the founding admin of a new company with one tenant.
Adding a card, a vehicle and a driver is prompted from the dashboard and remains optional to
browse. Every open decision in the opening handoff (`docs/handoffs/2026-09-16-self-serve-signup.md`)
was made before this document; none is reopened here.

## Decisions (final)

| # | Decision | Answer |
|---|---|---|
| 1 | Flow order | Company first. The form collects company name, your name and email. `POST /api/signup` creates the auth user, the company, the tenant, the company profile and the founding admin profile in one go, then sends the email last. |
| 2 | First run | After confirm, `next` stays `/dashboard`. A getting-started panel on `/dashboard` shows three steps, each linking out: add a card (`/settings/billing`), add a vehicle (`/vehicles`), add a driver (`/drivers`). It shows until all three exist. A card is not required to browse; vehicle activation stays blocked without one (existing behaviour). |
| 3 | Bot control | Honeypot plus per-IP and per-email rate limits at the `/api/request-access` level. No Turnstile. |
| 4 | Legal (SET-26) | Link only. The form links to `/privacy` and `/terms`. Neither page is built or registered as a route. The closing handoff records them as a launch blocker. |
| 5 | Theme | `/signup` follows the theme like `/login`, listed in `lib/nav/themeableRoutes.ts`. |
| 6 | Lead flow | The request-access form and `/super-admin/requests` stay. Every primary CTA re-points to `/signup`; the form's "coming soon" copy becomes a secondary "talk to us" path. |
| 7 | Auth user creation | The service-role admin API, with the emailed link landing on `/auth/confirm` as `type=invite`, which `lib/auth/confirm.ts` already accepts. See "Order of operations" for the exact calls. |
| 8 | Existing email | If `find_auth_user_id_by_email` returns a user, no company is created. That address gets an ordinary sign-in email and the identical neutral response. |
| 9 | Contact name | **`profiles.full_name`** of the founding admin. See below. |
| 10 | Pricing copy | `pricingHeadline()` and the other helpers in `lib/billing/pricingCopy.ts`. No price literal anywhere. |

### Decision 9 resolved: the contact name is `profiles.full_name`

The diag against the reconstructed schema (checkpoint 0) and the app agree that `profiles` already
carries `full_name` and `phone`: `app/api/settings/users/[userId]/route.ts` updates both, and the
super-admin users list selects `full_name`. `company_profiles` has no contact-name column at all;
its 28 columns are the company's own identity (trading name, registration numbers, address,
locale). The name typed on the signup form is the person's, not the company's, and the person is
the founding admin, so it goes on their profile. Nothing new is added to `company_profiles`
beyond `company_name`.

## Order of operations in `POST /api/signup`

The handoff said "send the email last". `inviteUserByEmail` sends on creation, so with that call
alone the email would go out before the company existed and compensation would have to cover the
gap. Instead the route uses three admin calls so that the email really is last:

1. `admin.auth.admin.createUser({ email, email_confirm: false })`. Creates the auth user and
   sends nothing. No `user_metadata` (`data:`) at all: tenant, company and role never travel in
   metadata (SQL-13, prodfix_89).
2. `admin.rpc("create_company_with_admin", { p_user_id, p_email, p_company_name, p_contact_name })`.
   One transaction. On any error, or an outcome other than `created` or `already_member`, the
   route deletes the auth user it just created (compensation, mirroring
   `app/api/settings/users/invite/route.ts`) and answers the fixed failure response. No email
   has been sent at that point, so nothing reaches the customer about an account that does not
   exist.
3. `admin.auth.admin.inviteUserByEmail(email, { redirectTo: <origin>/auth/confirm?next=%2Fdashboard })`.
   GoTrue's invite endpoint accepts an EXISTING, UNCONFIRMED user and sends the invite email
   (it refuses only a confirmed one). The link lands on `/auth/confirm?token_hash=...&type=invite`
   and the existing POST form on that page verifies it. If this send fails, the account and
   company already exist; the failure is logged and the response is still the constant success
   body, because the customer can recover by submitting `/signup` again (existing, unconfirmed
   branch below) or `/login`.

**This ordering is verified empirically in phase 3 on the local stack** (invite after
`createUser` sends, and the link verifies as `invite`). If GoTrue refuses it, the fallback is
invite-first with compensation, and this section is updated to say so.

### Branch on an existing address (decision 8)

`find_auth_user_id_by_email` runs before any side effect. If it returns an id:

- `admin.auth.admin.getUserById(id)`. If `email_confirmed_at` is null (a signup that never
  clicked its invite), call `inviteUserByEmail` again: it re-sends the invite for an unconfirmed
  user. A magic link for an unconfirmed user would come out as a `signup`-type confirmation,
  which `/auth/confirm` rejects.
- Otherwise `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`
  through the anon client exactly as `/api/auth/magic-link` does, sharing `confirmRedirectUrl`
  from `lib/auth/magicLink.ts`.
- The RPC is never called on this branch. No company is created.

Known limitation, recorded and not reopened: an existing, confirmed account that has no company
(an orphan from a failed invite, or a user removed with `remove_company_user`) cannot create a
company through `/signup`; they get a sign-in link and land on the no-tenant panel. That needs
an operator today.

### Concurrency

Two requests for the same fresh address race. Both miss the lookup; both call `createUser`;
GoTrue's unique email refuses the second. The loser re-runs `find_auth_user_id_by_email`
(as the invite route does) and continues down the existing-address branch. Result: one auth
user, one company, two identical responses, at most two emails.

### Idempotency in the database

`create_company_with_admin` returns `already_member` and writes nothing when `p_user_id` already
has a profile with a company. The route treats `already_member` like `created`.

## `create_company_with_admin` (docs/sql/signup_01_create_company_with_admin.sql)

```sql
create or replace function public.create_company_with_admin(
  p_user_id      uuid,
  p_email        text,
  p_company_name text,
  p_contact_name text default null
) returns text
```

SECURITY DEFINER, owned by `postgres`, `search_path = public, pg_temp`, EXECUTE revoked from
`public`, `anon` and `authenticated`, granted to `service_role` only. Same preamble as
`prodfix_20`.

Raises `invalid_arguments` when `p_user_id` is null or the trimmed company name is empty,
`user_not_found` when there is no `auth.users` row, and `role_missing` / `role_ambiguous`
through `prodfix_role_id('admin')`.

Returns:

| Value | Meaning |
|---|---|
| `created` | company, tenant, company profile, `public.users`, profile and membership all written |
| `already_member` | the profile already has a company (or a tenant with a company); nothing written |

In one transaction, in this order:

1. `companies (name)`; the trimmed company name.
2. `tenants (name, company_id)`; the tenant's name defaults to the company name.
3. `company_profiles (tenant_id, company_name)`; `tenant_id` holds the COMPANY id
   (rls_04, `lib/superAdmin/companyEdit.ts`). Locale defaults are left to the settings page.
4. `public.users (id, email)` on conflict do nothing (memberships references it).
5. `profiles`: insert `(id)` on conflict do nothing, lock the row, then set `tenant_id`,
   `company_id` (the tenant's company, so prodfix_88's binding trigger passes), `role_id =
   prodfix_role_id('admin')` and `full_name = p_contact_name` (only when the profile's
   `full_name` is null, so a name a user already chose is never overwritten).
6. `memberships (tenant_id, user_id, role)` for compatibility only, guarded by `not exists`.

The function also creates `roles_name_key`, a unique index on `roles.name`, with
`create unique index if not exists`, because `prodfix_role_id` has to raise `role_ambiguous`
only because nothing prevents duplicates today.

What it must never do (stated in the file header):

- read `raw_user_meta_data` or `user_metadata` (SQL-13);
- be executable by `authenticated` or `anon`;
- insert into `company_billing`. That row is created only by `POST /api/billing/card`, which
  writes `billing_model = 'v2_period'`; the column default is still `v1_immediate`, so any other
  writer would make a v1 company.

Guard interplay: the profiles guard exempts `postgres`, which is `current_user` inside a
SECURITY DEFINER function it owns, so the privileged-column write passes. prodfix_88's
`guard_profiles_tenant_company_match` is not exempt for anyone; the function satisfies it by
writing the company id it just created the tenant under.

## `POST /api/signup`

`runtime = "nodejs"`, `dynamic = "force-dynamic"`. Origin from `publicAppOrigin(request.url)`
(`lib/accounts/appUrl.ts`), never the request host.

Request: JSON object.

| Key | Rule |
|---|---|
| `companyName` | string, trimmed, 2 to 120 characters |
| `contactName` | string, trimmed, 1 to 120 characters |
| `email` | string, trimmed, lowercased, at most 320 characters, `z.email()` |
| `companyWebsite` | optional string, the honeypot; same name and handling as request-access |

Unknown keys are rejected (`z.strictObject`). The Zod schema lives in `lib/validation/signup.ts`.

Order inside the handler:

1. Admin client; if it cannot be built, 500 `{ ok: false, error: "Server is not configured to
   accept signups." }`.
2. Parse JSON; on failure 400 `{ ok: false, error: "Invalid request body." }`.
3. Honeypot: if `companyWebsite` is a non-empty string, return the SUCCESS response and stop.
4. Per-IP limit `RATE_LIMITS.signupPerIp` keyed by `leadClientKey(headers, clientIp)`. Over the
   limit returns the SUCCESS response. (Read before objecting: a 429 here would differ only by
   the caller's own behaviour, but returning the constant body keeps a bot from learning it hit
   the wall, and the adversarial matrix requires it.)
5. Zod parse; on failure 400 `{ ok: false, fieldErrors }` (field-keyed, like request-access;
   validation runs before any lookup so it reveals nothing about accounts).
6. Per-email limit `RATE_LIMITS.signupPerEmail` keyed by the normalised email. Over the limit
   returns the SUCCESS response.
7. `find_auth_user_id_by_email`. A lookup error is a 500 with the fixed failure body (the
   migration is a precondition, like the invite route's 503, but a 503 that only the new-user
   path can produce would be an oracle; the route answers 500 on any lookup failure regardless
   of the address).
8. Existing user: the branch above; SUCCESS response.
9. New user: `createUser`, RPC, `inviteUserByEmail`; SUCCESS response. Compensation on RPC
   failure, then the FAILURE response.

Responses (the only bodies the route produces):

| Case | Status | Body |
|---|---|---|
| SUCCESS: new, existing, honeypot, over either limit, invite send failed | 200 | `{ "ok": true, "message": SIGNUP_SENT_MESSAGE }` |
| malformed JSON or wrong content type | 400 | `{ "ok": false, "error": "Invalid request body." }` |
| schema failure | 400 | `{ "ok": false, "fieldErrors": {...} }` |
| FAILURE: admin client, lookup error, RPC failure after compensation | 500 | `{ "ok": false, "error": "We could not create your account. Please try again in a moment." }` |

`SIGNUP_SENT_MESSAGE = "Check your inbox to finish setting up your account."` The success body
is produced by one function, `signupSentResponse()`, so it cannot drift between branches. The
route sets no headers of its own. `GET` is not exported, so Next answers 405.

On the RPC-failure case the response is a 500, not the success body. A customer told to check
their inbox when no account exists would wait forever; that is worse than an honest retry
prompt. The remaining risk, that a broken RPC turns the route into an oracle (new addresses 500,
existing ones 200), exists only during an outage and is visible in the logs.

Pure logic lives in `lib/auth/signup.ts` so it is unit-testable without Supabase:
`SIGNUP_SENT_MESSAGE`, `signupSentResponse()`, `signupFailedResponse()`,
`normalizeSignupInput`, and `runSignup(deps, input)`, which takes an object of injected
functions (`findUserIdByEmail`, `getUserConfirmed`, `createUser`, `deleteUser`,
`createCompany`, `sendInvite`, `sendMagicLink`, `log`) and returns the response to send. The
route wires real Supabase calls into `deps`; the tests wire fakes.

### Rate limits

| Rule | Bucket | Window | Max | Why |
|---|---|---|---|---|
| `signupPerIp` | `signup:ip` | 3600 s | 5 | Same as `requestAccessPerIp`. Signup mints an auth user and an email per accepted request, so it sits at the lead-form level, not `loginPerIp`'s 20 per 15 minutes. |
| `signupPerEmail` | `signup:email` | 86400 s | 3 | Same as `REQUEST_ACCESS_PER_EMAIL`. Three sends a day covers a mistyped submit and a lost email; more is either a bot or someone who should use `/login`. |

Both live in `RATE_LIMITS` in `lib/rateLimit.ts`. Rate limiting is inert until prodfix_01 is
applied (the helper allows requests when `rate_limit_hit` is missing); it is applied on the
local stack.

## `/signup` page

`app/signup/page.tsx`, a client component with the same skeleton as `app/login/page.tsx`: root
`className="ds grid min-h-screen place-items-center bg-canvas px-4 font-sans text-ink"`, one
card, `Field`, `Button`, `MessageBanner`.

Fields: company name, your name, email, and the honeypot rendered exactly as
`RequestAccessForm.tsx` renders it (`sr-only`, `aria-hidden`, `tabIndex -1`, `autoComplete off`).

Copy: heading "Create your account"; `pricingHeadline().summary` beneath it;
`BILLING_BASIS_SENTENCE` as the small print under the button; "Already have an account? Log in"
linking to `/login`; "By continuing you agree to our terms and privacy notice" with `/terms` and
`/privacy` links.

States:

| State | What renders |
|---|---|
| idle | the form |
| submitting | button `loading`, inputs unchanged, resubmit ignored |
| invalid | client-side mirror of the schema (lengths, email shape) shown per field before any request; server `fieldErrors` shown the same way when they arrive |
| failed | `MessageBanner` tone danger with the server's `error`, or a connection message; form stays |
| sent | the form is replaced in place by a `role="status"` panel with `SIGNUP_SENT_MESSAGE` and a "Back to home" link; no redirect |

A signed-in visitor sees the page with no console shell (`shouldShowShell` exemption) and no
redirect; there is nothing to protect on it.

## Getting-started panel on `/dashboard`

`components/dashboard/GettingStartedPanel.tsx` takes `{ cardCount, vehicleCount, driverCount }`
and renders a `Card` with three rows built by `buildGettingStartedSteps` in
`lib/dashboard/gettingStarted.ts`:

| Step | Done when | Link |
|---|---|---|
| Add a card | `cardCount > 0` | `/settings/billing` |
| Add your first vehicle | `vehicleCount > 0` | `/vehicles` |
| Add your first driver | `driverCount > 0` | `/drivers` |

`isGettingStartedComplete(counts)` is true when all three are positive; the component returns
`null` then. The card copy is v2 only: `CARD_SETUP_SENTENCE` (no charge today; the minimum is
taken when the first vehicle is activated for billing) and the amount from `pricingHeadline()`.
The v1 sentence "Your first charge is taken today" appears nowhere in it.

Show rule on the page: `tenant.status === "ready"` and `tenant.role === "admin"`. Staff cannot
act on any of the three (card, vehicle and driver creation are admin actions), and a super admin
has no company of their own. The three counts are head-only `count: "exact"` queries: vehicles
and drivers through `tenant.filterByTenant`, `company_billing` through the admin's own RLS
scope (one row for their company or none). A count that fails to load is treated as zero, so
the panel errs toward showing.

### PaymentMethodCard default fixed

`app/settings/billing/PaymentMethodCard.tsx` defaults `setupNotice` to the v1 sentence. The
default is removed and the prop made required; `V1Billing.tsx` passes the v1 sentence
explicitly, `V2Billing.tsx` already passes `CARD_SETUP_SENTENCE`. A future caller cannot inherit
v1 wording by omission.

## CTA re-pointing (decision 6)

| File | Today | After |
|---|---|---|
| `components/landing/Hero.tsx:83` | `#request-access` "Get started" | `/signup` "Get started" |
| `components/landing/LandingNav.tsx:13` | anchor "Contact" to `#request-access` | unchanged (it is the secondary path) |
| `LandingNav.tsx:38` and `:44` | `#request-access` "Get started" | `/signup` "Get started" |
| `components/landing/PricingCard.tsx:68` | `#request-access` "Request access" | `/signup` "Get started" |
| `components/landing/Footer.tsx:15` | `#request-access` "Contact" | `/signup` "Get started", plus keep "Contact" to `#request-access` |
| `app/login/page.tsx` "No account yet?" | `/#request-access` "Request access" | `/signup` "Create one" |
| `app/components/TenantGate.tsx` RecoveryActions | `/#request-access` "Request access" | `/signup` "Create a company" |
| `components/landing/RequestAccessForm.tsx:74-83` | "Self-serve signup is coming soon." | "Prefer to talk it through first? Tell us about your operation and we will get in touch. Or create your account now." with a link to `/signup` |

LandingNav's three `#request-access` references are the nav anchor (line 13) and the two
buttons; the handoff counts all three, and the decision re-points the two primary buttons. The
"Contact" anchor is exactly the secondary path decision 6 keeps.

## Registration checklist

| File | Change |
|---|---|
| `lib/auth/publicRoutes.ts` | `"/signup"` and `"/api/signup"` in `PUBLIC_EXACT`, each with a comment |
| `lib/auth/publicRoutes.test.ts` | both in the "allows" list; `/signup/anything` and `/api/signup/anything` in the denied neighbours |
| `lib/auth/routeClassification.test.ts` | both in `PUBLIC_ROUTES` |
| `lib/nav/themeableRoutes.ts` and `.test.ts` | `"/signup"` |
| `lib/nav/shouldShowShell.ts` and `.test.ts` | `/signup` exemption |
| `lib/rateLimit.ts` | the two rules |
| `README.md` | page inventory row for `/signup` and `/api/signup`; the auth paragraph; roadmap lines on payments and the invite flow |
| `CLAUDE.md` | the "Self-service signup does not exist yet" sentence |
| `docs/sql/prodfix_00_APPLY_ORDER.md` | `signup_01` after the prodfix series; manual steps |

## Test matrix (phase 4)

### Vitest

| File | Asserts |
|---|---|
| `lib/validation/signup.test.ts` | valid input accepted and normalised (trim, lowercase); each field's boundaries (1 and 121 characters for company, 0 and 121 for contact, 321-character email, malformed email); unknown key rejected; honeypot key allowed and detected by the helper |
| `lib/auth/signup.test.ts` | `runSignup` returns byte-identical responses (status, body, header list) for new, existing-confirmed, existing-unconfirmed, honeypot and over-limit; existing path calls the sign-in sender and never `createCompany`; new path calls `createUser`, `createCompany`, `sendInvite` in that order; `createCompany` failure calls `deleteUser` with the created id and returns the failure response; `deleteUser` failure is logged and the response is the same failure response; no call passes `data`, `tenant`, `company` or `role` to `createUser` or `sendInvite` |
| `lib/rateLimit.test.ts` (or new assertions) | the two rules exist with the numbers above |
| `lib/dashboard/gettingStarted.test.ts` | three steps in order; done flags follow counts; complete only when all three positive; rendered panel (`renderToStaticMarkup`) lists three links, marks done rows, returns nothing when complete, and never contains "first charge is taken today" |
| `lib/auth/publicRoutes.test.ts`, `routeClassification.test.ts`, `themeableRoutes.test.ts`, `shouldShowShell.test.ts` | registration |
| `lib/accounts/publicLinks.test.ts` | still passes with the new route |

Route handlers under `app/` are not collected by vitest, so "per-IP limit hit before per-email"
and "origin comes from `publicAppOrigin`" are asserted through `runSignup`'s call order and a
source assertion respectively.

### Browser happy path (local stack, `next dev` on 3000, Playwright under `tests/`)

Fill `/signup` with a fresh address, submit, read the invite from Mailpit (port 54324), open the
link, press Continue on `/auth/confirm`, land on `/dashboard`, see three undone steps, confirm
`get_tenant_context()` for that user answers the new tenant with role `admin`, open
`/settings/billing` and confirm the v2 body and card form with no v1 wording.

### Adversarial pass (local stack)

The thirteen rows from the task prompt, recorded as attack / expected / observed / verdict:
concurrent duplicate signup; existing customer's email; per-email limit; per-IP limit; honeypot;
malformed and oversized bodies, unknown keys, empty strings, unicode and homoglyph names,
plus-addressing and uppercase emails; RPC failure after user creation; forged `next`; replayed
invite token; direct REST calls to the RPC as `anon` and `authenticated`; signed-in admin on
`/signup`; `GET` and empty `POST` to `/api/signup`; `/privacy` and `/terms` not built (the edge
gate in `proxy.ts` sends an anonymous visitor to `/login?next=...`, not a 404, because neither
path is public; recorded red and accepted as the SET-26 launch blocker).

## Manual steps before launch

From the handoff's section 4, none confirmed done:

- Supabase: "Allow new users to sign up" OFF (stays off); invite and magic-link templates link
  to `/auth/confirm?token_hash={{ .TokenHash }}&type=invite|email`; redirect allowlist accepts
  `/auth/confirm?next=...`; no OTP captcha; custom SMTP, because the built-in sender's shared
  hourly cap cannot carry signups.
- Vercel: `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
- SQL: the prodfix series in `prodfix_00_APPLY_ORDER.md`, then `signup_01`. prodfix_30 is what
  stops a signup that never activates a licence from running free (BILL1-1). The reconstruction
  file `local_00` is local-only.
- `/privacy` and `/terms`: launch blockers (SET-26).

## Out of scope, deliberately

- Turnstile (decision 3), a "pending signup" state (decision 1), and an existing account creating
  a company (decision 8's limitation above).
- Removing the request-access form or `/super-admin/requests`.
- Any change to `company_billing`'s column default or to the card route.
- The three fixed-palette pages and any file outside the handoff's Map table.
