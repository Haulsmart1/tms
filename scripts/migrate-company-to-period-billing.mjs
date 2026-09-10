/* Switch ONE company from v1 (charge in advance, charge on vehicle add) to v2
   (bill in arrears at period close).

   Run per company, deliberately. There is no bulk mode and there should not
   be: this moves a real customer's billing onto a different model and the
   first thing anyone will want after the first one is to look at the result
   before doing the second.

     node scripts/migrate-company-to-period-billing.mjs                 # list candidates
     node scripts/migrate-company-to-period-billing.mjs <companyId>     # dry run
     node scripts/migrate-company-to-period-billing.mjs <companyId> --apply

   PREREQUISITES: docs/sql/billing_06_period_billing.sql and
   docs/sql/billing_07_licence_lifecycle.sql STEP 1 must both be applied, and
   the new code must be deployed. Without billing_06 the company_billing
   columns do not exist and this fails immediately, which is the safe
   direction.

   DANGER: .env.local points at the LIVE Supabase project (see
   scripts/dev-login.mjs). --apply writes production billing data.

   ---------------------------------------------------------------------------
   THE SEAM, which is the whole idea.

   v1 charges in ADVANCE: on next_charge_on the customer pays for the 28 days
   that follow. So at any moment they have already paid up to next_charge_on.
   v2 bills in ARREARS: a period is invoiced when it closes.

   So the first v2 period starts exactly at next_charge_on. Nobody pays twice
   for the same days, and nobody gets a free window. Every currently-active
   licence has activated_at rewritten to that date, so the first v2 invoice
   prorates from the seam rather than from whenever the vehicle was first
   licensed, which would bill them again for time v1 already collected.

   grace_until is left null. These are existing paying customers; a grace
   window would be a discount nobody asked for.

   prepaid_pence is 0 on that first period. The GBP 129 minimum is collected up
   front only when a period is opened by an ACTIVATION, where it buys card
   proof on a customer who has never paid. A migrating company has been paying
   for months.

   ORDER MATTERS, and it is the reverse of what feels natural:

     1. Create the first v2 period (dated at next_charge_on, in the future).
        Harmless while the flag is still v1: closeDuePeriods skips periods
        belonging to non-v2 companies, and it is not due anyway.
     2. Rewrite activated_at on active licences.
     3. Flip billing_model LAST.

   Flipping first would open a window where the company is on v2 with no
   period, so a vehicle added in that window would open a period dated TODAY
   and charge them GBP 129 they do not owe.

   next_charge_on is deliberately NOT cleared. The v1 cron skips v2 companies
   explicitly (app/api/billing/run/route.ts), so it is inert, and leaving it
   records where the seam was if anyone has to reconstruct this later. */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Fall through to the check below, which reports it properly.
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)."
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const PERIOD_DAYS = 28;

function addDays(dateISO, days) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function londonToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function listCandidates() {
  const { data, error } = await admin
    .from("company_billing")
    .select("company_id, status, next_charge_on, retry_at, billing_model")
    .order("next_charge_on", { ascending: true });
  if (error) throw new Error(error.message);

  const today = londonToday();
  console.log(`Today (London): ${today}\n`);
  console.log("company_id                            model         status    next_charge_on  eligible");
  console.log("-".repeat(94));

  for (const row of data ?? []) {
    const why = ineligibleReason(row, today);
    console.log(
      [
        row.company_id,
        (row.billing_model ?? "v1_immediate").padEnd(13),
        String(row.status).padEnd(9),
        String(row.next_charge_on).padEnd(15),
        why ?? "yes",
      ].join(" ")
    );
  }
}

/* Every gate here fails the migration CLOSED, and each one is a way the seam
   stops being true:

   already v2      nothing to do, and re-running would rewrite activated_at on
                   licences the first v2 period has already billed
   not active      a past_due or canceled company has a frozen next_charge_on,
                   so "they have paid up to next_charge_on" is false
   mid-dunning     retry_at set means a cycle charge has FAILED, so they have
                   not in fact paid up to next_charge_on
   date in past    the seam would start a period that is already due, which
                   closes on the next cron run and invoices for days v1 may
                   still have been covering */
function ineligibleReason(row, today) {
  if ((row.billing_model ?? "v1_immediate") === "v2_period") return "no: already v2";
  if (row.status !== "active") return `no: status ${row.status}`;
  if (row.retry_at !== null) return "no: mid-dunning";
  if (!row.next_charge_on || row.next_charge_on <= today) {
    return "no: next_charge_on is not in the future";
  }
  return null;
}

async function migrate(companyId, apply) {
  const today = londonToday();

  const { data: billing, error: billingError } = await admin
    .from("company_billing")
    .select("company_id, status, next_charge_on, retry_at, billing_model")
    .eq("company_id", companyId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (!billing) {
    console.error(`No company_billing row for ${companyId}. Nothing to migrate.`);
    process.exit(1);
  }

  const reason = ineligibleReason(billing, today);
  if (reason) {
    console.error(`Refusing to migrate ${companyId}: ${reason}.`);
    process.exit(1);
  }

  const seam = billing.next_charge_on;
  const periodEnd = addDays(seam, PERIOD_DAYS);

  // The company's vehicles, resolved exactly as billing does it. `vehicles` is
  // keyed by tenant_id only and there is NO company_id column; the company id
  // is in the list because pre-tenants rows carry it in tenant_id directly.
  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id")
    .eq("company_id", companyId);
  if (tenantsError) throw new Error(tenantsError.message);

  const scope = [...(tenants ?? []).map((t) => t.id), companyId];

  const { data: vehicles, error: vehiclesError } = await admin
    .from("vehicles")
    .select("id")
    .in("tenant_id", scope);
  if (vehiclesError) throw new Error(vehiclesError.message);

  const vehicleIds = (vehicles ?? []).map((v) => v.id);

  let activeLicences = [];
  if (vehicleIds.length > 0) {
    const { data, error } = await admin
      .from("vehicle_licences")
      .select("id, vehicle_id, vrn_normalised, activated_at")
      .in("vehicle_id", vehicleIds)
      .is("deactivated_at", null);
    if (error) throw new Error(error.message);
    activeLicences = data ?? [];
  }

  const distinctVehicles = new Set(activeLicences.map((l) => l.vehicle_id));

  console.log(`Company:            ${companyId}`);
  console.log(`Today (London):     ${today}`);
  console.log(`Seam (v1 paid to):  ${seam}`);
  console.log(`First v2 period:    ${seam} to ${periodEnd} (exclusive)`);
  console.log(`Active licences:    ${activeLicences.length}`);
  console.log(`Billable vehicles:  ${distinctVehicles.size}`);
  console.log(
    `First invoice due:  ${periodEnd} (in arrears, for the period above)`
  );

  if (!apply) {
    console.log("\nDRY RUN. Nothing was written. Re-run with --apply to commit.");
    return;
  }

  // 1. The period, BEFORE the flag. See the header: flipping first would let a
  //    vehicle added in the gap open a period dated today and charge GBP 129.
  const { data: period, error: periodError } = await admin
    .from("billing_periods")
    .insert({
      company_id: companyId,
      period_start: seam,
      period_end: periodEnd,
      status: "open",
      prepaid_pence: 0,
    })
    .select("id")
    .single();
  if (periodError) {
    if (periodError.code === "23505") {
      console.error(
        "This company already has an open billing period. It may be part-migrated; inspect billing_periods before continuing."
      );
      process.exit(1);
    }
    throw new Error(periodError.message);
  }
  console.log(`\nCreated billing period ${period.id}`);

  // 2. Move every active licence's clock to the seam. Without this the first
  //    v2 invoice prorates from the original activation and bills again for
  //    time v1 already collected.
  if (activeLicences.length > 0) {
    const { error } = await admin
      .from("vehicle_licences")
      .update({ activated_at: `${seam}T00:00:00Z`, grace_until: null })
      .in(
        "id",
        activeLicences.map((l) => l.id)
      );
    if (error) throw new Error(error.message);
    console.log(`Reset activated_at on ${activeLicences.length} active licences`);
  }

  // 3. The flag, LAST.
  const { error: flagError } = await admin
    .from("company_billing")
    .update({ billing_model: "v2_period" })
    .eq("company_id", companyId);
  if (flagError) throw new Error(flagError.message);
  console.log("Switched billing_model to v2_period");

  console.log(
    `\nDone. The v1 cron now skips this company. Its first v2 invoice is raised on ${periodEnd}.`
  );
}

const [, , companyId, ...flags] = process.argv;

try {
  if (!companyId) {
    await listCandidates();
  } else {
    await migrate(companyId, flags.includes("--apply"));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
