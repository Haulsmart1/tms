export type WarehouseAction = "collect" | "deliver" | "move" | "reopen";

export type WarehouseStop = {
  id: string; type: string; stop_order: number; address_line: string;
  city: string | null; postcode: string | null; contact_name: string | null;
  contact_phone: string | null; contact_email: string | null;
  status: string; pod_status: string | null;
};
export type WarehouseJob = {
  id: string; reference: string | null; status: string | null; pod_status: string | null;
  vehicle_id: string | null; driver_id: string | null; planning_date: string | null;
  customer_reference: string | null; external_reference: string | null;
  stops: WarehouseStop[]; barcodes: string[];
};
export type WarehouseOptions = {
  vehicles: { id: string; registration: string }[];
  drivers: { id: string; name: string | null }[];
  plans: { id: string; name: string; planning_date: string }[];
};
export type WarehouseResult = {
  jobs: WarehouseJob[]; total: number; page: number; manifest: boolean;
  stats: { total: number; outstanding: number; collected: number; delivered: number; unassigned: number };
  options: WarehouseOptions;
  recent: { request_id: string; action: WarehouseAction; created_at: string;
    result: { count: number; references: string[] }; note: string }[];
};
export const WAREHOUSE_ACTION_LABELS: Record<WarehouseAction, string> = {
  collect: "Mark collected", deliver: "Mark delivered", move: "Move jobs", reopen: "Reopen for collection",
};
