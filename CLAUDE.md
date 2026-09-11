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
- There is no `next.config.*`. The edge auth gate **exists** and lives in `proxy.ts` at the repo root —
  Next 16 renamed `middleware.ts` to `proxy.ts`, so searching for `middleware` finds nothing. README still
  calls it `middleware.ts` in the roadmap section; that name is stale.
- Two node scripts, both run by hand, never by npm: `node scripts/dev-login.mjs [email] [nextPath]` mints a
  real single-use magic-link URL so localhost can reach an auth-gated page, and
  `node scripts/migrate-company-to-period-billing.mjs` switches one company from v1 to v2 billing (dry-run
  first). Read the header comment in `dev-login.mjs` before using it: `.env.local` points at the **live**
  Supabase project, so anything you click that saves writes production data.
- `vercel.json` is the only deployment config: one cron, `/api/billing/run` daily at 06:00 UTC, authenticated
  by a `CRON_SECRET` bearer token. Without that env var set the route answers 401 and no billing ever runs.

## Architecture

### Tenancy is the backbone — read this before touching any data-fetching page

A **company** (`company_id`) owns one or more **tenants** (`tenant_id`). Operational tables (jobs, PODs,
invoices, vehicles, drivers, ...) are keyed by `tenant_id`. Roles: `super_admin` (platform-wide), `admin`
(company-wide, all tenants under their company), staff (their own tenant only, via `profiles.tenant_id`).

- **RLS in Postgres is the actual isolation boundary**, not client-side filtering. SECURITY DEFINER helpers
  (`can_access_tenant`, `can_manage_tenant`) fail closed. Migrations live in `docs/sql/` as `rls_01`..`rls_10`
  (numbered, applied in order, in the Supabase SQL editor — there is no automated migration runner). Read the
  numbered files in order if you need to understand or extend a policy; `rls_09_verify.sql` is the check script.
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
- `vehicle_licences.active` and `vehicle_licences.vehicle_id` are **server-only**. `billing_03` revokes the
  client's insert and update grants and installs a trigger, because an active licence is a billable vehicle
  and repointing `vehicle_id` would make a different vehicle billable for free. Activation goes through
  `POST /api/licences/activate`, which charges pro-rata for the rest of the cycle first and only then writes
  the row. Other columns on that table (`licence_type`, `issue_date`, `expiry_date`, `notes`) are still
  client-writable. Never reintroduce a direct client write to either column.
- `lib/billing/vehicleCount.ts` is the single definition of billable: a company vehicle with at least one
  active licence. What a cycle actually paid for is a separate fact, recorded per vehicle in
  `vehicle_cycle_coverage`; `lib/billing/addon.ts` charges a mid-cycle addition only when the current cycle
  has no coverage row for it. Keep those two ideas distinct, and do not add a second billable-count rule.
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
  path's tenant segment, served through short-lived signed URLs (`lib/pod/podUrl.ts`, `lib/pod/shareToken.ts`) —
  never public URLs. The sibling `job-files` bucket is **not yet locked down** (see README roadmap); don't assume
  it has the same guarantees.

### One styling system, plus three deliberately excluded public pages

- **Every console page is on the design system.** The inline-styled legacy tier no longer exists; Tailwind
  Preflight stays disabled globally, which is why the `ds` reset is still required rather than optional.
- **Deliberately NOT tokenised**, and absent from `themeableRoutes.ts` on purpose: `/pod/share/[token]`,
  `/quotation/share/[token]` and `/driver/jobs/[jobId]` — customer/driver-facing pages outside the console
  shell with a fixed light palette. Do not "finish the job" on these without deciding a delivery-receipt
  recipient should see the operator's theme.
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
  There is no CSP today; adding one must allowlist that inline script (hash/nonce) or light mode silently breaks.
- `lib/nav/themeableRoutes.ts` is the single allowlist controlling which pages follow the theme toggle. It now
  lists every console route; a NEW page still defaults to pinned-dark until listed, which is the remaining
  reason the mechanism exists. Adding a page means: tokens, `ds ... bg-canvas` on the root, then its path here.
  `lib/nav/themeableRoutes.test.ts` asserts the exact list, so it fails if you add a route without listing it.
- `lib/theme/contrast.test.ts` parses `app/tokens.css` directly and asserts contrast on every token pair in both
  themes on every `npm test` run — it documents a small number of pre-existing gaps as floors that must not
  regress. If you change a token value, run this test.
- Full rationale: `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md`.

### Auth

Passwordless magic-link (Supabase `verifyOtp` with `token_hash`), completed in `app/api/auth/callback`
(open-redirect hardened `next` param).

`proxy.ts` is the edge gate: it refreshes the Supabase session cookie and turns away anonymous requests
(redirect to `/login?next=...` for pages, `401 {"error":"unauthorized"}` for anything `isApiPath`, so a
`fetch()` never gets a login page where it expected JSON). It is **defence in depth, not the boundary** — it
has no notion of tenants and cannot stop a signed-in user asking for another tenant's rows; RLS still does
that. It also replaces nothing: `app/super-admin/layout.tsx` still owns the role check and `TenantGate` still
owns the client-side signed-out redirect. The public allowlist is `lib/auth/publicRoutes.ts`, unit tested —
a new public route (share links, webhooks, cron) must be added there or it 401s.

`lib/supabase/browser.tsx`, `lib/supabase/server.tsx`, and
`lib/supabase/admin.ts` are the three Supabase client entry points — `admin.ts` uses the service-role key and is
server-only (lead intake, super-admin cross-checks); never import it from client code.

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
docs/sql/                   numbered migrations, applied by hand in order in the Supabase SQL editor:
                             rls_01..rls_12 (tenancy, storage, job-files lockdown) and billing_01..billing_07
                             (v1 platform billing, then v2 period billing). `*_verify.sql` files are check
                             scripts, not migrations. Not every file has been applied — check the handoff.
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
