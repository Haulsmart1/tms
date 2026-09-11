# Super Admin: real data, search, and company editing

Date: 2026-09-11
Status: approved, not yet implemented

## Problem

The `/super-admin` area is the platform operator's console, and it is the least finished area
of the app. Three things are wrong with it:

1. **The dashboard is fiction.** `app/super-admin/page.tsx` renders four hardcoded stat tiles
   (24 companies, 186 vehicles, 93 users, GBP 4,320 monthly revenue). A warning line says
   "Sample figures, not live platform data", which keeps it honest but useless.
2. **The list pages are too thin to act on.** `/super-admin/companies` shows a name and a UUID
   per company and nothing else. `/super-admin/users` shows a name, a raw tenant UUID and a
   role, with no email, so a user whose `full_name` is null renders as a bare UUID. Neither
   page has a search box.
3. **Nothing can be corrected.** Every page in the area is read only. When a company is signed
   up with the wrong name, or a tenant is created under the wrong company, there is no path to
   fix it other than the Supabase SQL editor.

## Scope

In scope:

- Live figures on the `/super-admin` dashboard.
- Richer, searchable company and user lists.
- A company detail page that can edit the company profile.
- Rename and re-parent for the tenants under a company.
- Bringing the whole area, including the still inline-styled layout, onto the design system.

Out of scope, decided explicitly:

- **Editing billing settings** (billing model, subscription status). Switching a company between
  `v1_immediate` and `v2_period` mid-cycle moves real money and already has a dedicated script,
  `scripts/migrate-company-to-period-billing.mjs`. It does not belong behind a form.
- **Creating or deleting tenants.** Operational tables are keyed by `tenant_id`, so a delete
  either cascades through customer data or orphans it. Neither outcome belongs in a console.
- **Editing users.** The users page gains data and search, not writes.
- **A `super_admin_audit` table.** See "Audit" below.

## Findings that shaped the design

These were established by reading the schema and RLS migrations, and the design depends on them.

**`companies` and `tenants` have no write policy at all.** `docs/sql/rls_04_identity_tables.sql`
gives both a select policy and stops there, with the comment "No write policy (service role
provisions)" and, for tenants, "tenants is the root of trust for `can_access_tenant`, so writes
are service-role only". A client-side Supabase update against either table is therefore not a
permissions bug to fix; it is a boundary to respect. Every write in this spec that touches those
two tables goes through a server route holding the service-role key.

**`company_profiles.tenant_id` holds a COMPANY id, not a tenant id.** The column is misnamed.
`rls_04_identity_tables.sql:27` states it directly, and the policy body confirms it:
`tenant_id = public.get_my_company_id()`. So there is exactly one profile row per company, which
is the shape this feature wants.

> Pre-existing issue, noted and deliberately not fixed here: `/settings/company` looks the
> profile up with `selectedTenantId`, which is only correct when a tenant id happens to equal
> the company id. That is a separate bug with its own blast radius, and folding it into this
> change would mean editing a page this feature does not otherwise touch.

**`vehicles` has no `company_id`.** A vehicle reaches its company through its tenant. Filtering
on `vehicles.company_id` answers PostgREST 42703 and fails the whole request.

**Some `billing_0*` migrations are not applied on the live project.** `vehicle_addon_charges`
(billing_03) and `period_charges` (billing_06) may not exist. Any dashboard query that assumes
they do will fail.

**`isThemeableRoute` is exact match, not prefix match**, and `lib/nav/themeableRoutes.test.ts`
asserts the list verbatim. A new dynamic route defaults to pinned dark until it is listed.

## Approach

Keep reads on the client through RLS, and add server routes only where RLS forbids the write.

RLS already makes the correct decision for super_admin reads. Routing those through an API would
add a second, weaker copy of an authorization decision Postgres is already making. The writes are
the opposite case: `companies` and `tenants` are deliberately unwritable from the client, so a
service-role route is the only path, and confining that key to two narrow PATCH endpoints keeps
the dangerous surface small.

Two alternatives were considered and rejected. A full `app/api/super-admin/` layer fronting every
read would rewrite four working pages to duplicate reads RLS handles correctly. Server components
with server actions would break from every other console page's pattern, and the search and edit
interactivity would drag most of it back to the client anyway.

## Page structure

### `/super-admin` (dashboard)

Four live tiles replace the hardcoded four, and the "Sample figures" warning is deleted.

| Tile | Value | Sub-line |
| --- | --- | --- |
| Companies | `count` on `companies` | "n with an active subscription", from `company_billing.status` |
| Vehicles | `vehicles` row count | "n billable", via `countBillableVehicles` |
| Users | `count` on `profiles` | "n super admins" |
| Collected (28d) | summed `gross_pence` of succeeded charges in the trailing 28 days | "across n companies" |

Counts use `count: 'exact', head: true` so no rows cross the wire. The billable vehicle figure
cannot: it needs vehicle and licence rows joined in memory, exactly as `/super-admin/billing`
already does it. That is acceptable at current scale and is the first thing to move to a SQL view
when the platform grows.

The link cards below the tiles stay as they are, with a fifth card added for Requests, which is
reachable from the nav but missing from the card grid today.

### `/super-admin/companies` (list)

Becomes a `DataTable`. Columns: company name, tenants, billable vehicles, users, billing model
badge (v1 / v2), subscription status badge. A search box filters it. A row click navigates to the
detail page.

### `/super-admin/companies/[id]` (new, detail and edit)

Four regions:

- **Profile form.** The `company_profiles` row for this company, mirroring the field set at
  `/settings/company`: company name, trading name, legal entity type, industry type, registration
  number, tax number, VAT number, EORI number, operator licence number, business email, business
  phone, website, address lines, city, region, postcode, country code, currency code, timezone,
  language code, notes. If no row exists, saving creates one.
- **Company name.** `companies.name` is a different row from `company_profiles.company_name`, and
  both are shown to users in different places today. The form writes both from one input, so they
  cannot drift.
- **Tenants.** Each tenant with a rename control and a "Move to another company" action.
- **Read-only context.** Vehicles, users and recent charges for the company, so the operator can
  see what a re-parent will affect before confirming it.

The US-specific profile fields (`us_ein`, `usdot_number`, `mc_number`, `ifta_number`,
`irp_number`, `scac_code`) are included but collapsed behind a disclosure, as they are on
`/settings/company`, since this is a UK and EU product.

### `/super-admin/users`

Keeps its shape, gains email, resolved company and tenant names in place of raw UUIDs, and a
search box. No editing.

### `/super-admin/invoices` and `/super-admin/requests`

Search box only. No other change.

## Data and logic modules

New pure logic lives in `lib/superAdmin/`, with colocated tests. `lib/` is the only tree vitest
covers, so business logic that needs testing cannot live in `app/`.

### `lib/superAdmin/summary.ts`

Rolls raw rows into the company list rows and the dashboard tiles. It is pure: the pages fetch,
this module aggregates.

**Collected (28d)** sums `gross_pence` where `status = 'succeeded'` and
`created_at >= now() - 28 days` across three tables:

- `platform_charges` (v1 cycle charges)
- `vehicle_addon_charges` (v1 mid-cycle additions)
- `period_charges` (v2 period charges)

`period_charges` has a `refunded` status that the v1 tables do not. A refunded period collected
nothing, so `refunded` is excluded alongside `failed`. A test pins this. Counting a refund as
revenue is the kind of error nobody notices until the number has to be defended to someone.

**A missing table degrades the tile, not the page.** Each of the three charge sources is queried
independently. A source that errors with a missing-relation code contributes zero, and the tile
renders with a footnote naming what could not be counted, for example "excludes v2 periods". A
silent zero would be worse than the hardcoded placeholder it replaces. Any other error surfaces
in the existing `MessageBanner`.

### `lib/superAdmin/search.ts`

The filter predicate. Case insensitive, whitespace trimmed, and matches when every space
separated term appears in any searchable field, so "acme past" finds the past-due Acme.

Searchable fields are declared per page rather than derived by stringifying the row, so a UUID
match is a deliberate choice and not an accident of serialization.

### `lib/superAdmin/companyEdit.ts`

Validation and normalization for a profile patch, and the security control of this feature.

The service-role key bypasses RLS completely, so passing a request body to `.update()` would let
any accepted key reach any column. This module builds the patch from an explicit allowlist of
editable columns and drops everything else. It also:

- trims strings, and converts empty strings to `null`, so a cleared field reads as absent rather
  than as `""`
- uppercases `country_code` and `currency_code`
- rejects a malformed `business_email`

### `lib/superAdmin/guard.ts`

`requireSuperAdmin()` resolves the session from cookies and checks the role via `SUPER_ADMIN_ROLE`
and `extractRoleName` from `lib/roles.ts`, which is the single source of truth for that string.
`app/super-admin/layout.tsx` is refactored to call the same helper, so the page gate and the API
gate cannot drift apart.

## API routes

### `PATCH /api/super-admin/companies/[id]`

Body: `{ name: string, profile: Record<string, unknown> }`.

1. `requireSuperAdmin()`, else 401 or 403.
2. Normalize and validate through `companyEdit.ts`, else 400 with the field at fault.
3. Service-role update of `companies.name`.
4. Service-role upsert of `company_profiles`, keyed on `tenant_id = companyId`.

Both writes are reported together; a partial failure returns 500 and names which write failed.

### `PATCH /api/super-admin/tenants/[id]`

Body: `{ name?: string }` or `{ company_id?: string }`.

Rename is a straightforward service-role update. Re-parenting verifies the target company exists,
then updates `tenants.company_id` and returns counts of what moved.

**Re-parenting states its billing consequence on screen.** Under v1, `vehicle_cycle_coverage` rows
are keyed by company, so vehicles arriving at a new company have no coverage row there and will be
charged pro-rata at the next billing run. That is arguably the correct outcome, but it is money,
so the confirm dialog says it in words, shows the vehicle and user counts being moved, and requires
the operator to type the tenant's name. The route does not write coverage rows to paper over it.

### `GET /api/super-admin/users`

Email lives in `auth.users`, not `profiles`, so it needs the service role. This route joins
profiles to auth users and returns id, email, full name, role, tenant id and name, company id and
name. It backs the users list entirely, replacing that page's client query.

## Audit

Structured server-side logging only: actor id, target id, and the *names* of changed fields, not
their values, so the log does not accumulate customer PII over time.

A `super_admin_audit` table is recorded here as a follow-up rather than built now. There is no
automated migration runner, several `billing_0*` files are already written but unapplied, and a
route that writes to a table which may not exist yet trades a missing audit trail for a noisy
error on every edit. The logging above is the honest version of what can be delivered in this pass.

## Design system

The area is converted completely, as part of this change and not after it.

- `app/super-admin/layout.tsx` moves off inline styles. It currently hardcodes
  `background: "#1e1b4b"`, white link text and a `CSSProperties` object, and is the last inline
  styled surface in the area now that every page under it is tokenised. It becomes
  `ds font-sans bg-surface` with tokenised nav links and the active route marked.
- The companies and users lists move from stacked cards to `DataTable`, matching
  `/super-admin/invoices` and `/super-admin/billing`. Its built-in `loading`, `error` and `empty`
  states replace the hand-rolled skeleton blocks.
- The edit form uses `Field`, `Select`, `Textarea` and `Button`. The re-parent confirmation uses
  `Modal`. Statuses use `Badge`. Dashboard tiles keep `Stat`. Errors keep `MessageBanner`.
- New `components/SearchInput.tsx`, styled from the same input rules as `Field` so the two cannot
  drift apart.
- No colour literals and no Tailwind `dark:` variants anywhere. Under this app's inverted theme
  default, `dark:` means the opposite of what it reads as.
- Empty search results say which query matched nothing and offer a clear button, rather than the
  generic "No companies found", which would read as "you have no customers".

### Theme activation

`/super-admin/companies/[id]` is a dynamic route, and `isThemeableRoute` is exact match, so it
would default to pinned dark. `lib/nav/themeableRoutes.ts` gains a narrowly scoped prefix list
containing only `/super-admin/companies/`. Exact match stays the default, which preserves the
reason `/driver/jobs/[jobId]` is deliberately excluded while `/driver/dashboard` is listed.
`lib/nav/themeableRoutes.test.ts` asserts the list verbatim and is updated in the same change.

## Testing

| File | Covers |
| --- | --- |
| `lib/superAdmin/summary.test.ts` | refunds excluded from collected revenue; a missing charge source degrades to zero and sets the footnote flag; billable vehicle counts route through `countBillableVehicles` |
| `lib/superAdmin/search.test.ts` | multi-term matching, case insensitivity, declared fields only, empty query returns everything |
| `lib/superAdmin/companyEdit.test.ts` | the column allowlist drops `id`, `tenant_id` and unknown keys; empty string becomes null; country and currency uppercased; malformed email rejected |
| `lib/nav/themeableRoutes.test.ts` | the new prefix rule, and that it does not theme `/driver/jobs/[jobId]` |

`npm run typecheck` and `npm test` are the gate before the branch is considered done. Per the
repo's own note, typecheck is the fast correctness gate and is not covered by `npm test`.

## Risks

- **The service-role key gains two new callers.** Mitigated by `requireSuperAdmin()` sharing one
  implementation with the page gate, and by the column allowlist being a tested pure function
  rather than an inline check.
- **Re-parenting a tenant moves customer data and changes who is billed.** Mitigated by the typed
  confirmation, the counts shown before confirming, and the billing consequence stated in words.
  Not mitigated by an undo, which is why the confirmation is deliberate friction.
- **Unapplied migrations.** The dashboard is designed to degrade per source. The company list and
  detail page read only tables that predate the billing work, except the billing model badge,
  which follows the same degrade-to-unknown rule.
