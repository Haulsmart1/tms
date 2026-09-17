# Closing handoff: self-serve signup

Date: 2026-09-17 (work ran 2026-09-16 to 2026-09-17)
Branch: `feat/self-serve-signup`, from `main` at `a59c954`. Local only: nothing pushed, no PR, no
merge. A human reviews the branch by hand. The opening brief is
`docs/handoffs/2026-09-16-self-serve-signup.md`; this document is its bookend.

Status: **ready for human review, not ready to deploy.** The code is complete, tested and
independently reviewed, but the branch links `/signup` from every landing call to action, and
the SQL it depends on is not applied in production. Section 4 lists what must happen before the
merge is deployed and in what order.

## 1. What was built, file by file

### Database

| File | What |
|---|---|
| `docs/sql/signup_01_create_company_with_admin.sql` | `create_company_with_admin(p_user_id, p_email, p_company_name, p_contact_name)`: SECURITY DEFINER, `search_path` pinned, EXECUTE to `service_role` only. In one transaction writes `companies`, `tenants` (first tenant named after the company), `company_profiles` (its `tenant_id` column holds the company id), `public.users`, the founding `profiles` row (`tenant_id`, `company_id`, `role_id` = roles.name `admin`, `full_name` only if empty) and a legacy `memberships` row. Returns `created`, or `already_member` when the profile already belongs to a company (no company, tenant, binding or membership written; a bare `public.users` and `profiles` row may be inserted so there is a row to lock). Raises stable tokens: `invalid_arguments`, `user_not_found`, `role_missing`, `role_ambiguous`, `not_eligible` (the profile is a super_admin). Also adds the unique index `roles_name_key`. Never reads `raw_user_meta_data`. Entry #34 in `prodfix_00_APPLY_ORDER.md`. |
| `docs/sql/prodfix_00_APPLY_ORDER.md` | Section 9 (signup), the ordering constraints from the review (B1, S1), and the note that `local_00` is never applied to a hosted project. |
| `docs/sql/local_00_base_tables_reconstructed.sql` | **LOCAL ONLY.** Reconstructs `companies`, `tenants`, `profiles`, `roles`, `memberships`, `company_profiles` and the live-only helpers (`get_my_role`, `get_my_company_id`, `current_tenant_id`, `is_super_admin`) for `supabase start`, with every assumed NOT NULL commented with its source and the guesses tagged `GUESS(strict)`. Never apply it to the hosted project. |

### Route and pure logic

| File | What |
|---|---|
| `app/api/signup/route.ts` | `POST /api/signup`, `runtime = "nodejs"`, `force-dynamic`. Builds `SignupDeps` from the service-role admin client and `checkRateLimit`, origin from `publicAppOrigin(request.url)`. Answers exactly what `runSignup` returns, adds no headers. |
| `lib/auth/signup.ts` | `runSignup`: honeypot on the raw body, per-IP limit, Zod validation (400 with field errors), per-email limit, lookup via `find_auth_user_id_by_email`; existing confirmed address gets a magic link (`shouldCreateUser: false`), existing unconfirmed gets the invite re-sent, neither calls the RPC; new address: `createUser` (silent, no metadata), RPC, then `inviteUserByEmail` last. RPC failure runs `compensateCreatedUser` (delete, one retry, distinct orphan log with the user id) and answers the one 500 failure body. `SIGNUP_SENT_MESSAGE` and `SIGNUP_FAILED_MESSAGE` are the only bodies. |
| `lib/validation/signup.ts` | Zod v4 schema: `companyName`, `contactName`, `email` (lower-cased, trimmed), honeypot field `SIGNUP_HONEYPOT_FIELD`, unknown keys rejected, `describeSignupFieldErrors`. |
| `lib/rateLimit.ts` | `signupPerIp` (5 per hour) and `signupPerEmail` (3 per day), durable through `rate_limit_hit` (prodfix_01); allow-all until that RPC exists. |

### Pages and components

| File | What |
|---|---|
| `app/signup/page.tsx` | Client page, `ds ... bg-canvas font-sans text-ink`, follows the theme (decision 5). Company name, your name, email, honeypot; price from `pricingHeadline()` and `BILLING_BASIS_SENTENCE`, never a literal; links to `/login`, `/terms` and `/privacy`; "check your inbox" state on success using the server's message. |
| `components/dashboard/GettingStartedPanel.tsx`, `lib/dashboard/gettingStarted.ts`, `app/dashboard/page.tsx` | Admin-only panel with three steps (card at `/settings/billing`, first vehicle, first driver), hidden once all three exist. Counts: `company_billing` (RLS-scoped head count), `vehicles` and `drivers` by `tenant_id`. |
| `app/settings/billing/PaymentMethodCard.tsx`, `V1Billing.tsx` | `setupNotice` is now a required prop; V1 passes its own sentence explicitly, so a v2 company never reads "Your first charge is taken today". |
| `components/landing/Hero.tsx`, `LandingNav.tsx`, `PricingCard.tsx`, `Footer.tsx`, `app/login/page.tsx`, `app/components/TenantGate.tsx`, `components/landing/RequestAccessForm.tsx` | Every primary call to action now opens `/signup` (decision 6); the "Contact" anchor and the request-access form remain as the secondary "talk to us" path. The no-tenant panel offers both "Request access" and "Create a company", with copy saying a company needs an address with no account yet (review S3). |

### Registration and configuration

| File | What |
|---|---|
| `lib/auth/publicRoutes.ts` (+ test), `lib/auth/routeClassification.test.ts` | `/signup` and `/api/signup` public. |
| `lib/nav/themeableRoutes.ts` (+ test), `lib/nav/shouldShowShell.ts` (+ test) | `/signup` follows the theme and shows no console shell. |
| `README.md`, `CLAUDE.md` | Inventory row, auth paragraph and roadmap lines; the Auth section's signup sentence. |
| `supabase/config.toml`, `supabase/.gitignore`, `supabase/templates/invite.html`, `supabase/templates/magic_link.html` | The local stack. `[auth] enable_signup = false` (the hosted "Allow new users to sign up"); `[auth.email] enable_signup = true` is the email PROVIDER switch and must stay true or magic links stop. `[db.migrations] enabled = false` so nothing ever replays `supabase/migrations/`. Templates point at `/auth/confirm?token_hash=...&type=invite` and `type=email`. |
| `.env.local.signup-test` (gitignored, not in the diff) | Local keys that override the LIVE `.env.local` for the dev server. |

### Tests

| File | Covers |
|---|---|
| `lib/auth/signup.test.ts` (19 tests) | Byte-identical responses across new, existing confirmed, existing unconfirmed, honeypot and both limits; order of checks; branching; compensation, its retry and the orphan log; a lost `createUser` race; logs never carry the address. |
| `lib/auth/signupRoute.test.ts` | The route builds its link from `publicAppOrigin` and passes no `data:` to `createUser` or `inviteUserByEmail` (source-shape assertions). |
| `lib/validation/signup.test.ts`, `lib/rateLimit.test.ts`, `lib/dashboard/gettingStarted.test.ts` | Schema, limiter rules and buckets, panel logic and markup. |
| `tests/signup-happy-path.spec.mjs` | Playwright, local stack only: form, Mailpit invite, `/auth/confirm`, dashboard panel, billing wording, shell exemption, replayed token refused. Not part of `npm test`. |

### Documents

`docs/superpowers/specs/2026-09-16-self-serve-signup-design.md` (design, decisions 1 to 10 and
the two documented deviations), `docs/superpowers/plans/2026-09-16-self-serve-signup.md`,
`docs/superpowers/plans/PROMPT-self-serve-signup.md` (the task prompt),
`docs/superpowers/reviews/2026-09-16-self-serve-signup-review.md` (the independent review with a
resolution column), and this file.

## 2. What was tested and how

**Unit suite:** `npx vitest run --maxWorkers=4` (the default worker count trips timeouts in the
PDF, Square and planning tests while the local stack is running): 179 files, 2150 tests, green.
`npm run typecheck` clean. Both run after the phase 5 fixes.

**RPC proofs (local, psql in the `supabase_db_tms` container):** VERIFY 1 grants
(`anon` false, `authenticated` false, `service_role` true); VERIFY 2 index present; fresh user
answers `created` and `get_tenant_context()` for that user answers the tenant with role `admin`
(phase 2, `p2_proof.out`); second call answers `already_member` with the company count unchanged;
super_admin profile refused with `not_eligible` and nothing written; all rolled back
(`p5_rpc_reproof.out`).

**Browser happy path:** the Playwright spec, run against `next dev` on 3000 with the local keys.
Passed at phase 4 (seven screenshots) and again after phase 5 (`p5-shots/`). One flaky red on the
phase 5 re-run was the spec reading the billing page while its skeleton was up; the spec now
waits for the card notice.

**Adversarial pass (phase 4, re-run in full after phase 5, all 22 rows green):**

| Attack | Expected | Observed | Verdict |
|---|---|---|---|
| 1. same email, two concurrent requests | one auth user, one company, identical 200 bodies | users=1 companies=1 bodies_equal=True status=200/200 | green |
| 2a. existing UNCONFIRMED customer email | no new company, invite re-sent, body identical, tenant untouched | companies unchanged, newest mail "Finish setting up your TMS Wizzard account", body_equal=True | green |
| 2b. existing CONFIRMED customer email | no new company, magic link sent, body identical | companies unchanged, newest mail "Your TMS Wizzard sign-in link", body_equal=True | green |
| 3. per-email limit exhausted (4th request) | all 4 bodies identical 200, 3 emails sent, 4th sends nothing | bodies_equal=True statuses=[200,200,200,200] emails=3 hits=4 | green |
| 4. per-IP limit exhausted (6th request) | all 6 bodies identical 200; 6th creates no user | bodies_equal=True users_1st=1 users_6th=0 | green |
| 5. honeypot filled | identical 200 body, no auth user, no email | body_equal=True users=0 emails=0 | green |
| 6a. 200 KB body | 400, no crash, no user | status=400 field error, users=0 | green |
| 6b. malformed JSON | 400 Invalid request body | status=400 | green |
| 6c. wrong content type (text/plain, valid JSON) | no crash; either 400 or a normal signup | status=200, users=1 | green |
| 6d. unknown keys (role, tenant_id) | 400, no user | status=400 users=0 | green |
| 6e. empty strings | 400 with three field errors | fields=[companyName, contactName, email] | green |
| 6f. unicode and homoglyph company name | 200, stored verbatim | stored_matches=True | green |
| 6g. plus-addressed email | 200, one account | users=1 | green |
| 6h. uppercase then lowercase of one email | one auth user, one company, identical bodies | users=1 companies=1 bodies_equal=True | green |
| 7. RPC failure after auth user creation (EXECUTE revoked) | auth user deleted, zero rows, no email; 500 failure body (documented deviation) | status=500 users=0 companies=0 emails=0 | green |
| 8. forged next=//evil.com, https://evil.com, /api/billing/run | redirect stays on this origin | 303 to localhost:3000 in all three cases | green |
| 10a. REST rpc as anon | permission denied | 401 code 42501 | green |
| 10b. REST rpc as authenticated user | permission denied | 403 code 42501 | green |
| 12. GET /api/signup and POST with no body | 405 and 400, no 500 | GET=405 POST=400 | green |
| 13. /privacy and /terms | not built: edge gate redirects anonymous to /login?next= (SET-26) | privacy=307 /login?next=%2Fprivacy, terms=307 /login?next=%2Fterms | green |

Rows 9 (replayed invite token) and 11 (signed-in admin on `/signup`) live in the Playwright spec.
Evidence outside the repo: `C:\Users\ethan\AppData\Local\Temp\claude\C--Users-ethan-Desktop-tms\signup-evidence\`
(`adv.py`, `adv_table.md`, `adv_table_p4.md`, `p2_proof.out`, `p5_rpc_reproof.out`,
`diag_local_2026-09-16.csv`, `summary.txt`, the screenshots and `p5-shots/`).

**Independent review (phase 5):** a fresh-context reviewer with only the opening handoff, the
nine findings, the spec and the diff. One blocker, four should-fixes, fifteen notes. Every
blocker and should-fix is resolved or, where it is a deployment ordering matter, recorded in
section 4; the review file carries the resolution column.

## 3. What contradicted the opening handoff

- **"Send the email last" with `inviteUserByEmail` alone is impossible**: it sends on creation.
  The route uses `createUser` (silent) -> RPC -> `inviteUserByEmail`, and GoTrue accepts an invite
  for an existing unconfirmed user (verified locally). Spec, "Order of operations".
- **The 500 on RPC failure is not byte-identical.** The prompt's hard stop says every response is
  identical; the spec deliberately answers a failure body when the RPC fails after `createUser`,
  because a silent success on an account that no longer exists strands the customer. The
  reviewer graded it acceptable in steady state and an existence oracle only while
  `create_company_with_admin` is missing (S1), which section 4 prevents.
- **`/privacy` and `/terms` do not 404.** They are not public routes, so `proxy.ts` sends an
  anonymous visitor to `/login?next=...`. The spec's adversarial row now says so.
- **LandingNav has three `#request-access` references, not three buttons**: one is the "Contact"
  nav anchor, which decision 6 keeps as the secondary path. Two buttons were re-pointed.
- **The no-tenant panel cannot simply point at `/signup`** (handoff 3.4, decision 6): its audience
  is a signed-in address, which `/signup` answers with a magic link and no company (decision 8).
  The panel keeps both links and says so.
- **Contact name** is stored on `profiles.full_name` (decision 9): the diag showed the column
  exists and `company_profiles` has no contact-name column.
- **`[auth.email] enable_signup` in the CLI config is the email provider**, not the signup
  switch; it must stay `true`. The hosted "Allow new users to sign up" maps to `[auth]
  enable_signup`, which is `false`.
- **The reviewer's out-of-scope list**: the task prompt, the handoff, the local stack files, the
  Playwright spec, the dashboard panel files and `lib/rateLimit.test.ts` are not named in the
  handoff's Map table. All are outputs the prompt asks for or files the panel decision (3.4)
  requires; none is a refactor.

## 4. What remains manual before launch, in order

**SQL, in the order in `docs/sql/prodfix_00_APPLY_ORDER.md`.** None of it is applied in
production as of this handoff.

1. Apply entries 1 to 34 before the merge is deployed. Every landing call to action links
   `/signup`; with `find_auth_user_id_by_email` (prodfix_20), `rate_limit_hit` (prodfix_01) or
   `create_company_with_admin` (signup_01) missing, every "Get started" submit answers 500
   (review B1).
2. Apply `prodfix_20` (#3) and `signup_01` (#34) in the same sitting. Between them the route
   answers 200 to an existing address and 500 to a new one, an account-existence oracle, and
   each 500 creates and deletes an auth user (review S1).
3. Before marking #34 applied, run the VERIFY 3 block of `signup_01` (rolled back) on the hosted
   project. The RPC's column lists for `companies` and `tenants` were proven only against the
   local reconstruction (review N3).
4. `prodfix_30` must be applied, or a self-serve customer who never activates a licence runs
   free (BILL1-1).
5. Run `prodfix_89` (read-only) first; if it reports a `handle_new_user` trigger copying user
   metadata, replace it with the identity-only template in that file (SQL-13). Locally there
   was none.
6. `docs/sql/local_00_base_tables_reconstructed.sql` is never applied to a hosted project.

**Supabase dashboard.**

- Auth, Providers, Email: "Allow new users to sign up" OFF, and it stays off. The service-role
  client creates users regardless.
- Email templates: Invite `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
  (signup's confirmation email IS the invite template); Magic Link
  `.../auth/confirm?token_hash={{ .TokenHash }}&type=email`.
- URL configuration: the redirect allowlist accepts `/auth/confirm?next=...` (locally proven
  only with the `localhost:3000/**` wildcards, review N15).
- No OTP captcha: neither the login nor the signup route sends a token.
- Custom SMTP: the built-in sender's shared hourly cap cannot carry signups.

**Vercel:** `NEXT_PUBLIC_SITE_URL` (every email link), `CRON_SECRET` (still missing; billing never
runs without it), `SUPABASE_SERVICE_ROLE_KEY`.

**Launch blockers in the product.**

- `/privacy` and `/terms` (SET-26): linked from the signup form, not built, not registered; an
  anonymous click lands on `/login`. Content is needed before the first real signup.
- Known limitation (decision 8): an existing, confirmed account with no company cannot create
  one through `/signup`; it needs an operator.

## 5. Deferred review notes (each with its reason in the review file)

N3 hosted VERIFY 3 (section 4); N4 the dashboard card count is RLS-scoped and never exercised
end to end with a card added; N5 the per-IP limit runs before parsing, so a malformed over-limit
body still gets 400; N6 timing differs between a new and an existing address (same class as
`/api/auth/magic-link`); N7 and N8 two tests pin source shape rather than behaviour; N10 the
`<a>` to `<Link>` swaps; N11 the `shouldShowShell` reflow; N13 anyone can re-send an invite to
an unconfirmed address, three per day, invalidating its earlier link (same exposure as `/login`);
N14 the commented `@ts-ignore` on `react-dom/server` in one test instead of a new dependency;
N15 the local redirect wildcards.

## 6. Cost

Phases 0 to 4 ran in the session of 2026-09-16; their token and time estimates were posted in
the checkpoint reports of that session and are not recorded in the repo. Phases 5 and 6
(2026-09-17): the reviewer subagent used about 182k tokens over 10 minutes; the fix pass,
re-proofs, re-runs and this handoff about 250k tokens over roughly 90 minutes of wall clock.

## 7. Resuming locally

- Docker Desktop, then `npx -y supabase@2.117.0 start` from the repo root (the CLI is not
  installed globally). Ports: 54321 API, 54322 DB, 54324 Mailpit. The data volume persists
  through `supabase stop`; it holds 40-odd throwaway companies and users `founder@local.test`
  (unconfirmed) and several `happy-*@local.test` (confirmed admins).
- SQL: `docker exec -i supabase_db_tms psql -U postgres -d postgres < file.sql` (no psql on the
  host). Applied locally per `summary.txt`: 40 of the 50 files; the 10 refusals are files whose
  tables `local_00` does not reconstruct (accounts, quotations, POD evidence, planning
  itineraries, positions, tachograph) plus `prodfix_83` (storage policies belong to the
  dashboard). `signup_01` re-applied after phase 5.
- Dev server: `set -a; . ./.env.local.signup-test; set +a; npm run dev`. Never load `.env.local`
  into anything that writes: it points at the LIVE project.
- `next dev` on Next 16.3.5 appends an agent-rules block (with an em-dash) to `CLAUDE.md` on every
  start; `git checkout -- CLAUDE.md` before committing.
- `npx vitest run --maxWorkers=4` while the stack is up.
