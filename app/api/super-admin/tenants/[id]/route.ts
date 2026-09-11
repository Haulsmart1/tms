import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";
import { normalizeTenantEdit } from "../../../../../lib/superAdmin/tenantEdit";
import { isUuid } from "../../../../../lib/uuid";
import { countBillableVehicles } from "../../../../../lib/billing/vehicleCount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
   would be a silent write-off of revenue nobody agreed to.

   Neither the existence check nor the update below runs inside a
   transaction, and the audit log call runs after both. A process death
   between the existence check and the update leaves a write this route
   attempted but logSuperAdminEdit never records, because there is nothing
   left to run it. The real fix is a SECURITY DEFINER Postgres function that
   does the check, the write and an audit insert atomically -- deferred here
   because no migration in this feature has been applied yet, so there is
   nowhere for that function to live. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: tenantId } = await context.params;

    // The raw URL segment goes straight into .eq("id", ...) against a uuid
    // column. An id shaped wrong for that column reaches Postgres as 22P02
    // and would otherwise surface through the lookupError branch below as a
    // misleading 500.
    if (!isUuid(tenantId)) {
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

    // isMoving means company_id was present in the request; isActualMove
    // means the write would actually change it. A super-admin can legitimately
    // submit the tenant's current company (the confirmation dialog was open,
    // they clicked confirm without changing the selection) -- that must not
    // be reported back as though every vehicle and user in the tenant just
    // moved when tenants.company_id never changed.
    const isActualMove = isMoving && normalized.companyId !== existing.company_id;

    // Counts are taken BEFORE the write, on purpose, so they describe what is
    // about to move rather than racing the update -- but "before" is not
    // "inside a transaction with": a vehicle or profile inserted into this
    // tenant between this read and the update below moves with the tenant
    // but is invisible to the numbers returned here. Acceptable for a
    // hand-driven, low-frequency admin operation; not a guarantee these
    // figures hold under a concurrent write.
    let moved: { vehicles: number; billableVehicles: number; users: number } | null = null;
    if (isActualMove) {
      const [vehiclesResult, profilesResult] = await Promise.all([
        // Full rows, not a head-only count: the billable figure below needs
        // the actual vehicle ids to join against vehicle_licences, so the
        // fleet size is read off vehiclesResult.data.length instead of
        // paying for a second, redundant head-only count query.
        admin.from("vehicles").select("id, tenant_id").eq("tenant_id", tenantId),
        // Deliberately the ONE-WAY rule (tenant_id === this tenant, full
        // stop) -- NOT the two-way rule lib/superAdmin/summary.ts applies
        // when attributing a profile to a COMPANY, which also treats
        // tenant_id holding a company id directly as a match. A profile
        // keyed straight to a company id belongs to that company, not to
        // one tenant inside it, and must not be counted as moving with this
        // tenant. Reusing the company-level two-way rule here would
        // over-count. { count: "exact", head: true } asks PostgREST for the
        // count only -- no profile rows cross the wire for this one.
        //
        // profiles.company_id is deliberately left untouched by this route,
        // not forgotten: app/api/settings/users/invite/route.ts:137 reads
        // that column, but nothing in the codebase writes it on an ordinary
        // tenant assignment (it only ever gets set by hand, per
        // lib/superAdmin/summary.ts's own comment on the same column), so
        // there is no maintained value here for a re-parent to keep in step
        // with. Writing to it would be inventing a write nobody asked for.
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      ]);

      const vehicleIds = (vehiclesResult.data ?? []).map((row) => row.id as string);

      // vehicle_licences holds COMPLIANCE documents, not billing seats: one
      // vehicle legitimately carries an O-licence, a waste carrier licence
      // and an ADR certificate at once, all active simultaneously.
      // countBillableVehicles (lib/billing/vehicleCount.ts) is the single
      // definition of "billable" and already dedupes to distinct vehicles
      // with at least one active licence -- reused here rather than
      // reimplemented, because counting licence rows would overstate.
      const licencesResult = vehicleIds.length > 0
        ? await admin
            .from("vehicle_licences")
            .select("vehicle_id, active")
            .eq("active", true)
            .in("vehicle_id", vehicleIds)
        : { data: [] as { vehicle_id: string; active: boolean | null }[], error: null };

      // Iterated rather than checked with `a.error || b.error || c.error`:
      // that chain silently stops naming which query failed once a third
      // query joins the first two, and (worse) is easy to grow the query
      // list without remembering to grow the check. This loop cannot go
      // stale that way.
      for (const result of [vehiclesResult, profilesResult, licencesResult]) {
        if (result.error) {
          console.error("super-admin tenant update: pre-move count failed", result.error);
          return NextResponse.json({ error: "Unable to update this tenant." }, { status: 500 });
        }
      }

      // moved.vehicles is the fleet size. moved.billableVehicles is the
      // number that actually drives the pro-rata charge landing on the new
      // company under v1 billing (see the top-of-file comment) -- Task 13's
      // confirmation dialog is built on THIS number, not the fleet size: a
      // tenant with 14 vehicles of which 9 carry an active licence charges
      // the new company for 9, not 14.
      moved = {
        vehicles: vehiclesResult.data?.length ?? 0,
        billableVehicles: countBillableVehicles({
          companyId: tenantId,
          companyTenantIds: [tenantId],
          vehicles: vehiclesResult.data ?? [],
          licences: licencesResult.data ?? [],
        }),
        users: profilesResult.count ?? 0,
      };
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
    //
    // This branches on isMoving, not isActualMove, and that is deliberate,
    // not an inconsistency with the isActualMove guard around the counts
    // above: logging what was REQUESTED and WRITTEN means a real move can
    // never fail to appear in the audit trail. Logging on isActualMove
    // instead would create a class of writes -- a no-op re-parent to the
    // tenant's current company -- that this route performs but never
    // records, purely because a future move happened to target the same
    // company as a previous one.
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
