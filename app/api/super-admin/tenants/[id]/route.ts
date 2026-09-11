import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";
import { normalizeTenantEdit } from "../../../../../lib/superAdmin/tenantEdit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Renames a tenant, or re-parents it to a different company. This is the
   single most consequential write in the super-admin feature: operational
   tables (jobs, PODs, invoices, vehicles, drivers) are keyed by tenant_id,
   not company_id, so moving a tenant moves every one of those rows to a
   different company in one statement, and changes who is billed for its
   vehicles. There is no undo route.

   This holds the service-role key because it has to: rls_04_identity_tables.sql
   gives tenants a select policy and NO write policy, with the comment that
   tenants is "the root of trust for can_access_tenant, so writes are
   service-role only". can_access_tenant and can_manage_tenant (rls_02_helpers.sql)
   both branch on tenants.company_id -- a client-writable tenants table would
   let a signed-in user re-point their own tenant at another company and grant
   themselves access to it. Never add a tenants write policy to make this a
   client write; this route (and the audit log below) is the replacement for
   that policy, not a workaround for it.

   Billing consequence this route must NOT paper over: under v1 billing,
   vehicle_cycle_coverage rows are keyed by company_id (billing_03), so
   vehicles arriving at a new company have no coverage row there and will be
   charged pro-rata at the next billing run. That is arguably the correct
   outcome -- the new company is now responsible for them -- but it is money,
   and Task 13's confirmation dialog is where the operator is told that in
   words. This route must never insert a vehicle_cycle_coverage row to
   suppress that charge: inventing coverage the new company never paid for
   would be a silent write-off of revenue nobody agreed to. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: tenantId } = await context.params;

    // The raw URL segment goes straight into .eq("id", ...) against a uuid
    // column. An id shaped wrong for that column reaches Postgres as 22P02
    // and would otherwise surface through the lookupError branch below as a
    // misleading 500.
    if (!UUID_PATTERN.test(tenantId)) {
      return NextResponse.json({ error: "No such tenant." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const normalized = normalizeTenantEdit(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error, field: normalized.field }, { status: 400 });
    }

    // isMoving, not "hasName", is what decides every branch below (which
    // counts run, which company gets checked, which action gets logged).
    // normalizeTenantEdit only sets companyId when company_id was present in
    // the request, so a rename-only body can never take this branch --
    // a rename request cannot accidentally move a tenant, and a move-only
    // body (no name) still moves it even though nothing renames.
    const isMoving = normalized.companyId !== undefined;

    // createAdminClient() throws when SUPABASE_SERVICE_ROLE_KEY is missing.
    // Left uncaught, Next's boundary turns that into its own HTML error page
    // instead of JSON (app/api/request-access/route.ts:107-117 is the
    // precedent for this guard).
    let admin;
    try {
      admin = createAdminClient();
    } catch (err) {
      console.error("super-admin tenant update: Supabase admin client unavailable", err);
      return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
    }

    const { data: existing, error: lookupError } = await admin
      .from("tenants")
      .select("id, name, company_id")
      .eq("id", tenantId)
      .maybeSingle();

    if (lookupError) {
      // Supabase error text names tables/columns; never hand that to the
      // client. Log the real error server-side and return a fixed string.
      console.error("super-admin tenant update: lookup failed", lookupError);
      return NextResponse.json({ error: "Unable to update this tenant." }, { status: 500 });
    }
    if (!existing) {
      // Load-bearing, not just a nicer 404: a zero-row match on the
      // tenants.update() below returns NO error from PostgREST, so without
      // this check a PATCH to a nonexistent id would fall through, run the
      // counts and the update against nothing, and report 200 {ok:true} for
      // a write that never touched a row.
      return NextResponse.json({ error: "No such tenant." }, { status: 404 });
    }

    if (isMoving) {
      const { data: targetCompany, error: companyLookupError } = await admin
        .from("companies")
        .select("id")
        .eq("id", normalized.companyId)
        .maybeSingle();

      if (companyLookupError) {
        console.error("super-admin tenant update: target company lookup failed", companyLookupError);
        return NextResponse.json({ error: "Unable to update this tenant." }, { status: 500 });
      }
      if (!targetCompany) {
        return NextResponse.json({ error: "No such company.", field: "company_id" }, { status: 400 });
      }
    }

    // Counts are taken BEFORE the write, on purpose, so they describe what is
    // about to move rather than racing the update. { count: "exact", head: true }
    // asks PostgREST for the count only -- no rows cross the wire for either
    // query. profiles.tenant_id is the same column lib/superAdmin/summary.ts
    // uses to attribute a user to a tenant.
    let moved: { vehicles: number; users: number } | null = null;
    if (isMoving) {
      const [vehiclesResult, profilesResult] = await Promise.all([
        admin.from("vehicles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      ]);

      if (vehiclesResult.error || profilesResult.error) {
        console.error(
          "super-admin tenant update: pre-move count failed",
          vehiclesResult.error ?? profilesResult.error,
        );
        return NextResponse.json({ error: "Unable to update this tenant." }, { status: 500 });
      }

      moved = { vehicles: vehiclesResult.count ?? 0, users: profilesResult.count ?? 0 };
    }

    // Built only from normalized's own fields, never from the raw body: the
    // same allowlist discipline as normalizeCompanyEdit's caller. patch's
    // keys are exactly what changedFields logs below, so the two can never
    // disagree about what was requested.
    const patch: { name?: string; company_id?: string } = {};
    if (normalized.name !== undefined) patch.name = normalized.name;
    if (normalized.companyId !== undefined) patch.company_id = normalized.companyId;

    const { error: updateError } = await admin.from("tenants").update(patch).eq("id", tenantId);

    if (updateError) {
      console.error("super-admin tenant update: write failed", updateError);
      return NextResponse.json({ error: "Unable to update this tenant." }, { status: 500 });
    }

    // changedFields records fields PRESENT IN THE REQUEST (patch's keys),
    // not fields whose stored values actually differ: a move to the tenant's
    // current company still logs company_id as changed, because that is
    // what was requested and written, even though nothing about the row's
    // meaning changed.
    logSuperAdminEdit({
      actorId,
      action: isMoving ? "tenant.reparent" : "tenant.rename",
      targetId: tenantId,
      changedFields: Object.keys(patch),
      result: "ok",
    });

    return NextResponse.json({ ok: true, moved });
  },
);
