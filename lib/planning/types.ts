/* Row shapes for the Planning page, mirroring the columns app/planning/page.tsx
   selects. Kept separate from the logic modules so waypoints, geocoding,
   optimize and saveDiff can all import them without importing each other,
   the same layout lib/tracking/types.ts uses. */

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
  reference: string | null;
  status: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  subcontractor_id: string | null;
  route_order: number | null;
  customer_name: string | null;
  stops: PlanStop[];
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
