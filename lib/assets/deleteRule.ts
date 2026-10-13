/* Can an asset be hard-deleted, and what each asset route answers. Pure; the
   routes in lib/assets/server.ts load the counts and map results through here.

   THE RULE. An asset with any maintenance history is archived, never deleted:
   maintenance_records.asset_id used to be ON DELETE SET NULL, so a delete
   silently orphaned the history. docs/sql/assets_01 makes it RESTRICT, so the
   database refuses too. Phase C adds assignment history as another count. */

export type AssetHistoryCounts = {
  maintenanceRows: number;
};

export type AssetDeleteDecision = { kind: "allow" } | { kind: "refuse" };

export const ASSET_HAS_HISTORY_MESSAGE = "This asset has maintenance history. Archive it instead.";
export const ASSET_NEEDS_MIGRATION_MESSAGE =
  "Asset archiving needs the assets_01 database migration. Ask an administrator to apply it.";

export function decideAssetDelete(counts: AssetHistoryCounts): AssetDeleteDecision {
  return counts.maintenanceRows > 0 ? { kind: "refuse" } : { kind: "allow" };
}

export type AssetRouteResult =
  | "ok"
  | "not_found"
  | "has_maintenance_history"
  | "already_archived"
  | "not_archived"
  | "needs_migration";

export type AssetRouteHttp = {
  status: 200 | 404 | 409 | 503;
  body: { ok: true } | { error: string; code: Exclude<AssetRouteResult, "ok"> };
};

export function assetRouteResponse(result: AssetRouteResult): AssetRouteHttp {
  switch (result) {
    case "ok":
      return { status: 200, body: { ok: true } };
    case "not_found":
      return { status: 404, body: { error: "Asset not found.", code: result } };
    case "has_maintenance_history":
      return { status: 409, body: { error: ASSET_HAS_HISTORY_MESSAGE, code: result } };
    case "already_archived":
      return { status: 409, body: { error: "This asset is already archived.", code: result } };
    case "not_archived":
      return { status: 409, body: { error: "This asset is not archived.", code: result } };
    case "needs_migration":
      return { status: 503, body: { error: ASSET_NEEDS_MIGRATION_MESSAGE, code: result } };
  }
}
