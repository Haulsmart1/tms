import { isUuid } from "../auth/serverTenantAccess";
import { validPlanningDate } from "../planning/navigation";
import type { WarehouseAction } from "./types";

export const MAX_WAREHOUSE_JOBS = 200;
export type WarehouseInput = {
  requestId: string; action: WarehouseAction; jobIds: string[];
  vehicleId: string | null; driverId: string | null; planId: string | null;
  planningDate: string | null; note: string;
};
export function parseWarehouseInput(body: unknown): WarehouseInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid warehouse request.");
  const b = body as Record<string, unknown>;
  if (!isUuid(b.requestId)) throw new Error("A request ID is required.");
  if (!["collect", "deliver", "move", "reopen"].includes(String(b.action))) throw new Error("Choose a warehouse action.");
  if (!Array.isArray(b.jobIds) || !b.jobIds.length || b.jobIds.length > MAX_WAREHOUSE_JOBS || !b.jobIds.every(isUuid)) {
    throw new Error(`Select between 1 and ${MAX_WAREHOUSE_JOBS} jobs.`);
  }
  const nullableId = (key: string) => {
    if (b[key] == null || b[key] === "") return null;
    if (!isUuid(b[key])) throw new Error(`Invalid ${key}.`);
    return b[key] as string;
  };
  const vehicleId = nullableId("vehicleId"), driverId = nullableId("driverId"), planId = nullableId("planId");
  const planningDate = b.planningDate == null || b.planningDate === "" ? null : b.planningDate;
  if (planningDate !== null && !validPlanningDate(planningDate)) throw new Error("Choose a valid planning date.");
  if (b.action === "move" && !vehicleId && (driverId || planId)) throw new Error("Choose a van for the driver or saved plan.");
  if (b.action === "move" && vehicleId && !planningDate && !planId) throw new Error("Choose a planning date or saved plan.");
  if (b.note !== undefined && typeof b.note !== "string") throw new Error("Invalid warehouse note.");
  const note = (b.note as string | undefined)?.trim() ?? "";
  if (note.length > 2000) throw new Error("Keep the note under 2,000 characters.");
  return { requestId: b.requestId, action: b.action as WarehouseAction, jobIds: [...new Set(b.jobIds)].sort(),
    vehicleId, driverId, planId, planningDate: planningDate as string | null, note };
}

export function parseWarehouseSearch(params: URLSearchParams) {
  const query = (params.get("q") ?? "").trim();
  if (query.length > 250 || /[\u0000-\u001f\u007f]/.test(query)) throw new Error("Enter a barcode, name, address or job reference up to 250 characters.");
  const page = Number(params.get("page") ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 100000) throw new Error("Invalid page.");
  const filter = params.get("filter") ?? "all";
  if (!["all", "outstanding", "collected", "delivered", "unassigned"].includes(filter)) throw new Error("Invalid job filter.");
  return { query, page, filter, exact: params.get("scan") === "1" };
}
