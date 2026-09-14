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

   --apply IS ONE TRANSACTION. It calls public.migrate_company_to_period_billing
   (docs/sql/prodfix_32_migrate_company_to_period_billing.sql), which locks the
   company_billing row, re-checks every eligibility rule below under that
   lock, and then in one statement block:

     1. Creates the first v2 period (dated at next_charge_on, in the future).
     2. Rewrites activated_at on active licences.
     3. Flips billing_model LAST.

   Previously these were three separate writes from this script, so a failure
   after step 1 left a v1 company holding an open future period, and a failure
   in step 2 left a partial activated_at rewrite (review BILL2-21). If the
   function is not installed this script REFUSES; it never falls back to the
   old non-transactional writes.

   The dry run (the default) is read-only and reports the same refusal reasons
   the function enforces, including pending v1 charges, which would be
   orphaned once the v1 cron starts skipping the company. It also refuses when
   a vehicle or licence query reaches PostgREST's 1000-row cap, because a
   truncated count would misreport the fleet being migrated.

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

// PostgREST caps an unscoped select at 1000 rows. A count taken from a capped
// result would silently misreport the fleet, so refuse instead.
const POSTGREST_ROW_CAP = 1000;

function refuseAtRowCap(label, rows) {
  if ((rows ?? []).length >= POSTGREST_ROW_CAP) {
    console.error(
      `Refusing: the ${label} query hit the ${POSTGREST_ROW_CAP}-row cap, so the counts below would be incomplete. Nothing was written.`
    );
    process.exit(1);
  }
}

// Pending rows are payments with an unknown Square outcome. A missing table
// (42P01) cannot hold any; an invalid status value cannot either (22P02 would
// only arise on an enum, these are text checks).
async function countPending(table, companyId) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending");
  if (error) {
    if (error.code === "42P01") return 0;
    throw new Error(`${table} pending check failed: ${error.message}`);
  }
  return count ?? 0;
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

  // Pending v1 charges are payments whose Square outcome is unknown. Once the
  // company is v2 the v1 cron skips it and nothing would ever replay them.
  const pendingCycle = await countPending("platform_charges", companyId);
  const pendingAddon = await countPending("vehicle_addon_charges", companyId);
  if (pendingCycle > 0 || pendingAddon > 0) {
    console.error(
      `Refusing to migrate ${companyId}: ${pendingCycle} pending cycle charge(s) and ${pendingAddon} pending add-on charge(s). Reconcile them against Square first.`
    );
    process.exit(1);
  }

  const { data: openPeriod, error: openError } = await admin
    .from("billing_periods")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle();
  if (openError) throw new Error(openError.message);
  if (openPeriod) {
    console.error(
      `Refusing to migrate ${companyId}: open billing period ${openPeriod.id} already exists. It may be part-migrated; inspect billing_periods.`
    );
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
  refuseAtRowCap("vehicles", vehicles);

  const vehicleIds = (vehicles ?? []).map((v) => v.id);

  let activeLicences = [];
  if (vehicleIds.length > 0) {
    const { data, error } = await admin
      .from("vehicle_licences")
      .select("id, vehicle_id, vrn_normalised, activated_at")
      .in("vehicle_id", vehicleIds)
      .is("deactivated_at", null);
    if (error) throw new Error(error.message);
    refuseAtRowCap("vehicle_licences", data);
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

  // One transaction in the database. The function re-checks every refusal
  // above under a row lock, so a change between this dry-run read and the
  // apply is caught there rather than half-applied here.
  const { data: summary, error: rpcError } = await admin.rpc(
    "migrate_company_to_period_billing",
    { p_company_id: companyId, p_today: today }
  );
  if (rpcError) {
    if (rpcError.code === "PGRST202" || rpcError.code === "42883") {
      console.error(
        "migrate_company_to_period_billing is not installed. Apply docs/sql/prodfix_32_migrate_company_to_period_billing.sql first. Nothing was written."
      );
      process.exit(1);
    }
    console.error(`Migration refused or failed, nothing was written: ${rpcError.message}`);
    process.exit(1);
  }

  console.log(`\nCreated billing period ${summary.period_id}`);
  console.log(
    `Reset activated_at on ${summary.licences_reset} active licences (${summary.distinct_vehicles} vehicles)`
  );
  console.log("Switched billing_model to v2_period");
  console.log(
    `\nDone. The v1 cron now skips this company. Its first v2 invoice is raised on ${summary.period_end}.`
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
