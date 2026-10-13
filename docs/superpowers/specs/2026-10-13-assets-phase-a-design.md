# Assets Phase A: register rework, search, archive and delete

Date: 2026-10-13
Branch: `ethan/assets-phase-a`
Status: implemented on `ethan/assets-phase-a` (plan `docs/superpowers/plans/2026-10-13-assets-phase-a.md`);
`assets_01` not applied. Review fixes made during implementation are folded into the sections below.

## Context

`/assets` today is an always-open add/edit form above a card grid. It can create and edit, but has no
search, no filters, no archive and no delete. README still says edit is missing; it is not.

The asset work is split into three phases, each with its own spec, plan and branch:

- **Phase A (this spec):** table register, search and filters, add/edit in a dialog, archive/restore,
  admin-only permanent delete, and office-only writes.
- **Phase B:** maintenance history on an asset, with a "log maintenance" shortcut.
- **Phase C:** assigning assets to vehicles and to jobs (needs its own schema design).

### Live schema findings (read-only queries against `llxliojjtofqdmddbdud`, 2026-10-13)

- `assets` has 0 rows. No backfill concerns.
- `assets` already carries unused columns: `assigned_vehicle_id`, `assigned_driver_id`, `purchase_date`,
  `last_service_date`, `next_service_date`. Two unused, empty tables also exist: `asset_movements` and
  `asset_maintenance` (both `ON DELETE CASCADE` from `assets`). No code reads or writes any of these.
  Phase A leaves them alone; Phase B and C decide whether to reuse or drop them.
- `maintenance_records.asset_id` references `assets(id) ON DELETE SET NULL`, so deleting an asset today
  silently orphans its maintenance history.
- RLS on `assets` is one policy, `tenant_access`, `FOR ALL` using `can_access_tenant(tenant_id)`. Any
  tenant member, drivers included, can insert, update and delete from the browser.
- `pod_caller_is_office()` is defined in `shifts_06`, which is not applied live.

## Decisions

| Question | Decision |
|---|---|
| Register layout | Table only (`DataTable`), no card view |
| Archive model | Separate `archived_at` column; "Inactive" keeps meaning "owned but not in use" |
| Permanent delete | Allowed only when the asset has no maintenance history; otherwise archive |
| Who archives / restores | Any office user (drivers refused) |
| Who deletes | Admins and super admins only (`can_manage_tenant`) |
| Enforcement | Database enforces it (policies, grants, trigger, `RESTRICT` FK); routes are not the only guard |
| Driver create/edit | Locked now: insert and update require an office caller |

## 1. Database: `docs/sql/assets_01_archive_and_office_writes.sql`

Applied by hand in the Supabase SQL editor, like every other migration. Idempotent where practical.

1. **Columns.** `alter table assets add column if not exists archived_at timestamptz null`, and
   `archived_by uuid null references profiles(id)`, plus a check constraint `archived_by is null or archived_at is not null`.
   Also a unique index on `(tenant_id, asset_number)` where `asset_number is not null`, so the database
   enforces one asset number per tenant (the page's duplicate check can lose a race).
2. **History-preserving FK.** Drop `maintenance_records_asset_id_fkey` (`ON DELETE SET NULL`) and re-add it as
   `ON DELETE RESTRICT`. `asset_movements` and `asset_maintenance` become `RESTRICT` too (unused, empty today; CASCADE would silently destroy their history once Phase B/C writes rows).
3. **Office check.** `create or replace function public.pod_caller_is_office()` with a body byte-identical to
   `shifts_06`, plus the same `revoke`/`grant` lines. Either migration can be applied first.
4. **Policies.** Drop `tenant_access` on `assets` and create:
   - `assets_select`: `FOR SELECT` using `can_access_tenant(tenant_id)` (drivers can still look up assets).
   - `assets_insert`: `FOR INSERT` with check `can_access_tenant(tenant_id) and pod_caller_is_office()`.
   - `assets_update`: `FOR UPDATE` using and with check `can_access_tenant(tenant_id) and pod_caller_is_office()`.
   - No DELETE policy, and `revoke delete, truncate on public.assets from public, anon, authenticated`.
5. **Server-only archive columns.** A `BEFORE INSERT OR UPDATE` trigger on `assets`, not security definer (so
   `current_user` is the real caller):
   - `service_role`, `postgres` and `supabase_admin` are exempt. `postgres` must be: the
     `archived_by ON DELETE SET NULL` action runs as the table owner (`postgres`, checked in VERIFY), and
     would otherwise hit `AST02` when a profile that archived an asset is deleted.
   - `AST01`: refuses any browser change to `archived_at` or `archived_by`, and archive columns on insert.
   - `AST03`: pins `tenant_id` and `company_id` (no move on update; on insert the company must be the tenant's).
   - `AST02`: refuses any browser update to a row whose `archived_at` is not null (restore first, then edit).
   - The unique index answers a duplicate asset number with `23505`.
6. **Verify block.** Read-only selects at the end confirming the columns, the FK action, the three policies,
   the missing DELETE grant and the trigger.

## 2. Server routes and `lib/assets/`

All three routes use the service-role client and authorize explicitly against **the asset's own
`tenant_id`**, never the tenant selector. Each route file is listed as protected in
`lib/auth/routeClassification.test.ts`; none is added to `publicRoutes.ts`.

| Route | Authorization | Effect |
|---|---|---|
| `POST /api/assets/[id]/archive` | `authorizeOfficeTenant(admin, user.id, tenantId, "access")` | `archived_at = now()`, `archived_by = user.id` |
| `POST /api/assets/[id]/restore` | same | clears both columns |
| `DELETE /api/assets/[id]` | `authorizeTenant(admin, user.id, tenantId, "manage")` | deletes if no history |

Contract, shared shape with `DELETE /api/vehicles/[id]`:

- `200 {ok:true}`
- `401` not signed in
- `403` no access to this asset's tenant
- `404` unknown id or not a UUID
Every non-200 body is `{ error: <readable sentence>, code: <result> }` (`assetRouteResponse` in
`lib/assets/deleteRule.ts`); the page shows `error`.

- `409 code "has_maintenance_history"` delete refused by maintenance history
- `409 code "referenced"` delete refused by any other foreign key into `assets`
- `409 code "already_archived"` / `"not_archived"` no-op archive or restore
- `503 code "needs_migration"` the `assets_01` columns are missing (PostgREST `42703` / `PGRST204`)
- `500` generic body; detail logged with `console.error`

Delete is checked twice: the route counts `maintenance_records` for the asset and calls
`decideAssetDelete`; the `RESTRICT` FK is the backstop for a record inserted between check and delete,
and its `23503` maps to the same 409. No RPC is needed. Without `assets_01` the count still runs first,
so a delete is never blind.

New pure modules, each with a colocated test:

- `lib/assets/deleteRule.ts`: `decideAssetDelete(counts: { maintenanceRows: number })` and the result to
  status/body mapping. Takes a counts object so Phase C can add assignment history as one more field.
- `lib/assets/register.ts`: `filterAssets(assets, { query, typeId, status, mechanical, showArchived })` and
  `sortAssets(assets, key, direction)`. Search matches name, asset number, registration, serial number and
  barcode, case-insensitive, trimmed. Archived rows are excluded unless `showArchived`. Sort is stable.
- `lib/assets/errors.ts`: maps `AST01`, `AST02`, `AST03`, `42501` and `23505` to user messages, falling
  back to the raw message, in the style of `lib/billing/unlicensedVehicle.ts`.
- `lib/assets/types.ts` and `lib/assets/payload.ts`: the shared asset types and the form-to-row payload,
  moved out of the page so they can be tested.

## 3. The page

Files: `app/assets/page.tsx` (shrinks), new `app/assets/AssetDialog.tsx`, `app/assets/StatusBadge.tsx` and
`app/assets/saveAsset.ts`. `app/assets/AssetCard.tsx` and `app/assets/types.ts` are deleted (types live in
`lib/assets/types.ts`).

1. **Header.** Kicker "Fleet", title "Assets", count badge, and an **Add asset** button (hidden for drivers).
2. **Toolbar.** `SearchInput`; `Select` filters for Type, Status (Any / Active / Maintenance / Inactive) and
   Mechanical (Any / Yes / No); a **Show archived** toggle; a "Clear filters" link shown only when a filter
   is set. Filtering is client-side over the loaded list via `lib/assets/register.ts`.
3. **Register.** `DataTable` with columns Asset, Number, Type, Identifier (registration, serial or barcode,
   whichever is set), Status (badge, plus a muted "Archived" badge for archived rows), Mechanical.
   - Header sorting: add an optional `sortKey` on `Column` and optional `sort` / `onSortChange` props on
     `DataTable`. Backward compatible; existing callers are unchanged. Default sort is newest first.
   - Loading uses `DataTable`'s `loading` state, still gated by `shouldShowSkeleton`.
   - Two empty states: "No assets yet" and "No assets match these filters" with a Clear button.
4. **Asset dialog** (`Modal`, `size="lg"`), opened by clicking a row:
   - View mode: every field; actions Edit, Archive or Restore, and Delete (rendered only for admin and
     super admin tiers; the server still decides).
   - Edit mode: the current form with unchanged behaviour (per-tenant duplicate asset-number check,
     mechanical default by type, `company_id` read from the target tenant row on insert).
   - **Add asset** opens the dialog straight into edit mode.
   - Archived asset: Edit disabled with a "Restore to edit" note (matches `AST02`).
   - Delete confirms in the dialog by typing the asset number. A 409 shows "This asset has maintenance
     history. Archive it instead."
   - Phase B's maintenance history will slot into this dialog.
5. **Roles.** Drivers get a read-only table: no Add, Edit, Archive or Delete. "All tenants": viewing and
   editing work; adding asks for a single tenant first, as today.
6. **Missing migration.** If `archived_at` is absent from the select (`42703`), the page retries without it
   and hides the archive controls and toggle.

## 4. Errors and testing

Errors: routes catch everything, log the detail, and return a generic 500; 4xx bodies are readable.
Browser writes pass through `lib/assets/errors.ts`.

Unit tests (vitest, `lib/` only):

- `lib/assets/deleteRule.test.ts`: refuses with history, allows without, `23503` maps to 409.
- `lib/assets/register.test.ts`: search over all five fields, case and whitespace; each filter alone and
  combined; archived hidden by default and shown with the toggle; sort direction and stability.
- `lib/assets/errors.test.ts`: each code to its message; unknown errors fall through.
- `lib/assets/officeFunctionSql.test.ts`: the `pod_caller_is_office()` body in `assets_01` matches
  `shifts_06` exactly.
- `lib/auth/routeClassification.test.ts`: the three new route files listed as protected.

`npm run typecheck` covers the `DataTable` prop change.

Manual signed-in pass (after applying `assets_01`):

1. Admin: add, edit, archive, restore an asset.
2. Admin: delete an asset that has a maintenance record (expect the 409 message), then one without.
3. Office staff: archive works, Delete is not shown, a forced DELETE call answers 403.
4. Driver: table is read-only; a forced browser insert or update is refused by RLS.

## Docs

- README `/assets` row: edit, archive and admin-only delete exist; search and filters.
- CLAUDE.md: one bullet saying asset delete and archive are server-only (`assets_01`), drivers cannot
  write assets, and `maintenance_records.asset_id` is `RESTRICT`.
- `docs/sql/prodfix_00_APPLY_ORDER.md`: add `assets_01` (independent of `shifts_06`).

## Out of scope

- Maintenance history on the asset (Phase B).
- Assignment to vehicles or jobs, and the fate of `assigned_*`, `asset_movements`, `asset_maintenance`
  (Phase C).
- Server-side pagination or search. Client-side filtering is fine at fleet scale; revisit if a tenant
  passes a few thousand assets.
