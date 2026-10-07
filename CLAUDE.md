# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TMS Wizzard: a multi-tenant Transport Management System (SaaS, billed every 4 weeks) for UK/EU road-haulage
operators — jobs, proof of delivery, invoicing, fleet/driver/compliance tracking, telematics. Next.js 16 (App
Router) + React 19 + TypeScript, backed by Supabase (Postgres, Auth, Storage), deployed on Vercel.

**Read `README.md` first** — it documents the full page inventory (with per-page status: OK / PARTIAL / LAUNCHER
/ STUB / PLANNED), the tech stack, environment variables, and the roadmap. Do not duplicate that content here;
this file covers commands and cross-file architecture only. `README.md` is well-maintained — keep it in sync
when you change page status, integrations, or the tenancy model.

## Commands

```bash
npm install
npm run dev         # http://localhost:3000
npm run build        # production build
npm run start
npm run typecheck    # next typegen && tsc --noEmit
npm test             # vitest run — runs all lib/**/*.test.ts
```

- Run a single test file: `npx vitest run lib/pod/podUrl.test.ts`
- Run tests matching a name: `npx vitest run -t "some test name"`
- Watch mode: `npx vitest` (no `run`)
- There is no `lint` script; `npm run typecheck` is the fast correctness gate before committing.
- Tests are colocated as `*.test.ts` next to the module they cover (e.g. `lib/tenant/context.test.ts`), not in a
  separate `__tests__` tree. Only `lib/` is covered by vitest (`vitest.config.ts` includes `lib/**/*.test.ts`
  only — nothing under `app/` runs through this).
- `vitest.config.ts` pins `TZ=Europe/London`. This is deliberate: several tests (`lib/time.test.ts`,
  `lib/theme/contrast.test.ts`) are timezone-sensitive and would silently pass under a UTC runner even if broken.
  Don't "fix" a failing test by changing the timezone.
- `tests/` is a **separate** npm project (its own `package.json`/`node_modules`) holding Playwright layout specs
  (`pod-layout.spec.mjs`, `tracking-layout.spec.mjs`), not part of the root `npm test` run.
- `next.config.ts` holds security response headers ONLY (frame blocking, nosniff, referrer and permissions
  policy). Keep other build behaviour out of it. The edge auth gate lives in `proxy.ts` at the repo root:
  Next 16 renamed `middleware.ts` to `proxy.ts`, so searching for `middleware` finds nothing.
- `proxy.ts`'s `matcher` is a plain string compiled by Next, so a regex dot must be written `\\.`. Written
  `\.` it becomes `.`, and the gate silently ran on `/` only until 2026-09-14.
  `lib/auth/proxyMatcher.test.ts` guards this.
- `scripts/legal/convert-policies.py` regenerates the policy page content (see Policy pages below). Two node
  scripts, both run by hand, never by npm: `node scripts/dev-login.mjs [email] [nextPath]` mints a
  real single-use magic-link URL so localhost can reach an auth-gated page, and
  `node scripts/migrate-company-to-period-billing.mjs` switches one company from v1 to v2 billing (dry-run
  first). Read the header comment in `dev-login.mjs` before using it: `.env.local` points at the **live**
  Supabase project, so anything you click that saves writes production data.
- `vercel.json` is the only deployment config: one cron, `/api/billing/run` daily at 06:00 UTC, authenticated
  by a `CRON_SECRET` bearer token (compared in constant time). Without that env var the route answers 500
  and logs why, and no billing ever runs.

## Architecture

### Tenancy is the backbone — read this before touching any data-fetching page

A **company** (`company_id`) owns one or more **tenants** (`tenant_id`). Operational tables (jobs, PODs,
invoices, vehicles, drivers, ...) are keyed by `tenant_id`. Roles: `super_admin` (platform-wide), `admin`
(company-wide, all tenants under their company), staff (their own tenant only, via `profiles.tenant_id`).

- **RLS in Postgres is the actual isolation boundary**, not client-side filtering. SECURITY DEFINER helpers
  (`can_access_tenant`, `can_manage_tenant`) fail closed. Migrations live in `docs/sql/` as `rls_01`..`rls_12`,
  then `prodfix_01`..`prodfix_95` (01 to 93 from the 2026-09-14 review, 94 and 95 later follow-ups; numbered,
  applied by hand in the Supabase SQL editor; there is no automated migration runner).
  `docs/sql/prodfix_00_APPLY_ORDER.md` is the order and records what was applied; most of the series is
  still unapplied, so several server-side checks refuse in prod until it is. `rls_09_verify.sql` is the
  check script; re-run `prodfix_81` after using it.
- **Roles and tenancy come from `profiles` only** (`role_id` -> `roles.name`, `company_id`, `tenant_id`), the
  same columns RLS and `get_tenant_context()` read. `memberships` is legacy: it may still be written for
  compatibility, but never read it for authorization. Route handlers that use the service-role client
  (which bypasses RLS) must authorize with `authorizeTenant()` from `lib/auth/serverTenantAccess.ts`, which
  mirrors `can_access_tenant` / `can_manage_tenant` exactly. `requireTenantAccess` (accounts) and
  `requireTenant` (`lib/api/server.ts`) already do. User provisioning and role changes go through the
  `prodfix_20` RPCs so profile and membership writes are atomic.
- **Client-side, every page resolves tenant once** through `TenantProvider`, which calls the `get_tenant_context()`
  RPC and exposes `useTenant()` (role, accessible tenants, active tenant, `filterByTenant`, `writeTenantId`).
  Pure logic for this lives in `lib/tenant/context.ts` (parsing/role normalization, `pickInitialActiveTenant`,
  `computeWriteTenantId`) and `lib/tenant/filter.ts` — both have direct unit tests; prefer extending those over
  ad hoc tenant checks inside components.
  - `pickInitialActiveTenant`: staff are pinned to their home tenant; admins default to "All tenants" (`null`)
    unless a previously persisted tenant is still in their list.
  - `computeWriteTenantId`: staff writes always target their home tenant; admin writes target whatever tenant is
    currently active (or `null` when viewing "All").
- Any new data-fetching/writing page must go through `useTenant()` / `filterByTenant` / `writeTenantId` — do not
  query Supabase tables directly by an assumed tenant.
- `requireTenant` (`lib/api/server.ts`) reads the `x-tenant-id` header. Staff with no header get their home
  tenant; an admin or super admin with no header gets 400 (`requestTenantId` in `lib/auth/tenantAccess.ts`),
  because "All tenants" sends none. Send the record's own tenant, not the selector, when acting on a row.
- Accounts routes (`requireTenantAccess`) refuse drivers even without an allow-list, by the same office rule as
  POD sharing (`lib/jobs/officeRoles.ts`). Links that leave the app use `publicAppOrigin()`, never the request
  host; `lib/accounts/publicLinks.test.ts` fails on any route that builds one from the request.
- `vehicle_licences.active` and `vehicle_licences.vehicle_id` are **server-only**. `billing_03` revokes the
  client's insert and update grants and installs a trigger, because an active licence is a billable vehicle
  and repointing `vehicle_id` would make a different vehicle billable for free. Activation goes through
  `POST /api/licences/activate`, which charges pro-rata for the rest of the cycle first and only then writes
  the row. Other columns on that table (`licence_type`, `issue_date`, `expiry_date`, `notes`) are still
  client-writable. Never reintroduce a direct client write to either column.
- **The accounts ledger is read-only from the browser.** Invoices, invoice lines, quotations, credit notes,
  payments, statements, purchase orders, customer contacts and `document_delivery_log` are written only by
  `app/api/accounts/**` (service role, after `requireTenantAccess`) and, for the two platform-wide status
  flips, `PATCH /api/super-admin/invoices/[id]` (`lib/superAdmin/invoiceStatus.ts` is the closed list).
  `prodfix_95` makes the database agree: it revokes client DML on those tables and leaves one
  `tenant_read` SELECT policy, so a browser insert or update fails once it is applied. `customers`,
  `customer_integrations` and `subcontractors*` are deliberately excluded because `app/api/customers/**`
  writes them through the user client. `document_delivery_log.share_reference` holds an opaque pointer
  to the share row (`lib/documents/shareReference.ts`), never the share URL: the email routes assert
  that before inserting, because the log is readable by every member of the tenant. The assertion is an
  allowlist, not a blocklist: only `pod_share:<sha256 hex>`, `tracking_share:<sha256 hex>` (the stored
  token hash) and `quotation_share:<uuid>` (the link row id) pass, so a new token or URL shape fails.
- `lib/billing/vehicleCount.ts` is the single definition of billable: a company vehicle with at least one
  active licence. What a cycle actually paid for is a separate fact, recorded per vehicle in
  `vehicle_cycle_coverage`; `lib/billing/addon.ts` charges a mid-cycle addition only when the current cycle
  has no coverage row for it. Keep those two ideas distinct, and do not add a second billable-count rule.
- **Unlicensed vehicles cannot be put to work.** `prodfix_30` adds a trigger that refuses to newly assign a
  vehicle with no active licence (errcode `LIC01`) on jobs, vehicle assignments, load manifests and planning
  itineraries; existing assignments are grandfathered. The same trigger refuses any new assignment for a
  company whose `company_billing.status` is `canceled` (errcode `LIC02`), because cancelling leaves licences
  active. `lib/billing/unlicensedVehicle.ts` turns both errors into a user message. Without this gate,
  billing was optional.
- **Deleting a vehicle goes through `DELETE /api/vehicles/[id]`**, never a browser delete. It answers 409 when
  billing history exists, and `prodfix_31` makes billing evidence tables RESTRICT rather than cascade.
- **Walkaround checks gate driver work.** Own-fleet drivers need an open shift whose current vehicle passed
  (or passed with only minor defects) a walkaround before completing stops or saving PODs
  (`lib/walkaround/jobGate.ts`, enforced in the stop and POD routes, fails closed: no shift, no vehicle
  period, no passing check or a VOR vehicle all refuse). Severity is decided by the catalogue, never the
  phone (`lib/walkaround/severity.ts`); the locked baseline in `lib/walkaround/baseline.ts` must match
  `docs/sql/shifts_02_catalogue_seed.sql` (`lib/walkaround/baselineSql.test.ts`). Shift and walkaround
  tables are read-only from the browser, the same shape as the accounts ledger; every write goes through a
  `shifts_04` RPC that takes the driver's advisory lock, checks the phone-generated `client_id` for
  idempotency, and only then runs its business checks, so a retry of an already-saved event is never
  refused because the world moved on (vehicle now VOR, break now closed). Every event inside a shift is
  named by `shiftClientId` (the client id of the start check that opened it), so a late event can only ever
  attach to its own shift. `WLK01` refuses lifting VOR while a dangerous defect is open with no rectification
  or approved objection; `WLK04` is the database's own severity backstop, refusing a defect whose stored
  catalogue severity disagrees with the submission; `WLK05` refuses any client write to a vehicle's QR token
  hash, which stays server-only. A shared phone's offline queue sends only the signed-in driver's own
  items; another driver's queued items are held, not deleted, until they sign in
  (`lib/offline/driverSync.ts`). Shift hours are recorded hours, not a legal calculation: tachograph data
  stays the legal record, and nothing here checks Working Time, daily or weekly rest.
- **Driver POD saves go through the same offline queue.** Three item kinds join the shift events in one
  strictly ordered queue (`lib/offline/driverSync.ts`, runner `app/driver/driverQueue.ts`): `pod_photo`,
  `pod_scan` and `pod_complete`, so a shift's start check always reaches the server before a POD that
  depends on it, and a stop's photos and scans before its completion. Photo and completion items carry
  `shiftClientId` and the phone's `recordedAt`; scans carry neither (that route has no gate and is already
  idempotent). The upload-url, evidence and complete routes treat a body with any of `clientId`,
  `shiftClientId` or `recordedAt` as queued (`lib/pod/queuedMeta.ts`; a non-UUID `clientId` answers 400).
  `acceptRecordedTime` (`lib/pod/recordedTime.ts`) trusts the phone's time only with an explicit offset,
  at most 2 minutes ahead, at most 72 hours old, not before the job's `created_at` (the `notBefore`
  floor) and inside the named shift; otherwise server time is used and the stop gets
  `pod_time_untrusted`. `queuedJobGate` (`lib/walkaround/server.ts`, pure rule `jobGateDecisionAt`) judges
  the walkaround gate at that recorded time against the `shift_vehicle_periods` row containing it; VOR is
  re-checked only while that period is still open, because `vehicles.vor` has no history. A gate LOOKUP
  failure answers 503 so the queue retries with backoff; a real refusal stays 409 and is final. Queued
  photo paths are derived from `clientId` (`buildQueuedPodEvidencePath`, `.../photos/q-<clientId>-<name>`)
  and signed WITHOUT upsert, so a recorded photo can never be swapped; a retry that finds the object or the
  `pod_evidence` row already there skips the upload and goes straight to the idempotent record route. A
  refused photo does not hold back its stop's queued completion (the server's evidence-count check still
  refuses a stop with none). Opening the app with no signal is still unsupported: there is no service worker.
- **Two billing models run side by side**, routed on `company_billing.billing_model`. Everything above
  describes **v1** (`v1_immediate`): charge in advance every 28 days, charge pro-rata the moment a vehicle
  is added, `vehicle_cycle_coverage` records what a payment bought.
  **v2** (`v2_period`) bills in ARREARS: adding a vehicle is an insert and moves no money, and the invoice
  is computed when a 28-day period closes. It writes no coverage rows; `lib/billing/close.ts`,
  `invoice.ts`, `rateCard.ts` and `periodServer.ts` are its equivalents, and the periods and lines live in
  `billing_periods` / `period_invoice_lines` (`docs/sql/billing_06`, `billing_07`). v2 pricing is GBP 64.50 per
  vehicle per period with a GBP 129.00 floor and WHOLE-FLEET volume discounts, which is a different shape
  from v1's graduated per-week bands: do not reuse `lib/billing/money.ts` for a v2 company or the other way
  round. Full rationale in `docs/superpowers/specs/2026-09-10-period-billing-design.md`.
- `vehicle_licences` holds **compliance documents**, not billing seats: one vehicle legitimately carries an
  O-licence, a waste carrier licence and an ADR certificate at once. Billing reads the set as "billable if
  ANY licence is active". Never add a one-active-licence-per-vehicle constraint, and never count licence
  rows where you mean vehicles.
- **`vehicles` has no `company_id` column.** It is keyed by `tenant_id` only, and some rows carry a company
  id in that column directly. A vehicle reaches its company through its tenant. Filtering on
  `vehicles.company_id` answers PostgREST 42703 and fails the whole request.
- POD (proof-of-delivery) files live in a private `pod-files` Storage bucket, tenant-scoped via the storage
  path's tenant segment (`<tenant_id>/<job_id>/<stop_id>/`, the rule in `lib/pod/evidencePath.ts`), served
  through short-lived signed URLs (`lib/pod/podUrl.ts`), never public URLs. Uploads go browser-to-storage via
  server-issued signed upload URLs, then a JSON call records the row, because Vercel caps request bodies at
  4.5 MB. POD share links are random tokens stored hashed in `pod_share_links` (`lib/pod/shareLinks.ts`,
  `shareStore.ts`), revocable and re-checked on every view. The sibling `job-files` bucket is locked down only
  once `prodfix_82`/`83` are applied; until then don't assume it has the same guarantees.
- `job_stops.pod_flags text[]` (`tracking_02`) carries `pod_time_untrusted` when a queued completion's
  phone time was refused. The complete route retries without the column on PGRST204/42703, so a missing
  column never blocks a delivery. `/jobs` does NOT select it yet: selecting a missing column fails the
  whole list, so add `pod_flags` to the `job_stops` select in `app/jobs/page.tsx` (the comment there marks
  the spot) only after `tracking_02` is applied; until then the "Time not trusted" tag cannot show.
- **Customer tracking links** copy the POD share link design. Tokens are random `trk_` strings stored only
  as a SHA-256 hash in `stop_tracking_links` (`lib/tracking/links.ts`, `linkStore.ts`); that table and
  `stop_eta_cache` are server-only (RLS on, no policies, client grants revoked, `tracking_01`). Links go
  through `app/api/tracking-links/**` only, after `authorizeOfficeTenant` (drivers refused): minted and
  emailed for an undelivered delivery stop of a non-cancelled job, revoked for any stop in the tenant;
  the email goes only to the stop contact, an address on the job's customer or the caller. The public JSON
  (`/api/public/track/[token]`, rate limited per IP) answers one 404 body for unknown, expired, revoked and
  ended links.
  `buildTrackingPayload` in `lib/tracking/publicPayload.ts` is the ONLY builder of what leaves the server:
  never driver, vehicle, reference, recipient, customer or other stops. State `next` is the only state
  that reveals position, destination or a live ETA, and every doubtful case resolves to not next (stop
  missing from the van's itinerary, no itinerary unless it is the job's single remaining stop today, and a
  failed itinerary lookup). Position also needs a fix under 10 minutes old; the live ETA is a
  traffic-aware TomTom route cached 2 minutes per stop in `stop_eta_cache`, falling back to the planned
  window on any TomTom failure.
- PDFs (invoice, quotation, POD) must use `embedUnicodeFonts()` and `pdfSafeText()` from
  `lib/printing/pdfFonts.ts`. pdf-lib's StandardFonts throw on any non-WinAnsi character (Polish, Turkish,
  emoji), which used to abort emails with a 500. The DejaVu fonts are vendored in `lib/printing/fonts/`.
- Planning's driver-hours checks cover EU driving limits (daily, weekly, fortnightly) and the 45-minute break
  ONLY. Daily and weekly rest, Working Time rules, ferry/train interruptions and HGV routing are not modelled,
  and the UI says so. Never add copy that implies a check that does not run. Planning is read-only while
  "All tenants" is selected, and saves go through the atomic `prodfix_70` RPC.

### One styling system, plus five deliberately excluded public pages

- **Every console page is on the design system.** The inline-styled legacy tier no longer exists; Tailwind
  Preflight stays disabled globally, which is why the `ds` reset is still required rather than optional.
- **Deliberately NOT tokenised**, and absent from `themeableRoutes.ts` on purpose: `/pod/share/[token]`,
  `/quotation/share/[token]`, `/track/[token]`, `/driver/jobs/[jobId]` and `/driver/walkaround`,
  customer/driver-facing pages outside the console shell with a fixed light palette. `/track/[token]` is
  also hidden from the console shell by `lib/nav/shouldShowShell.ts` (prefix `/track/`, with the slash,
  because `/tracking` is a console page). Do not "finish the job" on these without deciding a
  delivery-receipt (or walkaround, or tracking) recipient should see the operator's theme.
- **Design-system ("ds") pages**: opt in via `className="ds font-sans bg-canvas text-ink"` on the root element.
  `ds` re-applies a scoped CSS reset; `font-sans` switches to IBM Plex. Tokens live in `app/tokens.css`, consumed
  by `app/globals.css`. Forgetting `font-sans` silently falls back to Inter; forgetting `ds` breaks borders/layout
  (Preflight is off). This asymmetry is intentional and documented inline in `app/layout.tsx`/`app/globals.css`.
- **Theme default is inverted on purpose**: `:root` in `app/tokens.css` holds the **dark** values (this app runs
  in dim control rooms); `.light` is the opt-out. `.dark` duplicates `:root` so a subtree can pin itself dark
  under an ancestor `.light` (used by legacy pages). **Never use Tailwind `dark:` variants** — under this
  inverted default they mean the opposite of what they look like; put theme differences in token values instead.
  Theme preference is per-device (`localStorage["tms-theme"]`), not per-user, applied by a synchronous script in
  `<body>` before first paint (hence `suppressHydrationWarning` on `<html>`).
  The only CSP today is `frame-ancestors 'none'` in `next.config.ts`. Adding a `script-src` must allowlist
  that inline script (hash/nonce) or light mode silently breaks.
- `lib/nav/themeableRoutes.ts` is the single allowlist controlling which pages follow the theme toggle. It now
  lists every console route; a NEW page still defaults to pinned-dark until listed, which is the remaining
  reason the mechanism exists. Adding a page means: tokens, `ds ... bg-canvas` on the root, then its path here.
  `lib/nav/themeableRoutes.test.ts` asserts the exact list, so it fails if you add a route without listing it.
- `lib/theme/contrast.test.ts` parses `app/tokens.css` directly and asserts contrast on every token pair in both
  themes on every `npm test` run — it documents a small number of pre-existing gaps as floors that must not
  regress. If you change a token value, run this test.
- Full rationale: `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md`.

### Auth

Passwordless magic-link. The login page posts to `POST /api/auth/magic-link`, which rate limits per email and
IP, never creates a user (`shouldCreateUser: false`) and answers the same whether or not the account exists.
Email links land on `/auth/confirm` (`verifyOtp` with `token_hash`, open-redirect hardened `next` param). The
GET `app/api/auth/callback` only exchanges a PKCE `code`; a `token_hash` sent there is forwarded to
`/auth/confirm` rather than verified, so a link opened by an email scanner is not consumed. Self-service
signup is `/signup` -> `POST /api/signup`: honeypot, per-IP and per-email rate limits, then the
service-role admin API creates the auth user silently, the `signup_01` RPC
`create_company_with_admin` writes company, tenant, company profile and founding admin profile in
one transaction, and only then the invite email goes out (pure logic in `lib/auth/signup.ts`). It
answers one constant body whether or not the address exists. Both the page and the route sit behind
`SIGNUP_ENABLED` (`lib/auth/signupGate.ts`): closed unless the server-only variable is exactly `true`,
so a fresh deploy refuses signups by default. Supabase's "Allow new users to sign
up" stays off: the service role creates users regardless, and `supabase.auth.signUp` must never
appear in browser code.

Sign-in and invite emails are sent by Supabase Auth, not by Resend, and the built-in Supabase sender is
capped at a handful of messages per hour. When the cap is hit, `signInWithOtp` answers
`429 over_email_send_rate_limit`, the magic-link route deliberately swallows it (a different answer
would reveal which addresses exist) and only logs a warning, so "nobody is receiving sign-in emails"
looks like a client bug from the browser. Check the Vercel function logs for that warning first.

`proxy.ts` is the edge gate: it refreshes the Supabase session cookie and turns away anonymous requests
(redirect to `/login?next=...` for pages, `401 {"error":"unauthorized"}` for anything `isApiPath`, so a
`fetch()` never gets a login page where it expected JSON). It is **defence in depth, not the boundary** — it
has no notion of tenants and cannot stop a signed-in user asking for another tenant's rows; RLS still does
that. It also replaces nothing: `app/super-admin/layout.tsx` still owns the role check and `TenantGate` still
owns the client-side signed-out redirect. The public allowlist is `lib/auth/publicRoutes.ts`: exact paths and
one-segment token patterns only, no prefixes. `lib/auth/routeClassification.test.ts` lists every page and route
handler under `app/` as public or protected and fails when a route file is added or removed without being
listed, so add every new route there. A new public route (share links, webhooks, cron) must also be added to
`publicRoutes.ts` or it 401s.

Abuse-prone routes rate limit with `checkRateLimit()` from `lib/rateLimit.ts`, backed by the `prodfix_01`
table, because in-memory limiters reset per serverless instance.

`lib/supabase/browser.tsx`, `lib/supabase/server.tsx`, and
`lib/supabase/admin.ts` are the three Supabase client entry points — `admin.ts` uses the service-role key and is
server-only (lead intake, super-admin cross-checks); never import it from client code.

### Policy pages

Ten public policy pages (`/terms`, `/privacy`, `/cookies`, `/cancellation-policy`, `/dpa`, `/accessibility`,
`/support-policy`, `/acceptable-use`, `/sub-processors`, `/security`) plus the `/legal` index. Each
`app/<path>/page.tsx` is five lines around `components/legal/LegalPage.tsx`.

- **The wording is not written in this repo.** `scripts/legal/convert-policies.py` (PyMuPDF, run by hand)
  copies the PDFs in `docs/TMS POLICIES/` verbatim into `lib/legal/content/*.json`. To change wording, change
  the source document and regenerate; never edit the JSON or reword in JSX. Documents 00 and 11 to 14 in
  that folder are INTERNAL and must not be converted or published.
- `lib/legal/vendor.ts` holds the company number (14798586, confirmed 2026-09-22), substituted into the
  `[COMPANY NUMBER]` placeholder at render time. There is no VAT number or ICO reference: the sentences
  that carried them, and the Sub-processor List's "confirm" notes, are cut by `TRIMS` in the converter
  because the values were never supplied. If any placeholder survives, the page shows a draft notice and
  is `noindex`; that is computed (`documentStatus` in `lib/legal/text.ts`), so there is no flag to flip,
  and `lib/legal/documents.test.ts` asserts none survives today.
- The same test asserts the prices, VAT rate and cooling-off window quoted in the Terms against
  `lib/billing/rateCard.ts`, `vat.ts` and `cancellation.ts`. A rate-card change fails it on purpose: the
  Terms promise 30 days' notice of a price change.
- `lib/legal/routes.ts` imports no document text because `shouldShowShell` uses it in the client shell.
  Keep it that way. A new policy page needs the lists named at the top of that file;
  `lib/legal/routes.test.ts` fails until they agree.
- The pages avoid `text-ink-3` (a recorded light-mode contrast failure that the Accessibility Statement
  itself names). Do not reintroduce an unqualified WCAG conformance claim in marketing copy.

### Directory map (beyond what's obvious from browsing)

```
proxy.ts                    edge auth gate (Next 16's name for middleware.ts) — see Auth below
app/<feature>/page.tsx     one route per feature; app/api/ route handlers mirror the same feature names
app/components/            shared UI: AppHeader, TenantProvider, TenantGate, TenantSelector, PodLink
lib/<feature>/              pure logic + colocated *.test.ts, per feature (tenant, pod, planning, tracking,
                             theme, dashboard, invoices, quotations, accounts, ...) — most business logic that
                             needs testing lives here rather than in app/, since vitest only covers lib/
lib/roles.ts                SUPER_ADMIN_ROLE constant + role-extraction helper — must match roles.name in DB
                             exactly; this is the single source of truth for the super-admin role string
lib/auth/tenantAccess.ts    profiles-based authorization mirroring can_access_tenant / can_manage_tenant;
                             serverTenantAccess.ts is the server loader (authorizeTenant)
lib/rateLimit.ts            durable rate limits (RATE_LIMITS rules, checkRateLimit, clientIp)
lib/printing/pdfFonts.ts    Unicode fonts and text sanitising for every generated PDF
docs/sql/                   numbered migrations, applied by hand in order in the Supabase SQL editor:
                             rls_01..rls_12 (tenancy, storage, job-files lockdown), billing_01..billing_07
                             (v1 platform billing, then v2 period billing), prodfix_01..prodfix_95 (the
                             2026-09-14 review fixes plus two follow-ups; order in prodfix_00_APPLY_ORDER.md),
                             signup_01 (self-serve signup RPC), and shifts_01..05 (driver shifts and walkaround
                             check tables, triggers, RPCs and storage policies, 2026-09-29; none applied yet),
                             tracking_01..02 (tracking links, ETA cache and job_stops.pod_flags, 2026-10-07;
                             not applied),
                             and three timestamp-named files from 2026-09-29/30 (stop contacts, saved plans,
                             load transfers and stop windows; moved here from supabase/migrations/ because
                             they were not yet applied). `*_verify.sql`, `diag_*`, `schema_rls_dump.sql` and
                             `prodfix_80_preflight_readonly.sql` are read-only check scripts, not migrations;
                             `local_00_base_tables_reconstructed.sql` is a local-only schema reconstruction.
                             Not every file has been applied: check the apply-order doc.
supabase/migrations/        17 more hand-applied migrations (planning, manifests, Xero credentials, driver
                             activity, tachograph ledger, atomic planning save). CLI-style names, but applied
                             via the SQL editor: NEVER run `supabase db push`, it would replay all of them.
                             rls_01/rls_01b now raise if run. `20260921090000_rate_limits.sql` is a
                             byte-for-byte copy of prodfix_01; apply one, not both.
scripts/                    dev-login.mjs (local magic link), migrate-company-to-period-billing.mjs
docs/superpowers/specs/     design specs (read before large features — several trade-offs, like the theme
                             inversion, are only explained here)
docs/superpowers/plans/     implementation plans
docs/superpowers/reviews/   past review notes
docs/handoffs/              session handoffs
tests/                      Playwright layout specs — separate npm project, not part of `npm test`
```

## Notes on maturity

Active development, not a finished platform. Several data-driven pages use loose (`any`) typing; some carry
leftover `console.log`s; a few pages are launchers or read-only pending backing features (see README's Page
Inventory for exact status per route — treat that table as the source of truth over any assumption you make from
folder names alone). The tenancy/RLS/storage layer has had the most rigorous review; treat changes there with
proportionally more care than changes to STUB/LAUNCHER pages.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
