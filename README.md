# TMS Wizzard

A multi-tenant Transport Management System (TMS) for UK and EU road-haulage operators. TMS Wizzard runs the day-to-day of a haulage business in one place: booking jobs, capturing proof of delivery, invoicing, managing the fleet and drivers, and staying on top of compliance (tachograph / working-time, vehicle licences, maintenance and VOR). It is a SaaS product, priced at GBP 10 per vehicle per month, deployed at tmswizzard.cloud.

> Status: active development. The core operational pages are functional against a live Supabase backend; some analytics and admin-management pages are still launchers or read-only views (see the Page Inventory status tags). A multi-tenant Row Level Security overhaul and a storage-bucket lockdown were recently completed and are in rollout.

---

## What it does

- **Operations:** create and edit transport jobs with collection and delivery stops, capture proof of delivery (photos, documents, recipient, notes), mark stops delivered, and track vehicles.
- **Commercial:** manage customers and subcontractors, raise and track invoices, and see business KPIs (revenue, margins, driver and customer leaderboards).
- **Fleet and compliance:** manage vehicles, drivers, trailers and assets, record maintenance and vehicle-off-road (VOR) status, track vehicle licences, and view tachograph / working-time activity.
- **Telematics and tracking:** view latest GPS positions and speed from the company telematics feed.
- **Administration:** company profile and settings, user invites, per-page permissions, and a super-admin console for companies, users, billing and lead requests.
- **Growth:** a public marketing landing page with a lead-capture form that notifies the team.

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript.
- **Backend:** Supabase (Postgres, Auth via magic link, Storage), accessed through `@supabase/ssr`.
- **Auth:** passwordless magic-link (token_hash + verifyOtp), with a security-hardened callback route.
- **Validation:** Zod.
- **Tests:** Vitest.
- **Styling:** a hybrid of inline styles (legacy pages) and Tailwind + IBM Plex on opt-in "ds" pages (see Design System). Fonts: IBM Plex Sans / Mono and Inter.
- **Hosting:** Vercel.
- **Integrations:** Microsoft Teams (lead alerts), Resend (transactional email), Square (platform subscription billing), TomTom (live tracking, planned).

## Multi-tenant architecture and security

TMS Wizzard is multi-tenant by design, and the tenancy model is the backbone of the product.

- **Companies and tenants:** a **company** (`company_id`) owns one or more **tenants** (`tenant_id`). Operational data (jobs, PODs, invoices, vehicles, drivers, etc.) is keyed by `tenant_id`. A user belongs to one tenant via `profiles.tenant_id`, and to a company via `profiles.company_id`.
- **Roles:**
  - `super_admin`: the whole platform (the operator of TMS Wizzard).
  - `admin`: company-wide, across every tenant under their company. A company admin (typically a C-level user) allocates staff into tenants and can view the whole company or filter to a single tenant.
  - staff (default / no elevated role): their own tenant only.
- **Row Level Security (RLS) is the isolation boundary,** not the client. Every data decision is enforced in Postgres by SECURITY DEFINER helper functions (`can_access_tenant`, `can_manage_tenant`) that fail closed: a missing or malformed tenant / company / role denies access rather than leaking it. A tampered client cannot cross tenants because `WITH CHECK` rejects foreign-tenant writes and `USING` hides unreadable rows. Guard triggers block a user from escalating their own role, tenant, or company.
- **Client tenant resolution:** the app resolves the acting tenant once through a `TenantProvider` that calls a trusted `get_tenant_context()` RPC, exposes a `useTenant()` hook (role, accessible tenants, active tenant, `filterByTenant`, `writeTenantId`), and renders a fail-closed gate for signed-out or unlinked accounts. Admins get a tenant selector (company-wide by default, filterable to one tenant); staff are locked to their own tenant.
- **Storage:** proof-of-delivery files live in a private `pod-files` bucket with tenant-scoped `storage.objects` policies keyed on the tenant path segment; the app serves them via short-lived signed URLs rather than public URLs.

The RLS design and migrations live under `docs/sql/` (`rls_01`..`rls_10`) and are documented in `docs/superpowers/specs/`.

## Design system

The UI deliberately runs **two styling systems side by side**, and understanding the seam matters before editing any page.

- **Legacy pages (most of the app):** plain inline styles on a dark canvas with Inter. A recurring pattern is a full-bleed truck photograph background with a dark translucent overlay panel and white rounded cards. Tailwind Preflight is disabled globally so these pages are not disturbed.
- **Design-system ("ds") pages:** newer pages opt in by putting `className="ds font-sans bg-canvas text-ink"` on their root element. The `ds` class re-applies a scoped CSS reset (borders, box-sizing, control fonts) via `:where()` rules, and `font-sans` switches to IBM Plex. Semantic tokens (`bg-canvas`, `text-ink`, `border-line`, `bg-surface`, `text-primary`, tone classes) are defined in `app/tokens.css` and consumed by `app/globals.css`.
- **The failure modes are intentional and asymmetric:** omit `font-sans` and a ds page silently falls back to Inter; omit `ds` and borders vanish and layouts overflow (because Preflight is off). This is documented inline in `app/layout.tsx` and `app/globals.css`.
- **ds pages today:** the landing page, `/login`, `/dashboard`, `/jobs` and `/super-admin/requests`. Everything else is inline-styled.

### Theming: the default is inverted on purpose

The app is used in dim control rooms, so **dark is the default theme** and light is opt-in.

- `:root` in `app/tokens.css` holds the **dark** values. `.light` is the **opt-out**. This is the reverse of the usual convention, and it is deliberate: it means server-rendered HTML, a failed script, a slow hydration and a JS-disabled browser all render dark, so a flash of white is structurally impossible on the default path.
- `.dark` duplicates `:root` exactly. That is not redundant: it lets a subtree pin itself dark against an ancestor `.light`, which is how the legacy pages stay dark while a user is in light mode. The landing page uses the mirror of this, pinning itself `light`.
- **Do not use Tailwind `dark:` variants.** Under an inverted default they mean the opposite of what you would expect. Theme differences belong in the token values.
- The preference is stored per **device** in `localStorage["tms-theme"]`, not per user: a shared control-room machine should stay dark whoever signs in. A synchronous script at the top of `<body>` applies it before first paint, which is why `<html>` carries `suppressHydrationWarning`.
- **There is no Content-Security-Policy in this app today.** If one is added, it must allow that inline script by hash or nonce, or the light theme will silently stop working and everything will render dark.
- **Which pages follow the theme** is controlled by one allowlist, `lib/nav/themeableRoutes.ts`. It drives both the toggle's visibility and the legacy dark pin. To move a legacy page onto the theme: convert its inline colour literals to tokens, give it a `ds ... bg-canvas` root, then add its path to that list.
- Every token pair in both themes is contrast-checked by `lib/theme/contrast.test.ts`, which parses `app/tokens.css` itself and runs on every `npm test`. Four documented pre-existing gaps are listed there as floors that must not regress.

See `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md` for the full rationale.

## Page inventory

Status tags: [OK] functional against live data, [PARTIAL] real data but view-only or thin, [LAUNCHER] static navigation only, [STUB] placeholder / mock data, [PLANNED] not yet built.

### Public and auth
- **`/` Landing** [OK]: marketing homepage (hero, features, pricing at GBP 10 / vehicle / month, request-access form), server-rendered with JSON-LD. ds / Plex.
- **`/login`** [OK]: passwordless magic-link sign in; surfaces "link expired" errors. ds / Plex.
- **`/api/auth/callback`** [OK]: completes magic-link sign in (verifyOtp / code exchange), sets session cookies, redirects to a validated `next` path (open-redirect hardened).
- **`/api/request-access`** [OK]: lead intake for the landing form; honeypot + per-IP rate limit + Zod validation, stores the lead, then notifies via Microsoft Teams and Resend.

### Operations
- **`/dashboard`** [OK]: tenant-scoped KPI tiles (jobs today, unassigned, on the road, PODs awaiting, overdue invoices), a today's-jobs table, a needs-attention list and a 7-day revenue chart. Read-only; no write path.
- **`/jobs`** [OK]: create / edit / delete jobs with collection and delivery stops; inline POD capture and "mark delivered"; margin display. The heaviest operational page.
- **`/pod`** [OK]: dedicated proof-of-delivery workflow; upload photos and delivery documents to private storage, record recipient / notes, mark stops delivered. Served via signed URLs.
- **`/tracking`** [PARTIAL]: read-only view of vehicles and their latest GPS locations.
- **`/telematics`** [PARTIAL]: read-only list of the latest vehicle GPS positions (lat / long / speed / time).
- **`/tachograph`** [PARTIAL]: read-only driver-hours / working-time view (driver cards + recent activity logs). No compliance logic yet.

### Commercial
- **`/customers`** [OK]: customer directory with create / edit / activate.
- **`/subcontractors`** [OK]: subcontractor directory with create / edit / activate.
- **`/invoices`** [OK]: raise and track tenant invoices, update status.
- **`/stats`** [OK]: company KPI dashboard (revenue, margins, job / POD / fleet counts, driver leaderboard, top customers) with a period selector and client-side aggregation.

### Fleet and compliance
- **`/vehicles`** [OK]: vehicle roster; admin create / edit / delete, staff may toggle active / VOR status.
- **`/drivers`** [OK]: driver roster; admin-managed create / edit / delete.
- **`/assets`** [OK]: trailers / pallets / equipment; create and list (no edit / delete yet).
- **`/maintenance`** [OK]: maintenance records; logging a VOR record marks the vehicle off-road, completion restores it.
- **`/settings/licences`** [OK]: vehicle licence tracking.

### Settings
- **`/settings`** [LAUNCHER]: settings hub cards.
- **`/settings/company`** [OK]: the most complete form in the app; multi-section company profile with country-driven fields (GB VAT / EORI / O-licence vs US EIN / USDOT / MC / IFTA), currency / timezone defaults, validation.
- **`/settings/users`** [OK]: invite users by magic link (admin action).
- **`/settings/permissions`** [PARTIAL]: per-user, per-page access checkboxes writing to `user_permissions`. Grant path works; revoke path and controlled state are incomplete.
- **`/settings/invoices`** [PARTIAL]: this tenant's monthly charge (active licensed vehicles x GBP 10).
- **`/settings/billing`** [OK]: subscription payment method (Square card on file, 3DS verified) and charge history; company admins only (super_admin sees a notice linking to `/super-admin/billing`; staff see a notice).

### Super-admin (platform operator)
- **`/super-admin`** [STUB]: overview with hardcoded KPI tiles (placeholder numbers).
- **`/super-admin/companies`** [PARTIAL]: list of customer companies (read-only).
- **`/super-admin/users`** [PARTIAL]: list of all platform users with tenant and role (read-only).
- **`/super-admin/billing`** [OK]: per-company billing (billable vehicles x GBP 10) with invoice generation, plus each company's subscription status (card on file, next charge, past-due with failed attempts).
- **`/super-admin/invoices`** [OK]: all invoices; mark paid / pending.
- **`/super-admin/requests`** [OK]: triage landing-page leads; cross-checks the true row count via the service role to detect an RLS misconfiguration. ds / Plex.

## Integrations

- **Microsoft Teams** (`TEAMS_WEBHOOK_URL`): Adaptive Card alert to the team when a lead is submitted.
- **Resend** (`RESEND_API_KEY`, `MAIL_FROM`, `LEAD_INBOX`): transactional email for lead notifications.
- **Square** (`SQUARE_ACCESS_TOKEN`, `SQUARE_ENVIRONMENT`, `SQUARE_LOCATION_ID`, `NEXT_PUBLIC_SQUARE_APP_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID`): platform subscription billing, card on file plus the daily `/api/billing/run` charge cron (see `/settings/billing` and `/super-admin/billing`). This is separate from Stripe Connect (tenant-to-customer invoice payments), which is unrelated to platform billing. The earlier catalogue / plan-creation scaffolding under `app/subscription page/` is superseded by this and not wired into a live route.
  - **Card form postal code (sandbox gotcha).** The Web Payments SDK picks the postal-code
    field's format from the *card's* issuing country, not the Square account's country. It sends the
    typed BIN to `POST /v2/tokenization/product-information` and localises the field from the
    `country` in the reply. Square's sandbox test cards (`4111 1111 1111 1111` and friends) are
    US-issued, so the field renders as a numeric-only "ZIP" and silently drops letters: a UK
    postcode becomes `11` and `tokenize()` returns `Postal code is not valid`. **In the sandbox,
    enter ZIP `94103`.** Real UK-issued cards return `GB` and the field becomes a text "Postcode"
    that accepts `SW1A 1AA`, so this does not affect production. The SDK's `card({ postalCode })` /
    `card.configure({ postalCode })` override cannot work around it: the hydrate response for this
    application returns the feature flag `can_override_postal_code: "false"`, so a supplied value is
    ignored and the field stays on screen.
- **TomTom** (planned): live vehicle tracking to replace the current read-only telematics views.

## Getting started

Prerequisites: Node.js, a Supabase project.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest
npm run typecheck  # next typegen + tsc --noEmit
npm run build      # production build
```

Environment variables (`.env.local`):

```
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server-only; lead intake + admin cross-checks

# Lead notifications (optional; lead is still stored if absent)
TEAMS_WEBHOOK_URL=
RESEND_API_KEY=
MAIL_FROM=
LEAD_INBOX=

# Square (platform subscription billing)
SQUARE_ACCESS_TOKEN=                # server-only; Square API token
SQUARE_ENVIRONMENT=                 # sandbox or production
SQUARE_LOCATION_ID=                 # server-only; payments location
NEXT_PUBLIC_SQUARE_APP_ID=          # browser; Web Payments SDK
NEXT_PUBLIC_SQUARE_LOCATION_ID=     # browser; Web Payments SDK
CRON_SECRET=                        # bearer token protecting /api/billing/run; Vercel Cron sends it automatically
```

Database: the schema is managed in Supabase. RLS policies and helper functions are drafted as SQL under `docs/sql/` and applied in the Supabase SQL editor (not through an automated migration runner). This includes `docs/sql/billing_01_platform_billing.sql` (platform billing tables and policies), which is an unapplied draft until it is run there.

## Project structure

```
app/                      Next.js App Router pages and API routes
  components/             shared UI (AppHeader, TenantProvider, TenantGate, TenantSelector, PodLink)
  <feature>/page.tsx      one page per feature (jobs, pod, invoices, ...)
  api/                    route handlers (auth callback, request-access, billing/run, billing/card)
  subscription page/      earlier Square catalogue / plan-creation scaffolding, superseded by lib/payments/square.ts
lib/
  supabase/               browser, server, and admin (service-role) clients
  tenant/                 pure tenant-resolution logic (context, filter) + tests
  pod/                    POD URL classifier / signer + tests
  payments/               Square client (lib/payments/square.ts) for platform billing + tests
  validation/             Zod schemas
  roles.ts                role-name helper
docs/
  sql/                    RLS + storage policy migrations (rls_01..rls_10), plus billing_01_platform_billing.sql (unapplied draft)
  superpowers/specs/      design specs
  superpowers/plans/      implementation plans
  handoffs/               session handoffs
```

## Roadmap (intended features)

- **Finish the security-week rollout:** apply the tenant-context de-hardcode and the pod-files private-bucket lockdown to production, then a `middleware.ts` auth gate (session refresh + redirect for unauthenticated requests).
- **Lock down the `job-files` bucket:** a second storage bucket with permissive policies, pending a decision on its ownership and use.
- **Live tracking:** TomTom integration to make `/tracking` and `/telematics` real-time instead of read-only snapshots.
- **Payments:** platform subscription billing (Square card on file, daily charge cron, dunning) is live at `/settings/billing`; self-serve signup (a company creating its own account and starting a subscription without an operator provisioning it first) is still future work.
- **Analytics dashboards:** make `/dashboard` and `/super-admin` data-driven; add cross-tenant "which tenant is performing best" views on top of the admin tenant selector; charts and SQL-view aggregation at scale.
- **Admin management:** turn the read-only super-admin companies / users pages into full management, and finish the per-page permissions model (revoke path, controlled state).
- **Design-system rollout:** move the remaining ~14 legacy inline-styled pages onto the design system so they follow the theme. The dark-default "operator theme" itself shipped on 2026-08-13 (see Design system above); what is left is converting those pages' hardcoded colour literals to tokens and adding each path to `lib/nav/themeableRoutes.ts`.
- **User invite flow:** complete first-user-becomes-admin provisioning and settings guards.

## Notes on maturity

This is a working product under active development, not a finished platform. Several data-driven pages use loose (`any`) typing, some carry leftover `console.log` debugging, and a few pages are launchers or read-only pending their backing features. The tenancy and security layer (RLS, storage lockdown, hardened auth callback) has had the most rigorous treatment, including adversarial design reviews. Treat status tags in the Page Inventory as the source of truth for what is live today.
