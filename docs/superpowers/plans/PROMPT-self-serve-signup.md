# Task: self-serve signup, built on a branch and proven before it goes anywhere

You are working in this repository on branch `feat/self-serve-signup`, created from `main` at `a59c954`. Your job is to build self-serve signup end to end, test it against a local Supabase stack, have the work independently reviewed, and then stop with the branch committed locally. Do not push. Do not open a PR. Do not merge. A human reviews the branch by hand after you stop.

Read these before doing anything else, in this order:

1. `CLAUDE.md`
2. `README.md`
3. `docs/superpowers/handoffs/2026-09-16-self-serve-signup.md` (the handoff; every file path, line number and trap in it is authoritative unless the code has moved, in which case find where it moved and say so in your spec)
4. `docs/superpowers/reviews/2026-09-14-production-readiness-review.md`, findings AUTH-2, AUTH-5, AUTH-7, AUTH-9, AUTH-11, AUTH-17, SQL-13, BILL1-1, SET-26
5. `docs/sql/prodfix_00_APPLY_ORDER.md`
6. `docs/superpowers/specs/2026-07-22-landing-redesign-design.md` section 0, and `2026-09-11-v2-billing-ui-and-pricing-design.md` section 7

The handoff lists six open decisions. They are all decided below. Do not reopen them.

## Decisions (final)

| # | Decision | Answer |
|---|---|---|
| 1 | Flow order | Company first. The form collects company name, your name and email. `POST /api/signup` creates the auth user, the company, the tenant, the company profile and the founding admin profile in one go, then sends the email last. |
| 2 | First run | After confirm, `next` stays `/dashboard`. Add a getting-started panel to `/dashboard` with three steps, each linking out: add a card (`/settings/billing`), add a vehicle, add a driver. The panel shows until all three exist. A card is not required to browse the console; vehicle activation remains blocked without a card, which is existing behaviour. |
| 3 | Bot control | Honeypot plus per-IP and per-email rate limits, the same level as `/api/request-access`. No Turnstile. |
| 4 | Legal (SET-26) | Link only. The signup form links to `/privacy` and `/terms`. Do not build those pages. Do not register them as routes. Record in the closing handoff that they are a launch blocker. |
| 5 | Theme | `/signup` follows the theme like `/login`. Register it in `lib/nav/themeableRoutes.ts`. |
| 6 | Lead flow | Keep the request-access form and `/super-admin/requests`. Re-point every primary CTA to `/signup`: `Hero.tsx`, `LandingNav.tsx` (all three), `PricingCard.tsx`, `Footer.tsx`, the login page's "No account yet?" link, and `TenantGate.tsx`'s recovery link. Replace the "Self-serve signup is coming soon" copy in `RequestAccessForm.tsx` with copy that positions it as a secondary "talk to us" path. |
| 7 | Auth user creation | `admin.auth.admin.inviteUserByEmail` with `redirectTo` on `/auth/confirm`, exactly as `app/api/settings/users/invite/route.ts` does. The link arrives as `type=invite`, which `lib/auth/confirm.ts` already accepts. |
| 8 | Existing email | If `find_auth_user_id_by_email` returns a user, do not create a company. Send that address an ordinary magic link via the same helper `/api/auth/magic-link` uses, and return the identical neutral response. |
| 9 | Contact name | Run the diag script first. If `profiles` or `company_profiles` already has a display or contact name column, use it. Otherwise store it on `company_profiles` as the primary contact name. State which column you chose and why in the spec. |
| 10 | Pricing copy | Import `pricingHeadline()` and the other helpers in `lib/billing/pricingCopy.ts`. Never hard-code a price. |

## Hard stops

Violating any of these ends the task. Stop, report, and wait.

- **Never run SQL, migrations, `supabase db push`, `supabase link`, or any admin API call against a non-local Supabase project.** The only permitted database is the one started by `supabase start` on this machine (`127.0.0.1` / `localhost`, ports 543xx). Before every command that takes a database URL or Supabase URL, print the target and confirm it is local. If any `.env*` file contains a hosted Supabase URL or a production service-role key, do not load it into a process that runs SQL. Create `.env.local.signup-test` (gitignored) for the local stack and use only that.
- **Never enable "Allow new users to sign up" anywhere**, including the local `config.toml`. The service-role client creates users regardless of it. `supabase.auth.signUp` must not appear in browser code.
- **Do not touch files outside the scope below.** In-scope: the files named in the handoff's sections 3.1 to 3.5 and its Map table, the new files this task creates, the docs listed under "Documents to write", and `README.md` / `CLAUDE.md` for the exact lines the handoff names. Everything else is out of scope. If you believe a change outside scope is required, stop at the next checkpoint and ask; do not make it.
- **Do not refactor, rename, reformat or "tidy" existing code** you pass through. A diff line that is not required by this feature is a defect.
- **Do not delete or rewrite existing tests** to make them pass. If a test fails because of this feature, either the feature is wrong or the test's fixture list needs the new route added (the registration checklist covers this). Nothing else.
- **Do not read `raw_user_meta_data` for tenant, company or role** anywhere in new code (SQL-13). Tenant, company and role come from RPC arguments controlled by the service-role route. The invite route still writes `tenant_id` and `role` into `data:` for compatibility; do not copy that into signup.
- **Do not build outbound links from the request host.** Use `publicAppOrigin(request.url)` from `lib/accounts/appUrl.ts`. `lib/accounts/publicLinks.test.ts` fails otherwise.
- **Every response from `/api/signup` must be byte-identical** whether the email is new, already a customer, rate limited by email, or caught by the honeypot. Same status, same body, same headers you control. `MAGIC_LINK_SENT_MESSAGE` is the model.
- **No em-dashes** in code, comments, copy, commit messages or docs. Use commas, full stops or parentheses.
- **No `git push`, no PR, no merge, no force operations, no history rewriting.** Commit locally in small logical steps with clear messages.
- **No new dependencies** without stopping to ask. Zod v4 and the Supabase client are already present. Playwright is permitted only if the repo already has it; otherwise ask at the checkpoint.

## Working method: checkpoints

Work in the six phases below. At the end of each phase, stop and post a checkpoint report, then wait for approval before starting the next phase. Each checkpoint report contains: what was done, what was skipped and why, every file touched, test results, anything you learned that contradicts the handoff, and an estimate of the tokens and wall-clock time spent on that phase.

### Phase 0: preflight and local stack

1. Confirm the branch: `git status` clean, on `feat/self-serve-signup`, from `a59c954`. Run the full test suite once and record the baseline (expected 174 files, 2087 passing).
2. Confirm Docker is running and the Supabase CLI is available. If either is missing, stop and say exactly what to install.
3. `supabase init` if the repo has no `supabase/` directory (check first; do not overwrite one). `supabase start`. Record the local API URL, anon key, service-role key and the Inbucket (or Mailpit) URL in `.env.local.signup-test`, and add that filename to `.gitignore` if it is not already covered.
4. In `supabase/config.toml`, confirm `[auth] enable_signup = false` and that `site_url` and `additional_redirect_urls` allow `http://localhost:3000/auth/confirm`. Set the local invite and magic link email templates to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` and `...&type=magiclink` respectively (the handoff's section 4 template).
5. The base tables (`companies`, `tenants`, `profiles`, `roles`, `memberships`, `company_profiles`) have no DDL in the repo. Reconstruct them for the local stack from every source of truth available: the `rls_*` and `prodfix_*` comments, `docs/sql/diag_2026_09_14_live_state.sql`, and the TypeScript types. Write this as `docs/sql/local_00_base_tables_reconstructed.sql` with a header stating it is a reconstruction for local testing only and must never be applied to a hosted project. Every NOT NULL you assume must be commented with where you got it. Where you cannot tell, choose the stricter option and flag it in the checkpoint.
6. Apply, in the order given by `prodfix_00_APPLY_ORDER.md`: the reconstruction, the `rls_*` series, `billing_06` and `billing_07`, then the `prodfix_*` series. `prodfix_89` is a read-only probe; run it and paste its output into the checkpoint. If it reports a `handle_new_user`-style trigger copying user metadata, replace it with the identity-only template in that file.
7. Seed the `roles` table with `admin`, `staff`, `driver` if the prodfix seeds did not. Confirm `roles.name` is unique; if not, note it (phase 1 adds the index).
8. Run the diag script against the local stack and paste the column facts for the six base tables into the checkpoint. This is what phase 1 is built on.

Checkpoint 0 must include the diag output and the reconstruction SQL for review.

### Phase 1: spec and plan

Write `docs/superpowers/specs/2026-09-16-self-serve-signup-design.md` and `docs/superpowers/plans/2026-09-16-self-serve-signup.md`, matching the structure and tone of the existing specs and plans in those directories. The spec restates the decisions table above, resolves decision 9 with the actual column, defines the `create_company_with_admin` signature and return values, defines the `/api/signup` request and response contract, the Zod schema, the two new `RATE_LIMITS` rules with their numbers (justify them against the request-access rules), the `/signup` page states, the getting-started panel's show/hide rule, and the full test matrix from phase 4. The plan breaks phases 2 to 5 into ordered tasks with the files each touches.

Checkpoint 1 is the two documents. Nothing else is written in this phase.

### Phase 2: SQL

Write `docs/sql/signup_01_create_company_with_admin.sql`:

- `create_company_with_admin(p_user_id uuid, p_email text, p_company_name text, p_contact_name text default null)`. SECURITY DEFINER, owned by `postgres`, `search_path` pinned, EXECUTE revoked from PUBLIC and granted to `service_role` only. Follow the `prodfix_20` preamble pattern exactly.
- In one transaction, in this order: `companies`, `tenants` (name defaults to the company name), `company_profiles` (its `tenant_id` column holds the COMPANY id, set `company_name` and the contact column chosen in phase 1), `public.users (id, email)`, `profiles` (`tenant_id`, `company_id` = the tenant's company, `role_id` = `prodfix_role_id('admin')`), then `memberships` for compatibility only.
- Idempotency: if `p_user_id` already has a profile with a company, return `already_member` and create nothing. Return `created` otherwise. Use the same text-return convention as `provision_tenant_user`.
- Add a unique index on `roles.name` if one does not exist (guarded `create unique index if not exists`).
- Add a comment block at the top stating what the function must never do: read `raw_user_meta_data`, be callable by `authenticated` or `anon`, or insert into `company_billing` (that row is created only by the card route, so the v2 billing model is written; the DB default is still `v1_immediate`).
- Append `signup_01` to `prodfix_00_APPLY_ORDER.md` after the prodfix series, and add the manual steps from the handoff's section 4 to that file's manual section if they are not already there.

Apply it to the local stack. Then, with `psql` or the SQL editor against local only, prove: a fresh user gets `created` and `get_tenant_context()` for that user answers with the tenant and role `admin`; calling again returns `already_member` with no second company; calling as `authenticated` is refused; a failure mid-transaction (force one by passing a role name that does not exist in a temporary copy of the function, or by a deliberately violated constraint) leaves zero rows in every table. Paste the queries and their output into the checkpoint.

### Phase 3: route, page, panel, registration

Build in this order, committing after each:

1. `lib/validation/signup.ts` (Zod v4, modelled on `requestAccess.ts`): `companyName` (trimmed, 2 to 120 chars), `contactName` (trimmed, 1 to 120), `email` (lowercased, trimmed, email), honeypot field with the same name and handling as request-access. Reject unknown keys.
2. `lib/rateLimit.ts`: `signupPerIp` and `signupPerEmail` with the numbers from the spec.
3. `app/api/signup/route.ts`, copying the shape of `app/api/auth/magic-link/route.ts` and `app/api/request-access/route.ts`: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, origin from `publicAppOrigin`, parse, honeypot returns the constant success response, rate limit per IP (`leadClientKey`) then per email, `find_auth_user_id_by_email`, branch on existing user (magic link, constant response), else `inviteUserByEmail` with `redirectTo` on `/auth/confirm` and NO tenant/company/role in `data:`, then `create_company_with_admin`, and on any failure after user creation delete the auth user (compensation, as the invite route does at `:171-174`), and only then return. Send the email last: since `inviteUserByEmail` sends on creation, order it so the RPC runs first where the client allows, or document in the spec why the invite must precede the RPC and how compensation covers the gap. Put pure logic (branching, response building) in `lib/auth/signup.ts` so it is unit-testable without the Supabase client, mirroring `lib/auth/magicLink.ts`.
4. `app/signup/page.tsx`: client component, same skeleton as `app/login/page.tsx`, root `className="ds ... bg-canvas font-sans text-ink"`, `Field`, `Button`, `MessageBanner`. Fields: company name, your name, email, hidden honeypot. Shows `pricingHeadline()`, a "Already have an account? Log in" link to `/login`, and "By continuing you agree to our terms and privacy notice" linking to `/terms` and `/privacy`. On success render the check-your-inbox state in place; no redirect. Disable the button while submitting. Client-side validation mirrors the Zod schema but the server is authoritative.
5. Getting-started panel on `/dashboard`: a component under `components/` that receives counts of cards, vehicles and drivers for the current tenant, renders three steps with done/undone state, links to `/settings/billing`, the vehicles page and the drivers page, and hides when all three are satisfied. Its billing copy must be v2: no charge is taken now, billing starts when the first vehicle licence is activated, and the minimum is taken from the rate card helpers. Fix the v1 default notice at `PaymentMethodCard.tsx:78` so a v2 company (no `company_billing` row, or `billing_model = 'v2_period'`) never sees "Your first charge is taken today".
6. CTA re-pointing per decision 6.
7. Registration checklist, all of it: `lib/auth/publicRoutes.ts` (`PUBLIC_EXACT`: `/signup`, `/api/signup`), `publicRoutes.test.ts`, `routeClassification.test.ts` (`PUBLIC_ROUTES`), `lib/nav/themeableRoutes.ts` and its test, `lib/nav/shouldShowShell.ts` (`/signup` exemption), `README.md` (page inventory row, auth paragraph, roadmap lines), `CLAUDE.md` (the "Self-service signup does not exist yet" sentence).

Run the full suite. Checkpoint 3 includes the diff stat and the suite result. Any file touched outside the in-scope list is listed separately with justification.

### Phase 4: tests, browser run, adversarial pass

**Unit and integration (Vitest), all committed:**

- `lib/validation/signup.test.ts`: accepts valid input; rejects each field's boundaries; rejects unknown keys; honeypot presence detected.
- `lib/auth/signup.test.ts`: response is byte-identical across new email, existing email, honeypot, per-email rate limit; existing user path calls magic link and never the RPC; new user path calls invite then RPC; RPC failure calls delete on the auth user with the id returned by invite; delete failure is logged and the response is still the constant one; no `data:` payload contains tenant, company or role.
- `app/api/signup/route.test.ts` (if the repo tests route handlers this way; otherwise fold into the above): per-IP limit hit before per-email; origin comes from `publicAppOrigin`.
- Registration tests updated per the checklist; `publicLinks.test.ts` passes.
- Panel component test: renders three steps, marks done ones, hides when complete, never renders the v1 charge sentence.

**Browser happy path, against the local stack, `next dev` on port 3000:**

Fill `/signup` with a fresh email, submit, read the invite email from Inbucket, open the link, confirm on `/auth/confirm`, land on `/dashboard`, verify the getting-started panel shows three undone steps and `get_tenant_context()` for that user returns the new tenant with role `admin`. Then open `/settings/billing` and confirm the v2 body and card form render with no v1 wording. If the repo already has Playwright, commit this as a test under the existing e2e directory wired to the local env file; if it does not, run it manually (or with the Chrome tooling available to you) and record every step with a screenshot in the checkpoint.

**Adversarial pass, against the local stack, each result recorded in a table (attack, expected, observed, verdict):**

1. Same email submitted twice in quick succession (two concurrent requests): exactly one company, one auth user, identical responses.
2. Email of an existing customer: no new company, magic link sent, identical response, and the existing tenant untouched.
3. Per-email rate limit exhausted: identical response, no email sent beyond the limit.
4. Per-IP rate limit exhausted: identical response.
5. Honeypot filled: identical response, no auth user, no email.
6. Oversized body (200 KB), malformed JSON, wrong content type, unknown keys, empty strings, unicode and homoglyph company names, `+` addressing and uppercase emails: nothing crashes, nothing creates a row it should not, uppercase and lowercase of the same email are one account.
7. RPC failure after invite (simulate by temporarily revoking EXECUTE or renaming the role): auth user deleted, zero rows, identical response.
8. Forged `next` on the confirm link (`//evil.com`, `https://evil.com`, `/api/...`): `safeAuthNextPath` sends to `/dashboard`.
9. Replaying a used invite token: refused by Supabase, page shows the existing error state, no second session.
10. Calling `create_company_with_admin` as `anon` and as `authenticated` via the REST endpoint: permission denied.
11. Signed-in admin visiting `/signup`: no console shell chrome, page renders (per `shouldShowShell`).
12. Unauthenticated `GET /api/signup` and `POST` with no body: no 500s; proxy allows the path.
13. Confirm `/privacy` and `/terms` currently 404 and that this is listed as a launch blocker in the closing doc.

Checkpoint 4 is the suite result, the browser record, and the adversarial table. Any red row is fixed and re-run before the checkpoint is posted; if it cannot be fixed within scope, it is reported red with a proposed fix and you stop.

### Phase 5: independent review

Spawn a separate reviewer subagent with fresh context. Give it only: the handoff, the review findings list, the spec, and `git diff main...feat/self-serve-signup`. Its brief: audit the diff against every trap in the handoff's section 6, every review finding named above, and every hard stop in this prompt; check the SQL against SQL-13 and the profiles guard; check enumeration parity by reading the route, not trusting the tests; look for out-of-scope changes; and write `docs/superpowers/reviews/2026-09-16-self-serve-signup-review.md` with findings graded blocker / should-fix / note, each with file and line. The reviewer does not edit code.

Fix every blocker and should-fix, re-run the full suite and the adversarial rows the fix touches, and append a "resolution" column to the reviewer's file. Notes are addressed or explicitly deferred with a reason.

### Phase 6: closing handoff and stop

Write `docs/superpowers/handoffs/2026-09-16-self-serve-signup-closing.md` in the style of the opening handoff: what was built, file by file; what was tested and how, with the adversarial table; what remains manual before launch (Supabase dashboard: signup off, email templates, redirect allowlist, custom SMTP; Vercel: `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`; apply order for production SQL including that the reconstruction file is local-only; `/privacy` and `/terms` are launch blockers; `prodfix_30` must be applied or self-serve customers run free); anything that contradicted the opening handoff; and the total token and time cost across phases.

Run the full suite one final time. `git status` must be clean, every commit on `feat/self-serve-signup`, nothing pushed. `supabase stop`. Post the final report and stop.

## Documents to write (summary)

| Path | Phase |
|---|---|
| `docs/sql/local_00_base_tables_reconstructed.sql` | 0 |
| `docs/superpowers/specs/2026-09-16-self-serve-signup-design.md` | 1 |
| `docs/superpowers/plans/2026-09-16-self-serve-signup.md` | 1 |
| `docs/sql/signup_01_create_company_with_admin.sql` | 2 |
| `docs/sql/prodfix_00_APPLY_ORDER.md` (edit) | 2 |
| `docs/superpowers/reviews/2026-09-16-self-serve-signup-review.md` | 5 |
| `docs/superpowers/handoffs/2026-09-16-self-serve-signup-closing.md` | 6 |

## Definition of done

The branch is ready only when all of the following are true: full suite green including all new tests; the browser happy path completed against local Supabase with evidence; every adversarial row green or explicitly accepted by the human at a checkpoint; the reviewer's blockers and should-fixes resolved; every item in the registration checklist done; no file outside scope changed; no em-dashes anywhere in the diff; nothing pushed; `supabase stop` run; the closing handoff written. Anything short of that, report it as not ready and say exactly what is missing.
