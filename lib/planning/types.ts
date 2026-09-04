/* Row shapes for the Planning page, mirroring the columns app/planning/page.tsx
   selects. Kept separate from the logic modules so waypoints, geocoding,
   optimize and saveDiff can all import them without importing each other,
   the same layout lib/tracking/types.ts uses. */

export type PlanJobItem = {
  id: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  serial_numbers: string[] | null;
  external_reference: string | null;
  notes: string | null;
};

export type PlanStop = {
  id: string;
  stop_order: number;
  type: string | null;
  address_line: string;
  city: string | null;
  postcode: string | null;
  /** TomTom geocode cache, written by app/api/tomtom/geocode. NULL until then. */
  lat: number | null;
  lng: number | null;
};

export type PlanJob = {
  id: string;
  tenant_id: string | null;
  reference: string | null;
  status: string | null;
  collection_eta: string | null;
  delivery_eta: string | null;
  acceptance_note: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  subcontractor_id: string | null;
  route_order: number | null;
  customer_name: string | null;

  /** Compliance classification facts. The Planning loader always supplies
      these; optional keeps older pure-planning fixtures source-compatible. */
  journey_scope?: "gb_domestic" | "uk_eu" | "aetr" | "international_other" | null;
  origin_country_code?: string | null;
  destination_country_code?: string | null;
  compliance_regime_override?:
    | "gb_domestic"
    | "assimilated"
    | "aetr"
    | "international_light_goods"
    | "exempt"
    | "unknown"
    | null;
  compliance_override_reason?: string | null;

  stops: PlanStop[];

  /** Serialized box/item data used by Planning bulk label printing. */
  items?: PlanJobItem[];
};

export type LatLng = { lat: number; lng: number };

export type RouteLeg = { distanceMeters: number; travelTimeSeconds: number };

export type RouteResult = {
  /** The drawable road geometry, ordered. */
  points: LatLng[];
  /** One leg per consecutive waypoint pair, in order. */
  legs: RouteLeg[];
  totalDistanceMeters: number;
  totalTravelTimeSeconds: number;
};
