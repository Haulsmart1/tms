# Handoff: v2 period billing

Date: 2026-09-10
Branch: merged to `main`, pushed, deployed. Last commit `4243ae3`.
Working tree clean, nothing unpushed. 1141 tests pass, `npm run typecheck` clean.

## Where to start tomorrow

**One thing is unresolved.** Switching a test company to v2 and adding a vehicle produced no
`period_charges` row and no charge at Square. The expected result was £129.00 + £25.80 VAT =
£154.80 taken immediately, opening a 28-day period.

This is most likely correct behaviour hitting one of the early exits rather than a bug, because
all four of them return `ok: true` with no charge, which looks like success in the UI. Run this
first:

```sql
with recent as (
  select vl.id, vl.vehicle_id, vl.active, vl.created_at
  from public.vehicle_licences vl
  order by vl.created_at desc limit 1
)
select
  v.registration,
  r.active                                          as licence_active,
  (select count(*) from public.vehicle_licences o
     where o.vehicle_id = r.vehicle_id and o.active and o.id <> r.id)
                                                    as other_active_licences,
  cb.company_id,
  cb.billing_model,
  cb.status                                         as billing_status,
  (cb.square_card_id is not null)                   as has_card,
  (select count(*) from public.billing_periods p
     where p.company_id = cb.company_id and p.status = 'open')
                                                    as open_periods
from recent r
join public.vehicles v on v.id = r.vehicle_id
left join public.tenants t on t.id = v.tenant_id
left join public.company_billing cb
  on cb.company_id = coalesce(t.company_id, v.tenant_id);
```

| Column | If it reads | Then |
|---|---|---|
| `billing_model` | not `v2_period` | The flag went on a different company than the one owning the vehicle. A vehicle resolves through its TENANT to a company, and `tenant_id` sometimes holds the company id directly. Most likely cause. |
| `open_periods` | 1 | A period already existed, so activation correctly joined it free. Delete the period, add a vehicle again. |
| `other_active_licences` | >= 1 | The vehicle was already billable. Billing is per vehicle, not per licence. |
| `licence_active` | false | "Active for billing" was unchecked. An inactive licence is a compliance record and costs nothing. |

The API response's `reason` field says the same thing more directly, if devtools is still open:
`not_active`, `already_billable`, `period_billing` (joined an existing period), `period_opened`
(charged), or a v1 reason like `no_subscription` / `cycle_due` meaning it fell through to v1.

## State of the database

Applied and verified by Ethan on 2026-09-10:

- `docs/sql/billing_06_period_billing.sql` (period tables, settings columns, RLS)
- `docs/sql/billing_07_licence_lifecycle.sql` STEP 1 and STEP 2 (STEP 2 soaked)
- `docs/sql/billing_06_verify.sql` run, all probes PASS, plus the devtools RLS checks

Every company is still `v1_immediate` except whatever was flipped by hand during testing.
Nothing has been migrated with the script.

## What is verified

- v1 smoke test passes end to end: create a licence, toggle it, delete it, licences page loads.
- One live regression was found and fixed there: the arrears delete rule had been applied to v1
  companies, removing an operation every company had. Fixed in `d2cc79e`, and the rule now lives
  in `lib/billing/licenceDelete.ts` with the regression asserted.

## What has NEVER run

- The v2 activation charge (see above).
- The Square period charge and refund paths. Not in production, not in sandbox, not once.
- The close job against real data.
- Cancellation and cooling-off.

## Next steps, in order

1. Run the diagnostic above and get one v2 activation to charge.
2. Add a second and third vehicle. Both must charge NOTHING and return `reason: "period_billing"`.
   That is rule 10.
3. Force a close without waiting 28 days:
   `update public.billing_periods set period_end = current_date where company_id = '...' and status = 'open';`
   then `curl -H "Authorization: Bearer $CRON_SECRET" https://tmswizzard.cloud/api/billing/run`.
   Confirm `CRON_SECRET` is set in Vercel first, or the route answers 401.
4. Read `public.period_invoice_lines` for that period: vehicle lines at £64.50 prorated, then a
   volume discount line if the fleet reached 10, then a minimum adjustment if it came in under
   £129.
5. Exercise cancellation: `POST /api/billing/cancel` with `{"confirm":"CANCEL"}`. Inside 48 hours
   of the period opening it refunds the minimum in full; after that it cuts the period short and
   charges the balance.
6. Only then migrate a real company: `node scripts/migrate-company-to-period-billing.mjs`, dry run
   first.

## Not built, and known

**Service-level suspension.** Dunning, `past_due` and the block on adding vehicles all work. The
read-only gate described in the spec (no job creation, no driver app, no POD capture, read and
export still open) is a `proxy.ts` change touching every route and was deliberately left out. A
`past_due` v2 company currently keeps full use of the platform.

**No UI for v2 billing.** `/settings/billing` and `/super-admin/billing` read `platform_charges`,
which v2 does not write. A v2 company sees nothing about their bill in the product. This is the
most obvious next piece of work.

**v1 cancellation.** `/api/billing/cancel` refuses a v1 company outright rather than pretending.

## Traps that will bite

**The table is `period_invoice_lines`, not `invoice_lines`.** That name belongs to the CUSTOMER
invoicing feature (accounts, credit notes, Xero sync). The original migration used it, and
`create table if not exists` on a taken name is SILENT: nothing was created and the file would
have applied its RLS policy and its grant revokes to the accounts table. Only a later index
failing rolled the transaction back. Check `pg_tables` before adding any table to this schema.

**`vehicle_licences` holds compliance documents, not billing seats.** One vehicle legitimately
carries an O-licence, a waste carrier licence and an ADR certificate at once. Never add a
one-active-licence-per-vehicle constraint, and never count licence rows where you mean vehicles.

**`vehicles` has no `company_id`.** It is keyed by `tenant_id` only, and some rows carry a company
id there directly. Filtering on `vehicles.company_id` answers PostgREST 42703 and fails the whole
request. `invoice_lines.tenant_id` carries no foreign key for the same reason.

**Never use `lib/billing/money.ts` for a v2 company**, or `rateCard.ts` for a v1 one. They are
different pricing shapes: graduated per-week bands versus whole-fleet per-period discounts.

## Map

| Area | Files |
|---|---|
| Pricing | `lib/billing/rateCard.ts`, `pence.ts` |
| Invoice | `lib/billing/invoiceLine.ts`, `invoice.ts` |
| Close decisions | `lib/billing/close.ts`, `period.ts` |
| Activation / cancellation | `lib/billing/activation.ts`, `cancellation.ts`, `licenceDelete.ts` |
| Payment | `lib/billing/periodPayment.ts`, `periodPaymentServer.ts` |
| Supabase glue | `lib/billing/periodServer.ts` |
| Routes | `app/api/licences/activate`, `app/api/licences/estimate`, `app/api/billing/cancel`, `app/api/billing/run` |
| Migrations | `docs/sql/billing_06*`, `billing_07*` |
| Switch-over | `scripts/migrate-company-to-period-billing.mjs` |

Full rationale, including every decision that reverses an existing one, is in
`docs/superpowers/specs/2026-09-10-period-billing-design.md`. Read that before changing anything
here: most of the non-obvious choices are only explained there.
