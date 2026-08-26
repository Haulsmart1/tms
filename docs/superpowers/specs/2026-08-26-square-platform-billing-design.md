# Square Platform Billing (Subscriptions)

**Date:** 2026-08-26
**Status:** Approved design, pending implementation plan

## What this is

The platform-to-operator money flow: TMS Wizzard charging each customer company its monthly
subscription (GBP 10 per vehicle per month, plus VAT) via Square, with the card managed
self-serve by the company's admin inside the app. This is the groundwork for self-serve
signup: the future signup flow ends on the same "add payment method" step built here.

This is distinct from the existing Stripe Connect integration
(`app/api/settings/payments/stripe/connect/`, `tenant_stripe_connections`), which lets a
haulage operator collect payments from their own customers. That flow is untouched.

## Decisions (with rationale)

1. **Square, not Stripe Billing.** Business decision: the Square account exists and is the
   chosen provider for this flow. The Stripe integration remains for the tenant-to-customer
   flow only, so the two providers never overlap on a money flow.
2. **Self-managed card-on-file in-app.** A company `admin` adds a card on a billing settings
   page. No super-admin action needed to collect payment. Chosen over super-admin driven
   Square invoicing because it reuses directly for self-serve signup.
3. **Snapshot-in-advance billing.** On each billing date, count the company's active
   licensed vehicles that day and charge count x GBP 10 (plus VAT) for the month ahead.
   No proration, no refunds for mid-month removals, vehicles added mid-month are free until
   the next cycle. Chosen for simplicity: at GBP 10 per vehicle the fairness delta of
   proration is pennies, and the invoice line stays trivially explainable.
4. **VAT registered.** Every charge is GBP 10.00 net + 20% VAT = GBP 12.00 gross per
   vehicle. Receipts and records carry the net/VAT split. The VAT rate is stored on every
   charge row so a future rate change never corrupts history.
5. **One subscription per company, not per tenant.** Matches the existing role model
   (`admin` is company-wide) and the existing `/super-admin/billing` maths (billable
   vehicles across all the company's tenants).
6. **First charge immediately on card add**, then monthly on that anchor date. Each company
   has its own anchor day. No trials in v1; a future trial is a delayed subscription start
   date, which this model accommodates without redesign.
7. **Failure handling: retry then flag, human decides.** Automatic retries over about a
   week, then `past_due` status, an admin-facing banner, and super-admin visibility.
   No automatic access lockout in v1 (there is no edge auth layer to hang one on yet, and
   with few customers the relationship is personal).
8. **Recurring engine is ours: card on file + daily cron + Square Payments API.** Square
   Subscriptions was rejected because its plans are fixed-price, so a variable vehicle
   count would need a cron mutating each subscription before every cycle anyway. Square
   Invoices was rejected because its emailed invoices would duplicate the platform's own
   invoice generation. Square is purely the payment rail; VAT paperwork stays with the
   existing super-admin invoice machinery.

## Data model

New numbered migration in `docs/sql/` (applied manually in the Supabase SQL editor, like
the RLS series): `billing_01_platform_billing.sql`.

### `company_billing` (one row per company)

| Column | Notes |
|---|---|
| `company_id` | PK, FK to companies |
| `square_customer_id` | One Square Customer per company; Square `reference_id` set to `company_id` for dashboard cross-reference |
| `square_card_id` | Current card on file |
| `card_brand`, `card_last4`, `card_exp_month`, `card_exp_year` | Display-only, so the settings page renders without calling Square |
| `status` | `active` / `past_due` / `canceled`; no row means never set up |
| `anchor_day` | 1 to 31, the day of month the card was first added |
| `next_charge_on` | Date, stored explicitly so the cron query is a plain date comparison |
| `retry_at`, `retry_count` | Non-null only while dunning is in progress |

Anchor days beyond a month's length clamp to that month's last day (signed up on the 31st
of January means charged on the 28th of February).

### `platform_charges` (one row per attempt, append-only)

| Column | Notes |
|---|---|
| `id` | PK |
| `company_id` | FK |
| `cycle_date` | The billing date this attempt belongs to |
| `attempt` | 1 to 4; unique on (`company_id`, `cycle_date`, `attempt`) |
| `vehicle_count` | Snapshot at charge time |
| `net_pence`, `vat_pence`, `gross_pence` | Integer pence, never floats |
| `vat_rate` | Stored per charge (20.0 today) |
| `currency` | Fixed `GBP` |
| `square_payment_id`, `receipt_url` | From Square on success |
| `status` | `succeeded` / `failed` (zero-vehicle cycles record `succeeded` with zero amounts and no payment id) |
| `failure_code` | Square error code on failure |
| `created_at` | Timestamp |

### RLS

- Company admins can `SELECT` their own company's rows in both tables (the billing page
  reads through the normal client). `super_admin` reads all.
- No INSERT/UPDATE/DELETE policies for authenticated users at all. Every write comes from
  server API routes using the service-role client. Fail closed, matching the rest of the
  RLS layer.

## Server plumbing

- `lib/payments/square.ts`: lazy singleton Square client mirroring `lib/payments/stripe.ts`
  (server-only guard, env validation, loud failure on missing or malformed config).
- `lib/billing/`: all pure logic with colocated vitest tests (only `lib/` is test-covered,
  so API routes stay thin wrappers over these). Contents: charge maths and VAT split,
  anchor-day clamping, retry scheduling, status transitions, idempotency key construction,
  and the vehicle-count definition extracted so `/super-admin/billing` and the cron share
  one implementation and cannot drift.

### Environment variables

| Variable | Side | Notes |
|---|---|---|
| `SQUARE_ACCESS_TOKEN` | server | The sandbox token currently in `.env.local` as `SQUARE_SANDBOX_TOKEN` should be renamed to this |
| `SQUARE_ENVIRONMENT` | server | `sandbox` or `production`; a mismatch with the token fails loudly at client construction |
| `SQUARE_LOCATION_ID` | server | Needed for payments |
| `NEXT_PUBLIC_SQUARE_APP_ID` | browser | Web Payments SDK |
| `NEXT_PUBLIC_SQUARE_LOCATION_ID` | browser | Web Payments SDK |

Still needed from the Square developer dashboard: the application ID and location ID
(sandbox versions first).

## Flows

### Card setup (`/settings/billing`, admin only)

1. Page loads the Square Web Payments SDK card element (hosted iframe fields; raw card
   numbers never touch our code or servers, keeping us out of PCI scope).
2. On submit the SDK tokenizes the card and runs `verifyBuyer()`. This is the 3-D Secure
   step. UK cards fall under Strong Customer Authentication, so storing a card on file
   requires this initial challenge; subsequent monthly charges are merchant-initiated
   transactions and SCA-exempt. This is required for v1, not optional: without it banks
   will start declining the recurring charges.
3. POST the card token and verification token to `/api/billing/card`. The server verifies
   the caller is an `admin` of the company (reusing the role-authorization helpers from
   the security work), finds or creates the Square Customer, and calls `CreateCard`.
4. The first charge runs immediately: snapshot vehicle count, charge count x GBP 12,
   record the attempt in `platform_charges`, and only on success upsert `company_billing`
   (status `active`, `anchor_day` set, `next_charge_on` one anchor-clamped month ahead).
   The response includes the receipt URL so the admin sees the confirmation right away.
   If the first charge fails, `company_billing` is not written, so no half-configured
   subscription exists; the Square customer and card are harmless orphans, the failed
   attempt stays in the audit trail, and the admin sees the decline and can try another
   card.

### Monthly charge (daily cron)

- `vercel.json` cron fires once daily and calls `/api/billing/run`, authenticated by a
  `CRON_SECRET` bearer header. The route rejects anything else; it can charge cards, so
  it is locked accordingly.
- Query: companies where `status != 'canceled'` and (`next_charge_on <= today` or
  `retry_at <= today`). All date logic in Europe/London.
- Companies are processed independently; one failure never aborts the batch.
- Per company: snapshot active licensed vehicles across all its tenants (the shared
  `lib/billing/` count), then `CreatePayment` with idempotency key
  `chg_{companyId}_{cycleDate}_{attempt}`. A crashed-and-rerun cron cannot double-charge.
- Success: record the attempt, advance `next_charge_on` one anchor-clamped month, clear
  retry state.
- Zero vehicles: no payment, record a zero-amount cycle row, advance the date.

### Failure and recovery

- Failed attempt: record it, set `retry_at` two days out, so attempts land on days 1, 3,
  5 and 7 of the cycle.
- Fourth failure: `status = 'past_due'`, retries stop, and no new cycles start, so debt
  does not silently stack against a dead card.
- Surfacing: a banner for that company's admins linking to `/settings/billing`, and a
  status column with past-due highlighting on `/super-admin/billing`.
- Recovery: the admin adds a replacement card (fresh tokenize and verify, replace
  `square_card_id`), the outstanding cycle is retried immediately, and on success the
  company returns to `active` and its normal schedule.

## UI

- **`/settings/billing`** (new page, design-system styling: `ds font-sans bg-canvas
  text-ink`, tokens only, path added to `lib/nav/themeableRoutes.ts`). Shows: current-plan
  summary (active vehicle count, per-vehicle price, VAT, monthly total, next charge date),
  the card on file (brand, last4, expiry) with an update button, the Square card form for
  setup or replacement, and a charge-history table read from `platform_charges` (date,
  vehicles, amount, status, receipt link). Admin-gated like the other admin settings
  pages; staff never see it.
- **Past-due banner** for admins of a `past_due` company. Placed inside the existing
  settings/nav shell rather than a new global fetch on every page; exact placement decided
  at implementation against what `AppHeader` and `TenantProvider` already load.
- **`/super-admin/billing`** gains a billing-status column (no card / active / past_due),
  last charge result, and next charge date per company. Its invoice generation stays
  as-is.

## Error handling

- Square SDK and API errors mapped to human messages on the card form (declined vs
  expired vs network).
- The cron route logs per-company outcomes and returns a summary (processed, succeeded,
  failed) so a manual run reports what happened.
- Idempotency keys on every payment creation.
- Environment mismatch (sandbox token against production, or vice versa) fails loudly at
  client construction, matching the Stripe guard's style.

## Testing

- **Unit (vitest, `lib/billing/`):** VAT split maths, anchor-day clamping across month
  lengths including 31st into February, retry scheduling, status transitions, idempotency
  key construction, zero-vehicle cycles. The pinned `Europe/London` test timezone covers
  the date-sensitive cases.
- **Manual (Square sandbox):** full card-add flow with Square test cards, including the
  designated decline card to walk retry into past_due into recovery without waiting real
  days, via a dev-only "run cron now" affordance gated so it cannot exist in production.
- API routes are thin over `lib/billing/` since `app/` is not vitest-covered.

## Out of scope for v1

- Self-serve signup itself (this is its groundwork).
- Automatic access lockout for non-payment.
- Square webhooks (v1 charge results are synchronous; webhooks return if card-expiry
  notifications or dispute handling are wanted later).
- Emailed receipts from us (Square's `receipt_url` covers v1).
- Refunds and credits in-app (handled manually in the Square dashboard).
- In-app cancellation. The `canceled` status exists in the schema so the cron can skip a
  departing company, but setting it is a manual super-admin action (SQL) in v1; a proper
  cancellation flow ships with self-serve signup.

## Prerequisites

- Square sandbox access token: already in `.env.local` (rename to `SQUARE_ACCESS_TOKEN`).
- Square sandbox application ID and location ID: still to be added.
- Production credentials and Vercel env vars: needed before go-live, not for development.
