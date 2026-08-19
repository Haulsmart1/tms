# Planning Page Design

Date: 2026-08-19
Status: Approved (brainstorm with Ethan, visual companion session 475-1787132619)

## Purpose

A day-level dispatch planning page for operators. Pick a date, assign that day's jobs to vehicles, sequence each vehicle's jobs, and see the resulting route on a TomTom map with distance and drive time. This is the first real TomTom integration in the codebase; the tracking console's map seam stays a placeholder until it can reuse the pieces built here.

## Scope decisions (settled during brainstorming)

- **Unit of planning: whole jobs.** A vehicle's day is an ordered list of jobs. Each job's stops keep their internal `stop_order`. No cross-job stop interleaving.
- **Assignment happens here.** The page shows unassigned jobs for the chosen date; dragging one into a vehicle lane assigns it. The Jobs form keeps working exactly as it does now.
- **Manual sequencing plus an Optimize button.** The operator orders jobs by hand; Optimize asks TomTom for a better job order, which the operator can accept or tweak. No full auto-planning.
- **Persistence: columns on existing tables.** No new tables, no draft plans, no plan history.

## Navigation and placement

New entry at the top of the Operations group in `lib/nav/navConfig.ts`, above Jobs:

```ts
{ id: "planning", label: "Planning", href: "/planning", icon: "Route" }
```

Page lives at `app/planning/page.tsx`.

## Layout (validated visually, Option C)

- **Top bar**: date picker (defaults to today), selected vehicle's total distance and drive time, Optimize order button, Save plan button, unsaved-changes indicator.
- **Map (top half)**: TomTom map showing the selected vehicle's route as a polyline with numbered job markers and per-leg distance/time chips.
- **Bottom left**: unassigned-jobs pool for the date, plus a small read-only "Subcontracted" list (visible for completeness, not routable).
- **Bottom right**: one horizontal lane per active vehicle. Jobs sit left to right in running order with drop zones. Lane header shows vehicle registration, a driver picker, and the lane's job count, distance, and time. Clicking a lane selects that vehicle on the map; on load, the first lane with jobs is selected. Optimize applies to the selected vehicle only.

## Data model (one migration)

Added to `jobs`:

- `route_order integer null`: the job's position within its vehicle's day. A vehicle's plan for a date is its jobs for that `scheduled_date` ordered by `route_order`. Null means unsequenced.

Added to `job_stops`:

- `lat double precision null`
- `lng double precision null`
- `geocoded_at timestamptz null`

These cache TomTom geocoding results so each address is geocoded once per stop row. No clearing mechanism is needed: the Jobs page deletes and reinserts a job's stops on every edit (app/jobs/page.tsx), so an edited address is a new row with NULL coordinates that re-geocodes on the next planning load. One accepted limitation: an address TomTom cannot resolve is retried once per planning page load rather than negatively cached; at current scale that cost is negligible, and negative caching is deferred.

No new RLS work: both tables already carry tenant policies that cover new columns. Downstream pages (tracking, POD, invoices) already read `vehicle_id` and `driver_id` and simply ignore `route_order`.

## TomTom integration

Two keys from the existing premium account (key delivery pending; wiring is env-var only):

- `NEXT_PUBLIC_TOMTOM_MAP_KEY` (client): map tiles only, domain-restricted in the TomTom portal because it ships to the browser. The map renders with TomTom's official web map SDK, the one new npm dependency this feature adds.
- `TOMTOM_API_KEY` (server): geocoding and routing. Never sent to the browser.

Server surface, under `app/api/tomtom/`:

- **Geocode handler**: takes stop ids, geocodes `address_line, city, postcode` via TomTom Search, writes `lat/lng/geocoded_at` back to `job_stops`, returns the coordinates. Only called for stops missing coordinates.
- **Route handler**: takes an ordered list of coordinates, returns polyline plus per-leg distance and travel time from TomTom Routing.

Routing semantics:

- Waypoints for a vehicle = all its jobs' stops, jobs in `route_order`, stops in `stop_order` within each job.
- **Optimize**: TomTom waypoint optimization reorders individual waypoints, but our unit is the whole job. So optimization runs over one representative point per job (its first stop), the returned order becomes the proposed job order, and the real full-stop route is then recomputed in that order. Good-enough optimization without breaking job integrity.

Pure logic lives in `lib/planning/` as tested modules: building waypoint lists from jobs, mapping an optimized waypoint order back to a job order, and deciding which stops need geocoding. Route handlers and components stay thin.

## Page architecture

- `app/planning/page.tsx`: client page in the `/jobs` mold. Loads the date's jobs with stops, active vehicles, and active drivers via the Supabase browser client and `tenant.filterByTenant`. Holds the working plan in React state.
- `app/planning/PlanningMap.tsx`: mounts the TomTom map, draws numbered markers and the selected vehicle's polyline. With no map key it renders the same honest placeholder pattern as `TrackingMap`, and the board still works.
- `app/planning/VehicleLane.tsx`, `UnassignedPool.tsx`, `PlanJobCard.tsx`: the board. Drag and drop uses native HTML5 DnD, no new dependency. Pool to lane assigns, within lane reorders, lane to pool unassigns.
- Dropping a job into a lane sets its vehicle and the lane's currently picked driver in local state. The lane's driver picker changes `driver_id` for all jobs in that lane (local state until saved).

## Data flow

1. Load date: fetch jobs and stops for the `scheduled_date`.
2. Geocode any stops missing coordinates through the geocode handler (results cached to the DB).
3. Fetch the route for the selected vehicle through the route handler.
4. Operator drags jobs; each change recomputes the affected vehicle's route.
5. **Save plan** writes `vehicle_id`, `driver_id`, and `route_order` for changed jobs in one pass. Until then the top bar shows an unsaved indicator.

Route polylines, distances, and ETAs are display-only and recomputed on load; they are never persisted.

## Error handling

- Un-geocodable address: the job card gets a warning badge and is excluded from routing. Assignment and sequencing still work.
- TomTom routing or geocoding failure: the board stays fully usable; the map keeps the last good route and shows an error notice. Planning must never block assignment.
- Missing keys: placeholder map, board-only mode.

## Testing

Vitest over the pure modules in `lib/planning/`, matching the house style set by `lib/tracking/`:

- Waypoint list construction from jobs and stops, including stops without coordinates.
- Mapping TomTom's optimized waypoint order back to a job order.
- Geocode-needed selection, including the cleared-on-address-edit rule.
- Save-diff computation: which jobs changed and what gets written.

Components and route handlers are exercised manually; the map itself is not unit tested.

## Out of scope (deliberate)

- Writing ETAs back to `job_stops.planned_at`. That column currently holds a fake day-accurate value written by the Jobs page; making it real is its own project.
- Cross-job stop interleaving, auto-planning the whole day, live traffic re-routing, driver-facing views, and plan history.

## Prerequisites

- TomTom API key(s) from the premium account, added to `.env.local` and Vercel env settings.
- Reminder: `.env.local` points at the live Supabase project, so local testing of the migration and geocode write-back touches production data. No live customers as of 2026-08-14, so the risk is acceptable, but the migration should still be reviewed before running.
