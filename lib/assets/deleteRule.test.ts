import { describe, expect, it } from "vitest";
import {
  ASSET_HAS_HISTORY_MESSAGE,
  ASSET_NEEDS_MIGRATION_MESSAGE,
  assetRouteResponse,
  decideAssetDelete,
} from "./deleteRule";

describe("decideAssetDelete", () => {
  it("allows an asset with no history", () => {
    expect(decideAssetDelete({ maintenanceRows: 0 })).toEqual({ kind: "allow" });
  });

  it("refuses an asset with maintenance history", () => {
    expect(decideAssetDelete({ maintenanceRows: 3 })).toEqual({ kind: "refuse" });
  });
});

describe("assetRouteResponse", () => {
  it("maps every result to the route contract", () => {
    expect(assetRouteResponse("ok")).toEqual({ status: 200, body: { ok: true } });
    expect(assetRouteResponse("not_found")).toEqual({
      status: 404,
      body: { error: "Asset not found.", code: "not_found" },
    });
    expect(assetRouteResponse("has_maintenance_history")).toEqual({
      status: 409,
      body: { error: ASSET_HAS_HISTORY_MESSAGE, code: "has_maintenance_history" },
    });
    expect(assetRouteResponse("already_archived")).toEqual({
      status: 409,
      body: { error: "This asset is already archived.", code: "already_archived" },
    });
    expect(assetRouteResponse("not_archived")).toEqual({
      status: 409,
      body: { error: "This asset is not archived.", code: "not_archived" },
    });
    expect(assetRouteResponse("needs_migration")).toEqual({
      status: 503,
      body: { error: ASSET_NEEDS_MIGRATION_MESSAGE, code: "needs_migration" },
    });
  });
});
