# Console Restyle (Remaining Pages) Findings

Logged while restyling `ethan/console-restyle-remaining`. Nothing here is
fixed on that branch (spec: logic freeze). Each entry: file, what was
seen, why it matters, suggested follow-up. Continues the queue in
2026-08-18-stuart-integration-findings.md.

## Known before the restyle started

### 1. /tachograph and /telematics have no tenant scoping
Neither page uses TenantGate, useTenant, or a tenant filter. Tachograph
selects `drivers` and `driver_activity_logs`, telematics selects
`telematics_positions`, all via bare `select("*")` with `limit`. RLS is
the only guard, if it covers those tables. Needs the tenant-context
treatment when the freeze lifts.

### 2. /settings/invoices (Billing) counts licences without a tenant filter
`vehicle_licences` is queried with only `.eq("active", true)`, so the
"Monthly Charge" figure is cross-tenant if RLS allows it. Same
treatment needed as entry 1.

### 3. /settings/permissions is unscoped and its toggle can only add
`profiles` is selected with no tenant filter. The checkbox grid is
uncontrolled (no `checked` prop), so it never reflects saved state, and
`toggle()` only upserts a `user_permissions` row; nothing ever deletes
one, so unticking is impossible. Pre-existing logic, frozen; the page
needs a real read-modify-write cycle when the freeze lifts.

### 4. /settings/company bypasses the tenant switcher
No TenantGate/useTenant. It resolves tenancy from a direct `profiles`
lookup (`resolveCompanyId`), reads `profiles.company_id` but writes
`company_profiles.tenant_id`. Same class as the /assets gap (Stuart
findings entry 10).

### 5. /settings/company ships console.log debug scaffolding
Auth user, Supabase URL, profile rows, and the save payload are logged
to the console (lines ~233-473 pre-restyle). Remove or gate behind a
dev flag when the freeze lifts.

### 6. /vehicles updates and inserts skip filterByTenant
`saveVehicle`'s update/insert path (~lines 436-449 pre-restyle) does
not go through `tenant.filterByTenant`, unlike the fleet-policy writes
on the same page. RLS is the only guard on the update's row scope.

### 7. Mojibake and em-dashes in /invoices copy
`formatDate` returns the literal `â€”` (corrupted em-dash) and option
labels use `Â·` (corrupted middot). Carried verbatim under the content
freeze; fix the encoding and sweep for the no-em-dash convention when
the freeze lifts.

### 8. Placeholder-only controls across the batch
/vehicles' four vehicle-detail inputs, the whole /settings/licences
form, /customers' search input, and /settings/portal-invites' selects
have no label or aria-label. Same class as Stuart findings 21/31;
converge on shared Field/Select in the post-freeze pass.

## Logged during the restyle

### 9. /tachograph heading outline skips levels
The driver-card h3s precede the page's first h2 ("Recent Activity")
because the driver grid has no heading of its own. Pre-existing
structure, reproduced by the restyle. Give the driver grid an h2 when
the freeze lifts.

### 10. /tachograph and /telematics render silent empty grids
When the queries return no rows, both pages show an empty grid with no
empty-state message. Pre-existing; add the standard empty-state line
when the freeze lifts.

### 11. Settings kicker labels diverge
This batch's settings pages use the kicker "Admin" (per the plan);
the earlier-restyled /settings/users uses "Settings". Reconcile the
convention family-wide when the freeze lifts.
