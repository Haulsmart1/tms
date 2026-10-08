// Isolated PostgreSQL (PGlite), never production. Install @electric-sql/pglite
// in a scratch directory and set PGLITE_MODULE_PATH to its dist/index.js.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (!process.env.PGLITE_MODULE_PATH) throw new Error("Set PGLITE_MODULE_PATH to the isolated PGlite installation.");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000101";
const staff = "00000000-0000-4000-8000-000000000102";
const tenant = "00000000-0000-4000-8000-000000000103";
const other = "00000000-0000-4000-8000-000000000104";
const internal = "00000000-0000-4000-8000-000000000105";
const paid = "00000000-0000-4000-8000-000000000106";
const foreign = "00000000-0000-4000-8000-000000000107";
let checks = 0;
async function rejects(sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
  checks++;
}
async function rows(sql) { return (await db.query(sql)).rows; }
function check(value, expected) { assert.deepEqual(value, expected); checks++; }
try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create table public.roles(id uuid primary key, name text not null);
    create table public.profiles(id uuid primary key, role_id uuid references public.roles);
    create table public.tenants(id uuid primary key);
    create table public.vehicles(id uuid primary key, tenant_id uuid references public.tenants, active boolean not null);
    create table public.vehicle_licences(
      id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants,
      vehicle_id uuid references public.vehicles, licence_type text, active boolean default true,
      created_at timestamptz default now(), activated_at timestamptz default now(),
      deactivated_at timestamptz, created_by uuid references public.profiles,
      issue_date date, expiry_date date, notes text
    );
    create table public.vehicle_assignments(id uuid default gen_random_uuid(), vehicle_id uuid, driver_id uuid);
    insert into public.roles values ('00000000-0000-4000-8000-000000000001','super_admin'),('00000000-0000-4000-8000-000000000002','admin');
    insert into public.profiles values ('${admin}','00000000-0000-4000-8000-000000000001'),('${staff}','00000000-0000-4000-8000-000000000002');
    insert into public.tenants values ('${tenant}'),('${other}');
    insert into public.vehicles values ('${internal}','${tenant}',true),('${paid}','${tenant}',true),('${foreign}','${other}',true);
    insert into public.vehicle_licences(tenant_id,vehicle_id,licence_type) values ('${tenant}','${paid}','Paid legacy'),('${other}','${foreign}','Foreign paid');
    alter table public.vehicle_licences enable row level security;
    create policy tenant_read on public.vehicle_licences for select to authenticated using (tenant_id='${tenant}'::uuid);
    grant select,insert,update,delete on public.vehicle_licences to authenticated;
  `);
  await db.exec(await readFile(new URL("../docs/sql/prodfix_99_internal_vehicle_licences.sql", import.meta.url), "utf8"));
  check((await rows(`select billing_mode from public.vehicle_licences where vehicle_id='${paid}'`))[0].billing_mode,"paid");
  await rejects(`select public.grant_internal_vehicle_licence('${internal}','${staff}','unauthorised')`,/super admin/);
  await rejects(`select public.grant_internal_vehicle_licence('${internal}','${admin}',' ')`,/reason/);
  await rejects(`select public.grant_internal_vehicle_licence('${paid}','${admin}','no conversion')`,/Paid licence history/);
  await db.exec("set role authenticated");
  await rejects(`select public.grant_internal_vehicle_licence('${internal}','${admin}','cannot self-exempt')`,/permission denied/);
  await rejects(`insert into public.vehicle_licences(tenant_id,vehicle_id,licence_type,billing_mode,internal_authorised_by,internal_authorised_at,internal_reason) values ('${tenant}','${internal}','Forged','internal','${admin}',now(),'forged')`,/server-only/);
  check((await rows("select count(*)::int n from public.billable_vehicle_licences"))[0].n,1); // RLS hides foreign paid vehicle.
  await db.exec("reset role");
  const grant = `select public.grant_internal_vehicle_licence('${internal}','${admin}','Stuart authorised free internal use') id`;
  const id = (await rows(grant))[0].id;
  check((await rows(grant))[0].id,id); // idempotent
  check((await rows(`select count(*)::int n from public.vehicle_licences where vehicle_id='${internal}'`))[0].n,1);
  check((await rows(`select count(*)::int n from public.billable_vehicle_licences where vehicle_id='${internal}'`))[0].n,0);
  check((await rows(`select internal_authorised_by::text actor,active from public.vehicle_licences where id='${id}'`))[0],{actor:admin,active:true});
  await rejects(`update public.vehicle_licences set billing_mode='paid',internal_authorised_by=null,internal_authorised_at=null,internal_reason=null where id='${id}'`,/immutable/);
  await rejects(`update public.vehicle_licences set internal_reason='rewritten' where id='${id}'`,/immutable/);
  await rejects(`update public.vehicle_licences set vehicle_id='${paid}' where id='${id}'`,/immutable/);
  await rejects(`delete from public.vehicle_licences where id='${id}'`,/retained for audit/);
  await rejects(`insert into public.vehicle_licences(tenant_id,vehicle_id,licence_type) values ('${tenant}','${internal}','Paid document')`,/cannot be mixed/);
  await rejects(`update public.vehicle_licences set vehicle_id='${internal}' where vehicle_id='${paid}'`,/cannot be mixed/);
  await rejects(`insert into public.vehicle_licences(tenant_id,vehicle_id,licence_type,billing_mode,internal_authorised_by,internal_authorised_at,internal_reason) values ('${other}','${internal}','Foreign','internal','${admin}',now(),'wrong tenant')`,/tenant does not match/);
  await db.exec(`update public.vehicle_licences set active=false where id='${id}'; update public.vehicle_licences set active=true where id='${id}';`);
  check((await rows(`select internal_reason from public.vehicle_licences where id='${id}'`))[0].internal_reason,'Stuart authorised free internal use');
  // Operational licence validation still uses the original table: an actual
  // active internal licence satisfies it, but an unlicensed vehicle does not.
  await db.exec(`create function public.check_operational_licence() returns trigger language plpgsql as $$ begin
    if not exists(select 1 from public.vehicle_licences where vehicle_id=new.vehicle_id and active) then raise exception 'LIC01'; end if;
    return new; end $$;
    create trigger check_operational_licence before insert on public.vehicle_assignments for each row execute function public.check_operational_licence();
    insert into public.vehicle_assignments(vehicle_id) values ('${internal}');`);
  check((await rows("select count(*)::int n from public.vehicle_assignments"))[0].n,1);
  await rejects("insert into public.vehicle_assignments(vehicle_id) values ('00000000-0000-4000-8000-000000000003')",/LIC01/);
  await db.exec("begin");
  await db.exec(`update public.vehicle_licences set active=false where id='${id}'`);
  await db.exec("rollback");
  check((await rows(`select active from public.vehicle_licences where id='${id}'`))[0].active,true);
  console.log(`Isolated PostgreSQL: ${checks} checks passed (authorisation, tenant RLS, audit immutability, idempotency, billing exclusion, operational validation, rollback).`);
} finally { await db.close(); }
