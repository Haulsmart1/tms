# Billing page restyle: shared components, layout B, real loading states

Date: 2026-09-01
Status: agreed, ready for an implementation plan

## The problem

`/settings/billing` (`app/settings/billing/page.tsx`) is on the design system already: `ds`
wrapper, tokens, `Stat` tiles, the standard header. The bones are right. It still looks
unfinished next to its Settings siblings because it hand-rolls things every other console page
gets from shared components:

- Charge history is a bare `<table>` rather than `DataTable`, so it has no tinted header row,
  no card shadow, no skeleton and no empty state.
- Payment method is a plain bordered `<div>` with a raw `<button>`, not `Card` and `Button`.
- The three banners (load error, past due, post-save notice) are hand-rolled boxes rather than
  `MessageBanner`, so they miss the tinted background and the live-region semantics.
- Status is the raw enum, lowercased with the underscore swapped for a space ("past due"), as a
  bare `Stat` value. Everywhere else in the app a status is a toned `Badge`.
- Next charge and each history row show ISO dates (`2026-10-01`). Every other page formats
  `dd/mm/yyyy` via `toLocaleDateString("en-GB")`.
- Loading is the word "Loading..." under the history heading, while the `Stat` row shows
  "0" vehicles and "£0.00" until the queries return. The loading-skeletons spec
  (`docs/superpowers/specs/2026-08-24-loading-skeletons-design.md`) calls this out as false
  data, not a missing skeleton.
- `SquareCardForm` (`components/billing/SquareCardForm.tsx`) has its own unstyled `<input>` and
  `<button>` instead of `Field` and `Button`.
- The page title is "Subscription"; the Settings launcher card, the sidebar and the README all
  call it "Billing".
- Once "Replace card" is clicked there is no way back out of the form.

## Scope

In: a restyle of `/settings/billing` onto the shared components, the two-card layout agreed
below, real loading states with the route added to `SKELETON_READY_ROUTES`, and a matching
restyle of `SquareCardForm`.

Out, deliberately:

- `/settings/invoices`, the one-tile near-duplicate. Folding it in was offered and declined;
  it stays as is.
- Any change to charge logic, the daily cron, dunning, or the `/api/billing/*` routes. The
  card form's tokenise, verify and POST sequence is untouched.
- The super-admin billing console.

## Decisions, and why

**Layout B: stat row, then two cards, then the table.** Three layouts were compared in the
visual companion. A (today's structure, polished) leaves the VAT breakdown cramped in a `Stat`
sub-line. C (main column plus a "Your plan" sidebar) reads like a SaaS billing page but would
be the only Settings page without a `Stat` row. B keeps the row every sibling has and gives the
breakdown a card of its own.

**Restyle plus real loading, not restyle only.** Adding the route to the skeleton allowlist is
a few more lines than swapping components, and it removes the £0.00 flash. The `/customers`
recipe from the skeletons spec is followed exactly.

**Loading-aware components, not mirror files.** The two new cards each take a `loading` prop
and draw their own skeleton, so the placeholder cannot drift from the real layout. This is the
rule the skeletons spec set; it is restated here because it decides the file layout below.

**Title becomes "Billing".** It matches the launcher card, the sidebar entry and the README.
The sub-copy still says "subscription" so the word is not lost.

**Role gates apply only once tenant status is ready.** `useTenant().role` is unknown while
the context resolves. If the gates ran during loading, every admin would see "Billing is
managed by your company admin" flash before the page appeared. While resolving, the page draws
its skeleton regardless of role.

## Section 1: page shell and gating

- Root: `<TenantGate>` wrapping `<div className="ds min-h-screen bg-canvas font-sans text-ink">`.
  The page has no `TenantGate` today; step 1 of the `SKELETON_READY_ROUTES` procedure requires
  it.
- Header: kicker "Admin", `h1` "Billing", sub-copy "£10 per active licensed vehicle per month,
  plus VAT, charged to your card on your billing date."
- Super-admin (`role === "super_admin"`, status ready): header, then
  `MessageBanner tone="info"` containing the existing copy and the `/super-admin/billing` link.
  Nothing else renders.
- Non-admin (any other role, status ready): header, then `MessageBanner tone="info"` with
  "Billing is managed by your company admin." Nothing else renders.
- Admin: the full page below.

## Section 2: banners and stat row

Three `MessageBanner`s, each always mounted (the component renders `sr-only` when empty, which
is what keeps its live region announcing):

| Banner | Tone | Content |
| --- | --- | --- |
| Load error | danger | "Could not load billing data: {message}" |
| Past due | danger | "Your last payment failed. Replace your card below to bring your subscription back up to date." |
| Notice | success | Set by `SquareCardForm.onComplete`: "Subscription started: £X charged. Next charge dd/mm/yyyy." or "Card updated." |

Stat row, `grid grid-cols-2 gap-2.5 lg:grid-cols-4`, four `Stat` tiles:

| Label | Value | Sub |
| --- | --- | --- |
| Licensed vehicles | count | "counted on each billing date" |
| Monthly total | gross | "£net + £VAT VAT" |
| Status | `Badge` | none |
| Next charge | `dd/mm/yyyy`, or "-" when not set up (the `/settings/licences` empty glyph) | none |

Status badge tones: `active` success "Active"; `past_due` danger "Past due"; `canceled`
warning "Cancelled"; no billing row, neutral "Not set up". The mapping is a pure function,
`billingStatusBadge(status | null)`, in `lib/billing/format.ts` so it is unit tested.

While loading, each `Stat` value is an inline-block `Skeleton` at `h="1.25rem"` (the dashboard's
size), with a width in `ch` roughly matching the digits it stands in for: 2.5ch vehicles, 6ch
monthly total, a 5ch pill for status, 8ch next charge. Sub-lines are omitted. `Stat.value`
already accepts `ReactNode`.

## Section 3: the two cards

`grid gap-3 md:grid-cols-2`, both `Card`s with a `kicker`.

### `PaymentMethodCard` (new, `app/settings/billing/PaymentMethodCard.tsx`)

Props: `{ loading, billing, loadError, showForm, onReplace, onCancel, onComplete }`.

States, in priority order:

1. `loading`: kicker, a skeleton line for the card description, a real but `disabled`
   secondary `Button` "Replace card" (fixed-size control, so real-but-disabled per the
   skeletons spec).
2. `loadError`: kicker and `text-ink-3` copy "Card management is unavailable until billing
   data loads successfully." No form, no button.
3. Card on file and `!showForm`: a row with the lucide `CreditCard` icon in a
   `bg-primary-tint text-primary-deep` square (the Settings launcher's icon treatment),
   "{brand} ending {last4}" in `text-ink`, "Expires {mm}/{yyyy}" in `text-ink-3`, and a
   secondary `size="sm"` `Button` "Replace card" on the right. When status is `past_due` a
   danger `Badge` "Payment failed" sits beside the brand line.
4. No card on file: one line of `text-ink-2` intro, "Add a card to start your subscription.
   Your first charge is taken today.", then `SquareCardForm` with the default submit label.
5. Card on file and `showForm`: `SquareCardForm` with `submitLabel="Save new card"` and
   `onCancel`, which renders a ghost "Cancel" button beside the submit.

### `NextInvoiceCard` (new, `app/settings/billing/NextInvoiceCard.tsx`)

Props: `{ loading, amounts: ChargeAmounts, nextChargeOn: string | null }`. (A `status` prop was
originally listed here and dropped during planning: nothing in the card branches on it, since
`next_charge_on` still holds the retry date when past due.)

Three rows in `text-sm`, values `font-mono tabular-nums` right-aligned:

- "{n} vehicles × £10.00" / net
- "VAT at 20%" / VAT
- a `border-t border-line` rule, then "Total" in `font-semibold` / gross

Footer line in `text-ink-3`: "Charged on dd/mm/yyyy" when there is a next date; "Charged
when you add a card" when there is no billing row. Below it, one line: "The vehicle count is
taken on the billing date, so this can change before then." The footer is unconditional for
`past_due` too, since `next_charge_on` still holds the retry date.

While loading, the three values and the footer date are `Skeleton`s; the labels render real.

### `SquareCardForm` restyle (`components/billing/SquareCardForm.tsx`)

Logic (SDK load, tokenise, `verifyBuyer`, POST, `onComplete`) is not touched. Changes:

- The name input becomes `Field` with `id="cc-name"`, label "Name on card",
  `autoComplete="cc-name"`.
- `#square-card-container` keeps its id (the SDK attaches by selector) and moves to
  `border-ink-3` to match `Field`'s input border, with a `text-sm font-medium text-ink-2`
  label "Card details" above it, for the same reason `Field` documents its border choice.
- The error box becomes `MessageBanner tone="danger"`, always mounted.
- The submit becomes `Button` primary with `loading={submitting}`; the existing
  `if (submitting) return` guard already prevents double submission. `disabled={!ready}`
  stays, since a form the SDK has not attached to is genuinely inactive.
- Two new optional props: `submitLabel?: string` (default "Save card and start subscription")
  and `onCancel?: () => void`. When `onCancel` is given, a ghost `Button` "Cancel" renders
  beside the submit in a `flex gap-2` row.

## Section 4: charge history

An `h2` "Charge history" (`text-base font-semibold`), then `DataTable<ChargeRow>` with
`rowKey={(c) => c.id}` and these columns:

| Header | Align | Cell |
| --- | --- | --- |
| Billing date | left | `formatCycleDate(cycle_date)`, `font-mono` |
| Attempt | left | attempt number |
| Vehicles | right | vehicle_count |
| Amount | right | `formatPence(gross_pence)`, `font-mono tabular-nums` |
| Status | left | success `Badge` "Paid", or danger `Badge` "Failed" followed by the failure code in `text-xs text-ink-3` |
| Receipt | left | `<a target="_blank" rel="noreferrer" className="text-primary underline">View</a>`, or "-" |

`state` is derived: `loading` while `showSkeleton`; `error` when `loadError` is set, with
`onRetry={load}`; `empty` when the array is empty, with `emptyTitle="No charges yet"` and
`emptyDescription="Your first charge appears here after your billing date."`; otherwise
`ready`. Widths are left unset (the "all or none" rule in `DataTable`'s comment).

## Section 5: loading and data flow

Following `/customers`:

- The loader is a `useCallback` that early-returns unless `tenant.status === "ready"`, with
  `tenant.status` in the effect's dependency array. Today the page queries during tenant
  resolution; this stops it.
- `hasLoaded` is set in the loader's `finally`. `showSkeleton = shouldShowSkeleton({
  tenantStatus, fetching: loading, hasData: hasLoaded })`.
- The admin page body carries `aria-busy={showSkeleton || undefined}` and an
  `sr-only role="status"` line "Loading billing" while `showSkeleton`.
- `/settings/billing` is added to `SKELETON_READY_ROUTES`, and the exhaustive assertion in
  `lib/nav/skeletonReadyRoutes.test.ts` (`lists exactly the routes converted so far`) is
  extended to include it.

The three queries (`company_billing`, `platform_charges`, `vehicle_licences`) and the
`computeChargeAmounts(vehicleCount)` call are unchanged.

## Formatting helpers

Two small pure modules, both in `lib/billing/` so vitest reaches them:

- `formatPence(pence: number): string` moves out of the page into `lib/billing/money.ts`
  (it is the page's current `pounds()`): `£` plus two decimals, e.g. `14400` gives `£144.00`.
- `lib/billing/format.ts` (new): `formatCycleDate(isoDate: string): string` parses the
  `YYYY-MM-DD` string as a local date (`new Date(`${value}T00:00:00`)`, the `/drivers`
  pattern, so a UTC parse cannot shift it a day) and returns `toLocaleDateString("en-GB")`;
  returns the input unchanged if it does not parse. `billingStatusBadge(status)` returns
  `{ tone, label }` per the table in Section 2.

## Testing

- `lib/billing/money.test.ts` (exists, extended): `formatPence` for zero, whole pounds, pence,
  and a large value.
- `lib/billing/format.test.ts`: `formatCycleDate` for a valid date, an unparseable string, and
  a date near a DST boundary (the vitest config pins `TZ=Europe/London`, which makes this
  meaningful); `billingStatusBadge` for all four inputs.
- `lib/nav/skeletonReadyRoutes.test.ts`: the exhaustive list assertion updated.
- `npm run typecheck` and `npm test` are the gates before commit.
- Components are not unit tested in this repo. The visual result, both themes, and the four
  `DataTable` states want a signed-in manual pass. The past-due and not-set-up branches can
  be provoked in the Square sandbox (see the README's sandbox postcode note).

## Files

New:

- `app/settings/billing/PaymentMethodCard.tsx`
- `app/settings/billing/NextInvoiceCard.tsx`
- `lib/billing/format.ts`, `lib/billing/format.test.ts`

Changed:

- `app/settings/billing/page.tsx`
- `components/billing/SquareCardForm.tsx`
- `lib/billing/money.ts`, `lib/billing/money.test.ts` (extended with `formatPence` cases)
- `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

README: the `/settings/billing` inventory line already reads `[OK]` and describes the same
behaviour; no status change. No new integrations, no tenancy change.
