/*
  Server-only: archive, restore and delete for /api/assets/**. Never import
  from client code (it pulls in the service-role client).

  Every action authorizes against the ASSET'S OWN tenant, read with the
  service role, never a tenant header: an admin on "All tenants" sends none,
  and the selector is not the row. Archive and restore need an office caller
  (drivers refused, lib/jobs/officeRoles.ts); delete needs can_manage_tenant.

  docs/sql/assets_01 makes the database agree: browser DELETE is revoked and
  the archive columns are writable only by the service role.
*/

import "server-only";

import { createAdminClient, createUserClient } from "../accounts/server";
import { authorizeTenant, isUuid, TenantAccessError } from "../auth/serverTenantAccess";
import { authorizeOfficeTenant } from "../jobs/officeAccess";
import { assetRouteResponse, decideAssetDelete, type AssetRouteResult } from "./deleteRule";
import {
  isForeignKeyViolation,
  isMaintenanceHistoryViolation,
  isMissingColumnError,
} from "./errors";

export type RouteAnswer = { status: number; body: Record<string, unknown> };

const SERVER_ERROR: RouteAnswer = {
  status: 500,
  body: { error: "Something went wrong. Please try again." },
};
const UNAUTHENTICATED: RouteAnswer = { status: 401, body: { error: "You must be signed in." } };
const FORBIDDEN: RouteAnswer = {
  status: 403,
  body: { error: "You do not have permission to change this asset." },
};

function answer(result: AssetRouteResult): RouteAnswer {
  const response = assetRouteResponse(result);
  return { status: response.status, body: response.body };
}

type AdminClient = ReturnType<typeof createAdminClient>;

type Authorized =
  | { ok: true; admin: AdminClient; userId: string; archivedAt: string | null }
  | { ok: false; answer: RouteAnswer };

async function authorizeAsset(
  id: string,
  level: "office" | "manage",
  withArchive: boolean,
): Promise<Authorized> {
  const userClient = await createUserClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) return { ok: false, answer: UNAUTHENTICATED };

  if (!isUuid(id)) return { ok: false, answer: answer("not_found") };

  const admin = createAdminClient();
  // Delete never reads the archive columns, so it still works before assets_01.
  const columns = withArchive ? "id, tenant_id, archived_at" : "id, tenant_id";
  const lookup = await admin.from("assets").select(columns).eq("id", id).maybeSingle();
  if (lookup.error) {
    if (withArchive && isMissingColumnError(lookup.error)) {
      return { ok: false, answer: answer("needs_migration") };
    }
    throw new Error(`asset lookup failed: ${lookup.error.message}`);
  }

  const row = lookup.data as unknown as { tenant_id?: string | null; archived_at?: string | null } | null;
  if (!row) return { ok: false, answer: answer("not_found") };

  const tenantId = row.tenant_id ?? null;
  if (!tenantId) return { ok: false, answer: FORBIDDEN };

  try {
    if (level === "office") {
      await authorizeOfficeTenant(admin, user.id, tenantId, "access");
    } else {
      await authorizeTenant(admin, user.id, tenantId, "manage");
    }
  } catch (error) {
    if (error instanceof TenantAccessError && error.status === 401) {
      return { ok: false, answer: UNAUTHENTICATED };
    }
    if (error instanceof TenantAccessError && error.status === 403) {
      return { ok: false, answer: FORBIDDEN };
    }
    throw error;
  }

  return { ok: true, admin, userId: user.id, archivedAt: row.archived_at ?? null };
}

/** POST /api/assets/[id]/archive (archive = true) and /restore (archive = false). */
export async function setAssetArchived(id: string, archive: boolean): Promise<RouteAnswer> {
  try {
    const auth = await authorizeAsset(id, "office", true);
    if (!auth.ok) return auth.answer;

    if (archive && auth.archivedAt) return answer("already_archived");
    if (!archive && !auth.archivedAt) return answer("not_archived");

    const patch = archive
      ? { archived_at: new Date().toISOString(), archived_by: auth.userId }
      : { archived_at: null, archived_by: null };

    // The archived_at condition makes a double click a 409, not a second write.
    const base = auth.admin.from("assets").update(patch).eq("id", id);
    const guarded = archive ? base.is("archived_at", null) : base.not("archived_at", "is", null);
    const { data, error } = await guarded.select("id");

    if (error) {
      if (isMissingColumnError(error)) return answer("needs_migration");
      throw new Error(`asset archive update failed: ${error.message}`);
    }
    if ((data ?? []).length === 0) return answer(archive ? "already_archived" : "not_archived");
    return answer("ok");
  } catch (error) {
    console.error(
      "Asset archive change failed",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return SERVER_ERROR;
  }
}

/** DELETE /api/assets/[id]: admins only, and only an asset with no history. */
export async function deleteAsset(id: string): Promise<RouteAnswer> {
  try {
    const auth = await authorizeAsset(id, "manage", false);
    if (!auth.ok) return auth.answer;

    const history = await auth.admin
      .from("maintenance_records")
      .select("asset_id", { count: "exact", head: true })
      .eq("asset_id", id);
    if (history.error) {
      throw new Error(`maintenance history check failed: ${history.error.message}`);
    }

    if (decideAssetDelete({ maintenanceRows: history.count ?? 0 }).kind === "refuse") {
      return answer("has_maintenance_history");
    }

    const removed = await auth.admin.from("assets").delete().eq("id", id).select("id");
    if (removed.error) {
      // After assets_01 a record added between the count and the delete is refused by RESTRICT.
      // Before it, maintenance_records is still SET NULL, so a record inserted in that window
      // would be orphaned: accepted, the same trade-off as deleteWithoutRpc in
      // app/api/vehicles/[id]/route.ts.
      if (isMaintenanceHistoryViolation(removed.error)) return answer("has_maintenance_history");
      if (isForeignKeyViolation(removed.error)) return answer("referenced");
      throw new Error(`asset delete failed: ${removed.error.message}`);
    }
    return answer((removed.data ?? []).length > 0 ? "ok" : "not_found");
  } catch (error) {
    console.error(
      "Asset delete failed",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return SERVER_ERROR;
  }
}
