import "server-only";
import { NextResponse } from "next/server";
import { OfficeEvidenceError, officeEvidenceErrorResponse } from "../pod/officeEvidence";
import { isUnlicensedVehicleError, unlicensedVehicleMessage } from "../billing/unlicensedVehicle";

export function warehouseDatabaseError(error: { code?: string; message?: string }): never {
  if (isUnlicensedVehicleError(error)) throw new OfficeEvidenceError(409, unlicensedVehicleMessage(error));
  if (["PT400", "PT404", "PT409"].includes(error.code ?? "")) {
    throw new OfficeEvidenceError(Number(error.code!.slice(2)), error.message || "Warehouse operation could not be saved.");
  }
  if (["40001", "40P01"].includes(error.code ?? "")) throw new OfficeEvidenceError(409, "This job changed while saving. Refresh and try again.");
  console.error("[warehouse] database request failed", error.code, error.message);
  throw new OfficeEvidenceError(500, "Warehouse could not finish this request. Please retry.");
}
export function warehouseErrorResponse(error: unknown) {
  const result = officeEvidenceErrorResponse(error);
  return NextResponse.json({ error: result.message }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
