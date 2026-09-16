# Self-Serve Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, stopping at the checkpoints the task prompt defines. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor creates a company, its first tenant and their own admin profile from `/signup`, verifies by email through the existing confirm page, and lands on a dashboard that tells them what to do next. Proven against the local Supabase stack from checkpoint 0 before it goes anywhere.

**Architecture:** One SECURITY DEFINER RPC does every database write in a single transaction. One service-role route orders the three admin calls so the email is genuinely last, and puts every decision in a pure `lib/auth/signup.ts` that the tests drive with fakes. The page and the dashboard panel are thin. Nothing new reads user metadata, nothing new touches `company_billing`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (GoTrue admin API, PostgREST, RLS), Zod v4, vitest, Playwright (already under `tests/`), the `ds` design system.

**Spec:** `docs/superpowers/specs/2026-09-16-self-serve-signup-design.md`. Read it first; every number and every ordering below comes from it. Prompt: `docs/superpowers/plans/PROMPT-self-serve-signup.md`, whose hard stops apply to every task.

---

## Before you start

- **`npm test` collects `lib/**/*.test.ts` only.** Decisions worth asserting go in `lib/`. The panel's render test imports the component from `lib/` and renders it with `react-dom/server`.
- **`npm run typecheck` is the gate.** No lint script.
- **The local stack is the only database.** `docker exec -i supabase_db_tms psql -U postgres -d postgres` runs SQL; print the target first. `.env.local.signup-test` holds the local keys; `.env.local` is LIVE and is never loaded into anything that runs SQL or admin calls.
- **Byte-identical success body.** Every accepted request, whatever branch it took, returns exactly `signupSentResponse()`. Never construct that JSON anywhere else.
- **No `data:` on `createUser` or `inviteUserByEmail`.** Tenant, company and role are RPC arguments (SQL-13).
- **Outbound origin is `publicAppOrigin(request.url)`.** `lib/accounts/publicLinks.test.ts` fails otherwise.
- **No em-dashes** anywhere.
- Commit after each task, small and described. No push.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `docs/sql/signup_01_create_company_with_admin.sql` | The RPC and the `roles.name` unique index |
| `lib/validation/signup.ts` | Zod schema, honeypot field name and detector |
| `lib/validation/signup.test.ts` | Boundaries, unknown keys, honeypot |
| `lib/auth/signup.ts` | Constant responses, `runSignup(deps, input)` |
| `lib/auth/signup.test.ts` | Branching, ordering, compensation, parity |
| `app/api/signup/route.ts` | Wires Supabase into `runSignup` |
| `app/signup/page.tsx` | The form and its states |
| `lib/dashboard/gettingStarted.ts` | Steps and the complete rule |
| `lib/dashboard/gettingStarted.test.ts` | Step logic and the rendered panel |
| `components/dashboard/GettingStartedPanel.tsx` | The three-step card |
| `tests/signup-happy-path.spec.mjs` | Browser run against the local stack |
| `docs/superpowers/reviews/2026-09-16-self-serve-signup-review.md` | Phase 5 reviewer output |
| `docs/handoffs/2026-09-16-self-serve-signup-closing.md` | Phase 6 |

**Modified:**

| File | Change |
|---|---|
| `docs/sql/prodfix_00_APPLY_ORDER.md` | `signup_01` after the series; manual steps |
| `lib/rateLimit.ts` | `signupPerIp`, `signupPerEmail` |
| `lib/rateLimit.test.ts` | the two rules (create the file if there is none) |
| `app/dashboard/page.tsx` | three counts and the panel |
| `app/settings/billing/PaymentMethodCard.tsx` | `setupNotice` required |
| `app/settings/billing/V1Billing.tsx` | passes the v1 sentence |
| `components/landing/{Hero,LandingNav,PricingCard,Footer,RequestAccessForm}.tsx` | CTAs |
| `app/login/page.tsx`, `app/components/TenantGate.tsx` | links |
| `lib/auth/publicRoutes.ts` + test, `lib/auth/routeClassification.test.ts` | registration |
| `lib/nav/themeableRoutes.ts` + test, `lib/nav/shouldShowShell.ts` + test | registration |
| `README.md`, `CLAUDE.md` | the lines the handoff names |

---

## Phase 2: SQL

### Task 2.1: Write `signup_01_create_company_with_admin.sql`

**Files:** create `docs/sql/signup_01_create_company_with_admin.sql`

- [ ] Header: what the function must never do (metadata, client EXECUTE, `company_billing`), the prodfix_20 dependencies (`prodfix_role_id`, roles seeded), and "safe to re-run".
- [ ] `begin;` then `create unique index if not exists roles_name_key on public.roles (name);`
- [ ] The function per the spec's signature, order of writes and outcomes. `for update` on the profile row. `full_name` only when null.
- [ ] `revoke all ... from public, anon, authenticated; grant execute ... to service_role;` then `commit;`
- [ ] A commented verify block: grants, index, and a rolled-back dry run.

### Task 2.2: Apply and prove it on the local stack

- [ ] Print the target (`select inet_server_addr(), current_setting('port')`) and confirm local.
- [ ] Apply the file.
- [ ] Create a throwaway auth user with SQL (`insert into auth.users (id, instance_id, aud, role, email, ...)` as the Supabase seed does) or through the local admin API with curl and the service key.
- [ ] Prove `created`, then `get_tenant_context()` under `set local role authenticated` with `request.jwt.claims` for that user answers `ready`, role `admin`, one tenant named after the company.
- [ ] Prove the second call answers `already_member` and the company count is unchanged.
- [ ] Prove `set local role authenticated; select public.create_company_with_admin(...)` is `permission denied`, and the same for `anon`.
- [ ] Prove atomicity: in a transaction, create a temporary copy of the function whose role name is `'no-such-role'`, call it, catch the error, and show zero rows in companies, tenants, company_profiles, users, profiles, memberships for that user.
- [ ] Paste every query and its output into checkpoint 2.

### Task 2.3: Apply order doc

**Files:** modify `docs/sql/prodfix_00_APPLY_ORDER.md`

- [ ] Add a "9. Self-serve signup" section listing `signup_01` after prodfix_93, with what it needs (prodfix_01, prodfix_20, prodfix_88).
- [ ] Add to the dashboard steps anything from the handoff's section 4 that is missing: custom SMTP, `NEXT_PUBLIC_SITE_URL`, the magic-link template type, the local-only note for `local_00`.
- [ ] Commit: "Add the create_company_with_admin RPC for self-serve signup".

---

## Phase 3: Route, page, panel, registration

### Task 3.1: Validation

**Files:** create `lib/validation/signup.ts`, `lib/validation/signup.test.ts`

- [ ] `SIGNUP_HONEYPOT_FIELD = "companyWebsite"`; `isHoneypotTriggered(body: unknown): boolean`.
- [ ] `SignupValidation = z.strictObject({ companyName, contactName, email, companyWebsite: optional })` with the spec's bounds; email lowercased after trim.
- [ ] Tests: accept and normalise; each boundary; unknown key; honeypot present and empty is fine, non-empty detected.
- [ ] Commit.

### Task 3.2: Rate limit rules

**Files:** modify `lib/rateLimit.ts`; create or extend `lib/rateLimit.test.ts`

- [ ] Add `signupPerIp` and `signupPerEmail` with the spec's numbers and a comment citing the request-access rules.
- [ ] Assert the numbers in a test.
- [ ] Commit.

### Task 3.3: Pure signup logic

**Files:** create `lib/auth/signup.ts`, `lib/auth/signup.test.ts`

- [ ] `SIGNUP_SENT_MESSAGE`, `signupSentResponse()`, `signupFailedResponse()`, `invalidBodyResponse()`, `fieldErrorsResponse(fieldErrors)`: each returns `{ status, body }`.
- [ ] `SignupDeps` type (see spec) and `runSignup(deps, { email, companyName, contactName, honeypot, ipKey })`, which performs steps 3 to 9 of the route order using only `deps`.
- [ ] Tests per the spec's matrix. Assert `JSON.stringify(body)` equality across the parity cases and record every call's arguments to assert no `data`, `tenant`, `company` or `role` key reaches `createUser` or `sendInvite`.
- [ ] Commit.

### Task 3.4: The route

**Files:** create `app/api/signup/route.ts`

- [ ] Copy the shape of `app/api/auth/magic-link/route.ts`: runtime, dynamic, `publicAppOrigin`, admin client guard, JSON parse guard.
- [ ] Build `deps` from the admin client: `find_auth_user_id_by_email`, `getUserById`, `createUser({ email, email_confirm: false })`, `deleteUser`, `create_company_with_admin`, `inviteUserByEmail(email, { redirectTo: confirmRedirectUrl(origin, "/dashboard") })`, `signInWithOtp` on an anon client with `shouldCreateUser: false`.
- [ ] Return `NextResponse.json(body, { status })` from whatever `runSignup` answers.
- [ ] Run the suite; `lib/accounts/publicLinks.test.ts` and `routeClassification.test.ts` will fail until Task 3.8. Commit with the registration test failure noted, or fold 3.8's `PUBLIC_ROUTES` edit into this commit.

### Task 3.5: The page

**Files:** create `app/signup/page.tsx`

- [ ] Skeleton from `app/login/page.tsx`; fields, honeypot, copy and states per the spec; `pricingHeadline()` and `BILLING_BASIS_SENTENCE` imported, no literal price.
- [ ] Client validation mirrors the schema (a shared `describeSignupFieldErrors` in `lib/validation/signup.ts` keeps them identical).
- [ ] Commit.

### Task 3.6: Getting-started panel and the billing default

**Files:** create `lib/dashboard/gettingStarted.ts`, `lib/dashboard/gettingStarted.test.ts`, `components/dashboard/GettingStartedPanel.tsx`; modify `app/dashboard/page.tsx`, `app/settings/billing/PaymentMethodCard.tsx`, `app/settings/billing/V1Billing.tsx`

- [ ] `buildGettingStartedSteps`, `isGettingStartedComplete`.
- [ ] The component: `Card` with three rows, done state, links, `CARD_SETUP_SENTENCE`; returns `null` when complete.
- [ ] Dashboard: after the main load, three head counts; render the panel above the KPI grid when `tenant.role === "admin"`.
- [ ] `PaymentMethodCard`: `setupNotice: string` required; `V1Billing` passes the v1 sentence verbatim.
- [ ] Tests: steps and a `renderToStaticMarkup` render.
- [ ] Commit.

### Task 3.7: CTAs

**Files:** the eight files in the spec's re-pointing table

- [ ] Each change exactly as the table says; nothing else in those files moves.
- [ ] Commit.

### Task 3.8: Registration

**Files:** the checklist in the spec

- [ ] `publicRoutes.ts` entries with comments; both tests; `themeableRoutes.ts` and its verbatim list; `shouldShowShell.ts` and its test; `README.md` (page inventory row, auth paragraph, two roadmap lines); `CLAUDE.md` sentence.
- [ ] `npm test` and `npm run typecheck` green.
- [ ] Commit. Checkpoint 3: diff stat, suite result, list of any file outside scope.

---

## Phase 4: Tests, browser run, adversarial pass

### Task 4.1: Fill any test gap from phase 3

- [ ] Compare the spec's vitest matrix with what exists; add what is missing.

### Task 4.2: Browser happy path

**Files:** create `tests/signup-happy-path.spec.mjs`

- [ ] `next dev` with the local variables exported in the shell (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`) so they override `.env.local`.
- [ ] Playwright: fill and submit `/signup`, poll Mailpit's API (`http://127.0.0.1:54324/api/v1/messages`) for the invite, extract the link, open it, press Continue, assert `/dashboard` with three undone steps, then `/settings/billing` with no v1 wording. Screenshots to the scratchpad.
- [ ] SQL: `get_tenant_context()` for the new user under `set local role authenticated`.
- [ ] Record the steps and evidence for checkpoint 4.

### Task 4.3: Adversarial pass

- [ ] Run the thirteen rows with curl against `next dev` and SQL against the local stack; record attack / expected / observed / verdict.
- [ ] Any red row: fix within scope, re-run the row and the suite, or stop and report.

---

## Phase 5: Independent review

- [ ] Spawn a fresh reviewer subagent with only: the handoff, the review findings list, the spec, and `git diff main...feat/self-serve-signup`. Brief per the prompt. It writes `docs/superpowers/reviews/2026-09-16-self-serve-signup-review.md` and edits nothing.
- [ ] Fix every blocker and should-fix; re-run the suite and the affected adversarial rows; append a resolution column. Address or defer notes with a reason.

---

## Phase 6: Closing handoff

- [ ] `docs/handoffs/2026-09-16-self-serve-signup-closing.md` per the prompt.
- [ ] Final `npm test`, clean `git status`, `supabase stop`, final report.
