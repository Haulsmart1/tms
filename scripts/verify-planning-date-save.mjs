import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Isolated in-memory PostgreSQL only. Install @electric-sql/pglite into a
// scratch directory and pass its dist/index.js path; no env files are read.
// node scripts/verify-planning-date-save.mjs /scratch/node_modules/@electric-sql/pglite/dist/index.js
if (!process.argv[2]) throw new Error("Pass the local PGlite module path.");
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const root = new URL("../", import.meta.url);
const tenant = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const vehicle = "33333333-3333-4333-8333-333333333333";
const bob = "44444444-4444-4444-8444-444444444444";
const alice = "55555555-5555-4555-8555-555555555555";
const today = "2026-10-08";
const oldDay = "2026-10-04";
const ids = Array.from({ length: 25 }, (_, i) => `66666666-6666-4666-8666-${String(i + 1).padStart(12, "0")}`);
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table tenants(id uuid primary key, company_id uuid);
    create table vehicles(id uuid primary key, tenant_id uuid);
    create table drivers(id uuid primary key, tenant_id uuid);
    create table jobs(id uuid primary key, tenant_id uuid, vehicle_id uuid, driver_id uuid,
      route_order integer, planning_date date, scheduled_date date);
    create table job_stops(id uuid primary key, job_id uuid);
    create table planning_route_itineraries(id uuid primary key, tenant_id uuid, planning_date date);
    create table planning_route_visit_stops(itinerary_id uuid references planning_route_itineraries on delete cascade,
      tenant_id uuid, job_id uuid, stop_id uuid);
    create function can_access_tenant(uuid) returns boolean language sql as
      'select $1 = ''${tenant}''::uuid';
    insert into tenants values ('${tenant}',null),('${other}',null);
    insert into vehicles values ('${vehicle}','${tenant}');
    insert into drivers values ('${bob}','${tenant}'),('${alice}','${tenant}');
    grant select on tenants,vehicles,drivers to authenticated;
    grant select,update on jobs to authenticated;
    alter table jobs enable row level security;
    create policy job_tenant on jobs to authenticated using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));
  `);
  for (let i = 0; i < ids.length; i++) {
    await db.query("insert into jobs values ($1,$2,$3,$4,$5,null,$6)", [ids[i],tenant,vehicle,bob,i + 1,oldDay]);
    await db.query("insert into job_stops values ($1,$1)", [ids[i]]);
  }
  for (const file of ["docs/sql/prodfix_70_planning_save.sql", "docs/sql/prodfix_71_itinerary_integrity.sql", "docs/sql/prodfix_98_planning_date_save.sql"]) {
    await db.exec(await fs.readFile(new URL(file, root), "utf8"));
  }
  const rows = ids.map((id, i) => ({ id, vehicle_id: vehicle, driver_id: bob,
    route_order: ids.length - i, planning_date: today,
    expected_vehicle_id: vehicle, expected_driver_id: bob, expected_route_order: i + 1,
    expected_planning_date: null, expected_scheduled_date: oldDay }));
  const save = (updates, date = today, tenantId = tenant) => db.query(
    "select save_planning_assignments($1::uuid,$2::jsonb,$3::date) as saved",
    [tenantId, JSON.stringify(updates), date],
  );
  await db.exec("set role authenticated");
  const legacyRows = rows.map((row, i) => ({ ...row, route_order: i + 1 }));
  await db.query("select save_planning_assignments($1::uuid,$2::jsonb)", [tenant, JSON.stringify(legacyRows)]);
  assert.equal((await db.query("select count(*)::int as jobs_today from jobs where coalesce(planning_date, scheduled_date)=$1",[today])).rows[0].jobs_today,0);
  console.log("REPRODUCED: the old RPC reports success but leaves all 25 jobs on the older day, so today's queue is empty.");
  assert.equal((await save(rows)).rows[0].saved,25);
  const landed = (await db.query("select id,driver_id,vehicle_id,planning_date::text as day from jobs where planning_date=$1 order by route_order",[today])).rows;
  assert.deepEqual(landed.map(row => row.id), [...ids].reverse());
  assert(landed.every(row => row.driver_id === bob && row.vehicle_id === vehicle && row.day === today));
  console.log("PASS: all 25 HT21 EOR jobs, Bob assignment, intended date and reversed snapshot order persist together.");

  const current = (await db.query("select * from jobs where id=$1",[ids[0]])).rows[0];
  const changed = { ...rows[0], route_order: 1, driver_id: alice,
    expected_route_order: 25, expected_planning_date: today };
  await assert.rejects(save([{ ...changed, expected_scheduled_date: "2026-10-03" }]), /PLANNING_CONFLICT/);
  assert.deepEqual((await db.query("select * from jobs where id=$1",[ids[0]])).rows[0],current);
  await assert.rejects(save([{ ...changed, expected_planning_date: oldDay }]), /PLANNING_CONFLICT/);
  await assert.rejects(save([{ ...changed, expected_route_order: 24 }]), /PLANNING_CONFLICT/);
  console.log("PASS: stale source date, planning date and route order refuse atomically; Bob's assignment is not overwritten.");
  await assert.rejects(save([{ ...changed, planning_date: oldDay }]), /Assigned work must use/);
  const missingDates = { ...changed };
  delete missingDates.expected_planning_date;
  await assert.rejects(save([missingDates]), /last-seen dates/);
  await assert.rejects(save([changed],today,other), /Not permitted/);
  console.log("PASS: invalid dates, missing concurrency fields and other-tenant calls are refused.");

  // Date-only corrections must work when assignment/order are unchanged.
  await save([{ ...changed, driver_id: bob, route_order: 25, planning_date: "2026-10-09" }],"2026-10-09");
  assert.equal((await db.query("select planning_date::text as day from jobs where id=$1",[ids[0]])).rows[0].day,"2026-10-09");
  console.log("PASS: date-only correction is persisted.");
  const unassign = { ...changed, driver_id: null, vehicle_id: null, route_order: null,
    planning_date: "2026-10-09", expected_planning_date: "2026-10-09" };
  await save([unassign]);
  const unassigned = (await db.query("select driver_id,planning_date::text as day from jobs where id=$1",[ids[0]])).rows[0];
  assert.deepEqual(unassigned,{ driver_id: null, day: "2026-10-09" });
  console.log("PASS: unassignment preserves the job's operational date.");

  await db.exec("reset role");
  const privileges = (await db.query("select has_function_privilege('anon','save_planning_assignments(uuid,jsonb,date)','EXECUTE') as anon, has_function_privilege('authenticated','save_planning_assignments(uuid,jsonb,date)','EXECUTE') as authenticated")).rows[0];
  assert.deepEqual(privileges,{ anon: false, authenticated: true });
  const invoker = (await db.query("select prosecdef from pg_proc where oid='save_planning_assignments(uuid,jsonb,date)'::regprocedure")).rows[0];
  assert.equal(invoker.prosecdef,false);
  console.log("PASS: RPC is SECURITY INVOKER, executable by authenticated and denied to anon.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
