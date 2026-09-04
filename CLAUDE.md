# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TMS Wizzard: a multi-tenant Transport Management System (SaaS, from GBP 10/vehicle/week billed 4-weekly) for UK/EU road-haulage
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
- No `next.config.*` and no `middleware.ts` exist yet — there is currently no edge auth gate; the
  roadmap in README calls for adding one.

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
- POD (proof-of-delivery) files live in a private `pod-files` Storage bucket, tenant-scoped via the storage
  path's tenant segment, served through short-lived signed URLs (`lib/pod/podUrl.ts`, `lib/pod/shareToken.ts`) —
  never public URLs. The sibling `job-files` bucket is **not yet locked down** (see README roadmap); don't assume
  it has the same guarantees.

### Two styling systems coexist — check which one a page is on before editing it

- **Legacy pages** (most of the app): inline styles, dark canvas, Inter font. Tailwind Preflight is disabled
  globally so these are untouched by Tailwind resets.
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
- `lib/nav/themeableRoutes.ts` is the single allowlist controlling which pages follow the theme toggle. Moving a
  legacy page onto the design system means: convert its color literals to tokens, add `ds ... bg-canvas` to its
  root, then add its path here.
- `lib/theme/contrast.test.ts` parses `app/tokens.css` directly and asserts contrast on every token pair in both
  themes on every `npm test` run — it documents a small number of pre-existing gaps as floors that must not
  regress. If you change a token value, run this test.
- Full rationale: `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md`.

### Auth

Passwordless magic-link (Supabase `verifyOtp` with `token_hash`), completed in `app/api/auth/callback`
(open-redirect hardened `next` param). `lib/supabase/browser.tsx`, `lib/supabase/server.tsx`, and
`lib/supabase/admin.ts` are the three Supabase client entry points — `admin.ts` uses the service-role key and is
server-only (lead intake, super-admin cross-checks); never import it from client code.

### Directory map (beyond what's obvious from browsing)

```
app/<feature>/page.tsx     one route per feature; app/api/ route handlers mirror the same feature names
app/components/            shared UI: AppHeader, TenantProvider, TenantGate, TenantSelector, PodLink
lib/<feature>/              pure logic + colocated *.test.ts, per feature (tenant, pod, planning, tracking,
                             theme, dashboard, invoices, quotations, accounts, ...) — most business logic that
                             needs testing lives here rather than in app/, since vitest only covers lib/
lib/roles.ts                SUPER_ADMIN_ROLE constant + role-extraction helper — must match roles.name in DB
                             exactly; this is the single source of truth for the super-admin role string
docs/sql/                   numbered RLS + storage policy migrations (rls_01..rls_10), applied manually
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
