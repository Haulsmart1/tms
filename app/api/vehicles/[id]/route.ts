// Delete one vehicle, refusing when it carries billing evidence.
//
// Contract:
//   200 {ok:true}          deleted
//   401 {error}            not signed in
//   403 {error}            signed in, not allowed to manage this vehicle's tenant
//   404 {error}            no such vehicle
//   409 {error:"<reason>"} deletion refused (billing history, or still referenced)
//
// Why a server route (review SQL-5, SQL-12, SET-4, BILL2-12): a browser delete
// used to cascade away paid add-on charges and coverage, and let a v2 company
// remove vehicles from a period's invoice the day before it closed. The rule
// lives in lib/billing/vehicleDelete.ts; docs/sql/prodfix_31 makes the database
// enforce it too, so this route is not the only guard.

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createUserClient } from "../../../../lib/accounts/server";
import {
  authorizeTenant,
  isUuid,
  loadCallerProfile,
  loadTenantRef,
  TenantAccessError,
} from "../../../../lib/auth/serverTenantAccess";
import { hasValidHome, roleTier } from "../../../../lib/auth/tenantAccess";
import {
  decideVehicleDelete,
  isLicenceEverActive,
  isMissingRpcError,
  vehicleDeleteResponse,
} from "../../../../lib/billing/vehicleDelete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

/**
 * Legacy vehicles carry a COMPANY id in tenant_id (rows written before tenants
 * existed), so there is no tenant row for authorizeTenant to find. Mirror
 * can_manage_tenant for that shape: super_admin, or a company admin of that
 * company whose own profile is coherent.
 */
async function authorizeLegacyCompanyVehicle(
  admin: SupabaseClient,
  userId: string,
  companyId: string
): Promise<boolean> {
  const caller = await loadCallerProfile(admin, userId);
  const tier = roleTier(caller.roleName);
  if (tier === "super_admin") return true;
  if (tier !== "admin") return false;
  const homeTenant = await loadTenantRef(admin, caller.homeTenantId);
  return hasValidHome(caller, homeTenant) && caller.companyId === companyId;
}

async function countRows(
  admin: SupabaseClient,
  table: string,
  vehicleId: string
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("vehicle_id", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId);
  if (error) {
    // 42P01: the table does not exist in this database (its billing migration
    // is not applied), so it cannot hold evidence for this vehicle.
    if (error.code === "42P01") return 0;
    throw new Error(`${table} evidence check failed: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Fallback when prodfix_31 is not applied yet. The same checks as the rpc, run
 * from here, then the delete. There is a small race (a licence activated
 * between the check and the delete), which the rpc's row lock closes; this
 * path exists so deploying the code before the SQL is not an outage, and it is
 * never a blind delete.
 */
async function deleteWithoutRpc(
  admin: SupabaseClient,
  vehicleId: string
): Promise<string> {
  let licences: Array<{
    id: string;
    active: boolean | null;
    activated_at?: string | null;
    deactivated_at?: string | null;
  }> = [];

  const withLifecycle = await admin
    .from("vehicle_licences")
    .select("id, active, activated_at, deactivated_at")
    .eq("vehicle_id", vehicleId);
  if (withLifecycle.error) {
    if (withLifecycle.error.code !== "42703") {
      throw new Error(`licence evidence check failed: ${withLifecycle.error.message}`);
    }
    // billing_07 not applied: no history to read, so every licence is kept as
    // evidence (isLicenceEverActive fails closed on undefined columns).
    const bare = await admin
      .from("vehicle_licences")
      .select("id, active")
      .eq("vehicle_id", vehicleId);
    if (bare.error) throw new Error(`licence evidence check failed: ${bare.error.message}`);
    licences = (bare.data ?? []).map((row) => ({
      id: row.id as string,
      active: row.active as boolean | null,
    }));
  } else {
    licences = (withLifecycle.data ?? []) as typeof licences;
  }

  const everActiveLicences = licences.filter((l) =>
    isLicenceEverActive({
      active: l.active,
      activatedAt: l.activated_at,
      deactivatedAt: l.deactivated_at,
    })
  ).length;

  const decision = decideVehicleDelete({
    everActiveLicences,
    coverageRows: await countRows(admin, "vehicle_cycle_coverage", vehicleId),
    addonChargeRows: await countRows(admin, "vehicle_addon_charges", vehicleId),
    invoiceLineRows: await countRows(admin, "period_invoice_lines", vehicleId),
  });
  if (decision.kind === "refuse") return "has_billing_evidence";

  if (licences.length > 0) {
    const drafts = await admin
      .from("vehicle_licences")
      .delete()
      .in(
        "id",
        licences.map((l) => l.id)
      );
    if (drafts.error) {
      if (drafts.error.code === "23503") return "referenced";
      throw new Error(`draft licence delete failed: ${drafts.error.message}`);
    }
  }

  const removed = await admin
    .from("vehicles")
    .delete()
    .eq("id", vehicleId)
    .select("id");
  if (removed.error) {
    if (removed.error.code === "23503") return "referenced";
    // The prodfix_31 trigger, if installed without the rpc, raises P0001.
    if (removed.error.code === "P0001") return "has_billing_evidence";
    throw new Error(`vehicle delete failed: ${removed.error.message}`);
  }
  return (removed.data ?? []).length > 0 ? "deleted" : "not_found";
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const userClient = await createUserClient();
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return json(401, { error: "You must be signed in." });
    }

    if (!isUuid(id)) {
      return json(404, { error: "Vehicle not found." });
    }

    const admin = createAdminClient();

    const vehicleRes = await admin
      .from("vehicles")
      .select("id, tenant_id, registration")
      .eq("id", id)
      .maybeSingle();
    if (vehicleRes.error) throw new Error(vehicleRes.error.message);
    if (!vehicleRes.data) {
      return json(404, { error: "Vehicle not found." });
    }

    const tenantId = vehicleRes.data.tenant_id as string | null;
    if (!tenantId) {
      return json(403, { error: "You do not have access to this vehicle." });
    }

    try {
      const tenantRow = await loadTenantRef(admin, tenantId);
      if (tenantRow) {
        await authorizeTenant(admin, user.id, tenantId, "manage");
      } else if (!(await authorizeLegacyCompanyVehicle(admin, user.id, tenantId))) {
        return json(403, { error: "You do not have access to this vehicle." });
      }
    } catch (error) {
      if (error instanceof TenantAccessError) {
        if (error.status === 401) return json(401, { error: "You must be signed in." });
        if (error.status === 403) {
          return json(403, { error: "You do not have access to this vehicle." });
        }
      }
      throw error;
    }

    const rpc = await admin.rpc("delete_vehicle_if_no_billing_evidence", {
      p_vehicle_id: id,
    });

    let result: string;
    if (rpc.error) {
      if (!isMissingRpcError(rpc.error)) {
        throw new Error(`delete_vehicle_if_no_billing_evidence failed: ${rpc.error.message}`);
      }
      console.warn(
        "[vehicles] delete_vehicle_if_no_billing_evidence is not installed; using the app-side check. Apply docs/sql/prodfix_31_billing_evidence_retention.sql."
      );
      result = await deleteWithoutRpc(admin, id);
    } else {
      result = rpc.data as string;
    }

    const response = vehicleDeleteResponse(result);
    if (response.status === 500) {
      throw new Error(`unexpected vehicle delete result: ${String(result)}`);
    }
    return json(response.status, response.body);
  } catch (error) {
    console.error(
      "Vehicle delete failed",
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    );
    return json(500, { error: "Something went wrong. Please try again." });
  }
}
