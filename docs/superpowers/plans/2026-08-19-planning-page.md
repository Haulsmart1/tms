# Planning Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A day-level dispatch Planning page above Jobs in Operations: assign and sequence whole jobs per vehicle on a TomTom map, with manual ordering plus an Optimize pass, persisted as `jobs.route_order` and cached stop geocodes on `job_stops`.

**Architecture:** Pure planning logic lives in tested `lib/planning/` modules (waypoints, geocode selection, order optimization, save diff, display formatting). TomTom's premium key stays server-side behind three thin route handlers under `app/api/tomtom/` (geocode, route, matrix); only the domain-restricted map-tile key ships to the browser. The page itself follows the `/jobs` and `/tracking` house pattern: a `"use client"` page using the Supabase browser client with `tenant.filterByTenant`, board components with native HTML5 drag and drop, and a map component that renders an honest placeholder when the key is missing.

**Tech Stack:** Next.js 16 (app router), React 19, Supabase (browser client + `@supabase/ssr` server client), Tailwind with the `.ds` design-system tokens, vitest, TomTom Search/Routing/Matrix APIs, `@tomtom-international/web-sdk-maps` (the one new dependency).

**Spec:** `docs/superpowers/specs/2026-08-19-planning-page-design.md`

**Branch:** `ethan/planning-page` (house convention: all branches are `ethan/<slug>`)

**Spec deviations, discovered during planning:**

1. The spec says JobForm must clear `lat/lng/geocoded_at` when a stop's address is edited. No change is needed: `app/jobs/page.tsx:178-197` deletes and reinserts every stop on job edit, so edited stops are new rows with null coordinates and re-geocode automatically.
2. The spec described Optimize as a TomTom waypoint-optimization call over representative points. TomTom's `computeBestOrder` pins the first and last waypoints, which would silently pin the first and last JOBS. Instead the server fetches a travel-time matrix (Matrix Routing v2) and a tested local solver picks the order with no pinning (Task 5). Same spec intent, correct behavior, and the solver is unit-testable.
3. Lane headers show distance/time once that lane has been selected and routed (routes are fetched per selected vehicle, not for every lane on load, to keep API usage proportional). Unrouted lanes show job count only.

**Accepted v1 gaps (decided during execution, tracked for follow-up):**

- The board is drag-and-drop only: no keyboard path exists for assigning, reordering, or unassigning jobs. Accepted for v1 (no live customers; lane-click selection follows the existing house pattern), to revisit in an accessibility pass.
- No negative geocode caching: an address TomTom cannot resolve retries once per planning page load (see the spec's data-model section).
- The TomTom map SDK (@tomtom-international/web-sdk-maps v6) is deprecated by TomTom in favor of @tomtom-org/maps-sdk; v6 works and is fully typed, migration is a future task. Its dependency tree also brings uuid@3.3.3 (GHSA-w5hq-g745-h8pq, moderate, no fix; not exploitable here), a second reason to migrate.
- Per-leg distance/time chips on the map (in the spec and the approved mockup) are deferred until the TomTom map key exists: they are DOM overlays that need real tiles and projected positions to place and verify, and the top-bar totals plus the polyline carry the core value meanwhile. RouteResult.legs is already parsed, typed, and returned by the route endpoint, so rendering them is purely map-side work.

---

## File Structure

Created:

- `supabase/migrations/20260819_planning.sql` - migration: `jobs.route_order`, `job_stops.lat/lng/geocoded_at`
- `lib/planning/types.ts` - row shapes the page selects; shared by all planning modules
- `lib/planning/waypoints.ts` + `.test.ts` - routability, waypoint lists, representative points
- `lib/planning/geocoding.ts` + `.test.ts` - geocode query strings, which stops need geocoding
- `lib/planning/optimize.ts` + `.test.ts` - best job order over a travel-time matrix
- `lib/planning/saveDiff.ts` + `.test.ts` - which jobs changed and what Save writes
- `lib/planning/format.ts` + `.test.ts` - "92 km", "2 h 41 m" display strings
- `lib/tomtom/api.ts` + `.test.ts` - TomTom URL builders and response parsers (pure)
- `app/api/tomtom/geocode/route.ts` - geocodes stops, writes cache back to `job_stops`
- `app/api/tomtom/route/route.ts` - route polyline + legs for an ordered point list
- `app/api/tomtom/matrix/route.ts` - NxN travel-time matrix for Optimize
- `app/planning/page.tsx` - the page: load, geocode, lanes state, route fetch, optimize, save
- `app/planning/PlanningMap.tsx` - TomTom map mount, markers, polyline, placeholder mode
- `app/planning/PlanJobCard.tsx` - one draggable job card
- `app/planning/VehicleLane.tsx` - one vehicle's lane: header, driver picker, drop targets
- `app/planning/UnassignedPool.tsx` - unassigned pool + read-only subcontracted list

Modified:

- `lib/nav/navConfig.ts:22-30` - `planning` item at the top of Operations
- `app/components/AppShell.tsx:5-22` - `Route` icon import + ICONS entry

Environment (user-provided, not committed):

- `TOMTOM_API_KEY` - server-side: Search, Routing, Matrix
- `NEXT_PUBLIC_TOMTOM_MAP_KEY` - client-side map tiles, domain-restricted in the TomTom portal

Everything except the map itself works without the keys: the geocode/route/matrix handlers return 503 and the page degrades to board-only mode with a placeholder map, which is also how development proceeds until the premium key arrives.

---

### Task 1: Branch and migration

**Files:**
- Create: `supabase/migrations/20260819_planning.sql`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b ethan/planning-page
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260819_planning.sql`:

```sql
-- Planning page (spec: docs/superpowers/specs/2026-08-19-planning-page-design.md)
--
-- jobs.route_order: the job's position within its vehicle's day. A vehicle's
--   plan for a date is its jobs for that scheduled_date ordered by route_order.
--   NULL means unsequenced.
--
-- job_stops.lat/lng/geocoded_at: TomTom geocode cache so each address is
--   geocoded once, ever. No clearing trigger is needed: app/jobs/page.tsx
--   deletes and reinserts a job's stops on every edit, so a changed address is
--   a brand-new row with NULL coordinates.
--
-- No RLS work: both tables already carry tenant policies (cmd ALL, tenant_id =
-- get_my_company_id()) that cover new columns automatically.

alter table public.jobs
  add column if not exists route_order integer;

alter table public.job_stops
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz;
```

- [ ] **Step 3: Run the migration against Supabase**

This project applies migrations by pasting the file into the Supabase SQL editor (there is no CLI pipeline; the two existing files in `supabase/migrations/` were applied the same way). NOTE: `.env.local` points at the LIVE Supabase project; the statements are additive `add column if not exists`, safe to run, but say so to the user and get a confirmation before running. Verify afterwards with:

```sql
select column_name from information_schema.columns
where table_name in ('jobs', 'job_stops')
  and column_name in ('route_order', 'lat', 'lng', 'geocoded_at');
```

Expected: 4 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819_planning.sql
git commit -m "feat: add route_order and stop geocode columns for planning"
```

---

### Task 2: Navigation entry and page stub

**Files:**
- Modify: `lib/nav/navConfig.ts:22-30`
- Modify: `app/components/AppShell.tsx:5-22`
- Create: `app/planning/page.tsx` (stub, replaced in Task 12)

- [ ] **Step 1: Add the nav item**

In `lib/nav/navConfig.ts`, add `planning` as the FIRST item of the Operations group, above `jobs`:

```ts
  {
    label: "Operations",
    items: [
      { id: "planning", label: "Planning", href: "/planning", icon: "Route" },
      { id: "jobs", label: "Jobs", href: "/jobs", icon: "ClipboardList" },
      { id: "pod", label: "Proof of delivery", href: "/pod", icon: "CircleCheck" },
      { id: "tracking", label: "Tracking", href: "/tracking", icon: "MapPin" },
      { id: "invoices", label: "Invoices", href: "/invoices", icon: "Receipt" },
      { id: "customers", label: "Customers", href: "/customers", icon: "Building2" },
      { id: "subcontractors", label: "Subcontractors", href: "/subcontractors", icon: "Users" },
    ],
  },
```

- [ ] **Step 2: Register the icon in AppShell**

`app/components/AppShell.tsx` maps icon-name strings to lucide components. Add `Route` to BOTH the import and the `ICONS` record (an unmapped name renders nothing):

```ts
import {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings, LogOut,
  Route,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings, Route,
};
```

- [ ] **Step 3: Create the page stub**

Create `app/planning/page.tsx` so the nav link resolves. Task 12 replaces this file wholesale:

```tsx
"use client";

import TenantGate from "../components/TenantGate";

export default function PlanningPage() {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <div className="p-6">
          <h1 className="text-xl font-semibold">Planning</h1>
          <p className="mt-2 text-sm text-ink-3">Route planning is being built.</p>
        </div>
      </div>
    </TenantGate>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/navConfig.ts app/components/AppShell.tsx app/planning/page.tsx
git commit -m "feat: add Planning nav entry and page stub"
```

---

### Task 3: Planning types and waypoint logic

**Files:**
- Create: `lib/planning/types.ts`
- Create: `lib/planning/waypoints.ts`
- Test: `lib/planning/waypoints.test.ts`

- [ ] **Step 1: Write the types file**

Create `lib/planning/types.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

Create `lib/planning/waypoints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isRoutable, jobRepresentativePoint, jobWaypoints, laneWaypoints, sortedStops } from "./waypoints";
import type { PlanJob, PlanStop } from "./types";

function stop(overrides: Partial<PlanStop>): PlanStop {
  return {
    id: "s1", stop_order: 1, type: "collection",
    address_line: "1 Dock Rd", city: "Leeds", postcode: "LS1 1AA",
    lat: 53.8, lng: -1.55,
    ...overrides,
  };
}

function job(stops: PlanStop[], overrides: Partial<PlanJob> = {}): PlanJob {
  return {
    id: "j1", reference: "JOB-1", status: "planned",
    vehicle_id: null, driver_id: null, subcontractor_id: null,
    route_order: null, customer_name: "Acme", stops,
    ...overrides,
  };
}

describe("isRoutable", () => {
  it("is true when every stop has coordinates", () => {
    expect(isRoutable(job([stop({}), stop({ id: "s2", stop_order: 2 })]))).toBe(true);
  });

  it("is false when any stop is missing a coordinate", () => {
    expect(isRoutable(job([stop({}), stop({ id: "s2", stop_order: 2, lat: null })]))).toBe(false);
    expect(isRoutable(job([stop({ lng: null })]))).toBe(false);
  });

  it("is false for a job with no stops", () => {
    expect(isRoutable(job([]))).toBe(false);
  });
});

describe("sortedStops", () => {
  it("orders by stop_order without mutating the input", () => {
    const a = stop({ id: "a", stop_order: 2 });
    const b = stop({ id: "b", stop_order: 1 });
    const j = job([a, b]);
    expect(sortedStops(j).map((s) => s.id)).toEqual(["b", "a"]);
    expect(j.stops.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("jobWaypoints", () => {
  it("returns coordinates in stop_order", () => {
    const j = job([
      stop({ id: "a", stop_order: 2, lat: 53.9, lng: -1.0 }),
      stop({ id: "b", stop_order: 1, lat: 53.8, lng: -1.5 }),
    ]);
    expect(jobWaypoints(j)).toEqual([
      { lat: 53.8, lng: -1.5 },
      { lat: 53.9, lng: -1.0 },
    ]);
  });

  it("returns [] for an unroutable job rather than a partial route", () => {
    expect(jobWaypoints(job([stop({}), stop({ id: "s2", stop_order: 2, lat: null })]))).toEqual([]);
  });
});

describe("jobRepresentativePoint", () => {
  it("is the first stop by stop_order", () => {
    const j = job([
      stop({ id: "a", stop_order: 2, lat: 53.9, lng: -1.0 }),
      stop({ id: "b", stop_order: 1, lat: 53.8, lng: -1.5 }),
    ]);
    expect(jobRepresentativePoint(j)).toEqual({ lat: 53.8, lng: -1.5 });
  });

  it("is null for an unroutable job", () => {
    expect(jobRepresentativePoint(job([]))).toBeNull();
  });
});

describe("laneWaypoints", () => {
  it("concatenates routable jobs in the given order and skips unroutable ones", () => {
    const j1 = job([stop({ id: "a", lat: 1, lng: 1 })], { id: "j1" });
    const broken = job([stop({ id: "b", lat: null })], { id: "j2" });
    const j3 = job([stop({ id: "c", lat: 3, lng: 3 })], { id: "j3" });
    expect(laneWaypoints([j1, broken, j3])).toEqual([
      { lat: 1, lng: 1 },
      { lat: 3, lng: 3 },
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run lib/planning/waypoints.test.ts`
Expected: FAIL with a module resolution error for `./waypoints`.

- [ ] **Step 4: Write the implementation**

Create `lib/planning/waypoints.ts`:

```ts
import type { LatLng, PlanJob, PlanStop } from "./types";

/* A job is routable only when EVERY stop has cached coordinates. Routing
   around a missing stop would draw a route that looks shorter than the day
   really is, which is the worst kind of wrong: plausible. Unroutable jobs
   stay draggable on the board and are simply left out of the route. */
export function isRoutable(job: PlanJob): boolean {
  return job.stops.length > 0 && job.stops.every((s) => s.lat !== null && s.lng !== null);
}

export function sortedStops(job: PlanJob): PlanStop[] {
  return [...job.stops].sort((a, b) => a.stop_order - b.stop_order);
}

/** A routable job's stops as waypoints, in stop_order. [] when unroutable. */
export function jobWaypoints(job: PlanJob): LatLng[] {
  if (!isRoutable(job)) return [];
  return sortedStops(job).map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
}

/** The single point that stands in for the whole job during optimization
    (the spec's "representative point": the first stop). */
export function jobRepresentativePoint(job: PlanJob): LatLng | null {
  return jobWaypoints(job)[0] ?? null;
}

/** Waypoints for one vehicle's day: jobs in lane order, stops in stop_order,
    unroutable jobs skipped. */
export function laneWaypoints(jobs: PlanJob[]): LatLng[] {
  return jobs.flatMap(jobWaypoints);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/planning/waypoints.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/planning/types.ts lib/planning/waypoints.ts lib/planning/waypoints.test.ts
git commit -m "feat: planning types and waypoint logic"
```

---

### Task 4: Geocode selection logic

**Files:**
- Create: `lib/planning/geocoding.ts`
- Test: `lib/planning/geocoding.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/planning/geocoding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { geocodeQuery, stopsNeedingGeocode } from "./geocoding";
import type { PlanJob, PlanStop } from "./types";

function stop(overrides: Partial<PlanStop>): PlanStop {
  return {
    id: "s1", stop_order: 1, type: "collection",
    address_line: "1 Dock Rd", city: "Leeds", postcode: "LS1 1AA",
    lat: 53.8, lng: -1.55,
    ...overrides,
  };
}

function job(stops: PlanStop[], id = "j1"): PlanJob {
  return {
    id, reference: "JOB-1", status: "planned",
    vehicle_id: null, driver_id: null, subcontractor_id: null,
    route_order: null, customer_name: "Acme", stops,
  };
}

describe("geocodeQuery", () => {
  it("joins the parts with commas", () => {
    expect(geocodeQuery({ address_line: "1 Dock Rd", city: "Leeds", postcode: "LS1 1AA" }))
      .toBe("1 Dock Rd, Leeds, LS1 1AA");
  });

  it("drops null and blank parts", () => {
    expect(geocodeQuery({ address_line: "1 Dock Rd", city: null, postcode: "LS1 1AA" }))
      .toBe("1 Dock Rd, LS1 1AA");
    expect(geocodeQuery({ address_line: "1 Dock Rd", city: "  ", postcode: null }))
      .toBe("1 Dock Rd");
  });

  it("trims whitespace inside kept parts", () => {
    expect(geocodeQuery({ address_line: " 1 Dock Rd ", city: "Leeds", postcode: null }))
      .toBe("1 Dock Rd, Leeds");
  });
});

describe("stopsNeedingGeocode", () => {
  it("returns ids of stops missing either coordinate, across jobs", () => {
    const jobs = [
      job([stop({ id: "a" }), stop({ id: "b", stop_order: 2, lat: null })], "j1"),
      job([stop({ id: "c", lng: null })], "j2"),
    ];
    expect(stopsNeedingGeocode(jobs)).toEqual(["b", "c"]);
  });

  it("is empty when everything is geocoded", () => {
    expect(stopsNeedingGeocode([job([stop({})])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/planning/geocoding.test.ts`
Expected: FAIL with a module resolution error for `./geocoding`.

- [ ] **Step 3: Write the implementation**

Create `lib/planning/geocoding.ts`:

```ts
import type { PlanJob, PlanStop } from "./types";

/** The free-text query sent to TomTom for one stop. address_line is NOT NULL
    in the schema but city and postcode are nullable, and JobForm also saves
    blank strings, so both cases are dropped rather than sending ", ," noise
    that degrades geocoder accuracy. */
export function geocodeQuery(
  stop: Pick<PlanStop, "address_line" | "city" | "postcode">
): string {
  return [stop.address_line, stop.city, stop.postcode]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(", ");
}

/** Ids of every stop across the listed jobs still missing coordinates. The
    geocode API route is only ever called with these, which is what makes the
    cache a cache: a geocoded stop is never sent again. */
export function stopsNeedingGeocode(jobs: PlanJob[]): string[] {
  return jobs.flatMap((job) =>
    job.stops.filter((s) => s.lat === null || s.lng === null).map((s) => s.id)
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/planning/geocoding.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/planning/geocoding.ts lib/planning/geocoding.test.ts
git commit -m "feat: geocode query building and cache-miss selection"
```

---

### Task 5: Job-order optimization

**Files:**
- Create: `lib/planning/optimize.ts`
- Test: `lib/planning/optimize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/planning/optimize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bestOrder, pathSeconds } from "./optimize";

describe("pathSeconds", () => {
  it("sums consecutive hops", () => {
    const m = [
      [0, 10, 99],
      [99, 0, 20],
      [99, 99, 0],
    ];
    expect(pathSeconds([0, 1, 2], m)).toBe(30);
  });

  it("is 0 for a single job", () => {
    expect(pathSeconds([0], [[0]])).toBe(0);
  });
});

describe("bestOrder", () => {
  it("handles the empty and single-job cases", () => {
    expect(bestOrder([])).toEqual([]);
    expect(bestOrder([[0]])).toEqual([0]);
  });

  it("picks the cheaper direction for two jobs (asymmetric matrix)", () => {
    // 0 -> 1 costs 100, 1 -> 0 costs 10: the best open path is [1, 0].
    const m = [
      [0, 100],
      [10, 0],
    ];
    expect(bestOrder(m)).toEqual([1, 0]);
  });

  it("finds the exact best order for a small matrix", () => {
    // Best open path is 2 -> 0 -> 1 with cost 1 + 1 = 2.
    const m = [
      [0, 1, 50],
      [50, 0, 50],
      [1, 50, 0],
    ];
    expect(bestOrder(m)).toEqual([2, 0, 1]);
  });

  it("visits every job exactly once, even above the exhaustive limit", () => {
    // 10 jobs in a line: cost i -> j is |i - j| * 60. Any correct solver
    // returns a permutation; the line shape means the best is one end to the
    // other, so the heuristic path must also cost exactly 9 * 60.
    const n = 10;
    const m = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => Math.abs(i - j) * 60)
    );
    const order = bestOrder(m);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(pathSeconds(order, m)).toBe((n - 1) * 60);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/planning/optimize.test.ts`
Expected: FAIL with a module resolution error for `./optimize`.

- [ ] **Step 3: Write the implementation**

Create `lib/planning/optimize.ts`:

```ts
/* Job-order optimization for one vehicle's day.

   TomTom's computeBestOrder reorders individual waypoints and pins the first
   and last in place, but the Planning page's unit is the whole job and no job
   is pinned. So the server fetches an NxN travel-time matrix between job
   representative points (Matrix Routing v2, see app/api/tomtom/matrix) and
   this module picks the order entirely in-process, where it is unit testable
   and costs no further API calls.

   The path is OPEN: a day starts at the first job and ends at the last. There
   is no depot in the schema to return to, so this is not a cycle.

   Exact search runs to 8 jobs (8! = 40,320 paths, with pruning, microseconds).
   Above that, nearest-neighbour from every start improved by 2-opt: not
   provably optimal, but a vehicle with 9+ jobs in one day is already rare. */

const EXACT_LIMIT = 8;

/** Total travel seconds along an open path through `order`. */
export function pathSeconds(order: number[], matrix: number[][]): number {
  let total = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    total += matrix[order[i]][order[i + 1]];
  }
  return total;
}

export function bestOrder(matrix: number[][]): number[] {
  const n = matrix.length;
  if (n <= 1) return matrix.map((_, i) => i);
  if (n <= EXACT_LIMIT) return exhaustive(matrix);
  return twoOpt(nearestNeighbour(matrix), matrix);
}

function exhaustive(matrix: number[][]): number[] {
  const n = matrix.length;
  let best = Array.from({ length: n }, (_, i) => i);
  let bestCost = pathSeconds(best, matrix);
  const current: number[] = [];
  const used = new Array(n).fill(false);

  function walk(cost: number) {
    if (cost >= bestCost) return; // prune: this prefix already loses
    if (current.length === n) {
      best = current.slice();
      bestCost = cost;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const hop = current.length === 0 ? 0 : matrix[current[current.length - 1]][i];
      used[i] = true;
      current.push(i);
      walk(cost + hop);
      current.pop();
      used[i] = false;
    }
  }

  walk(0);
  return best;
}

function nearestNeighbour(matrix: number[][]): number[] {
  const n = matrix.length;
  let best: number[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  // The path is open, so the start matters: try them all and keep the winner.
  for (let start = 0; start < n; start++) {
    const order = [start];
    const used = new Array(n).fill(false);
    used[start] = true;
    while (order.length < n) {
      const last = order[order.length - 1];
      let next = -1;
      for (let i = 0; i < n; i++) {
        if (!used[i] && (next === -1 || matrix[last][i] < matrix[last][next])) next = i;
      }
      used[next] = true;
      order.push(next);
    }
    const cost = pathSeconds(order, matrix);
    if (cost < bestCost) {
      bestCost = cost;
      best = order;
    }
  }
  return best;
}

function twoOpt(order: number[], matrix: number[][]): number[] {
  let current = order.slice();
  let currentCost = pathSeconds(current, matrix);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const candidate = current
          .slice(0, i)
          .concat(current.slice(i, j + 1).reverse(), current.slice(j + 1));
        const cost = pathSeconds(candidate, matrix);
        if (cost < currentCost) {
          current = candidate;
          currentCost = cost;
          improved = true;
        }
      }
    }
  }
  return current;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/planning/optimize.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/planning/optimize.ts lib/planning/optimize.test.ts
git commit -m "feat: open-path job order optimization over a travel-time matrix"
```

---

### Task 6: Save diff

**Files:**
- Create: `lib/planning/saveDiff.ts`
- Test: `lib/planning/saveDiff.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/planning/saveDiff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSaveDiff, type LanePlan } from "./saveDiff";
import type { PlanJob } from "./types";

function job(overrides: Partial<PlanJob>): PlanJob {
  return {
    id: "j1", reference: "JOB-1", status: "planned",
    vehicle_id: null, driver_id: null, subcontractor_id: null,
    route_order: null, customer_name: "Acme", stops: [],
    ...overrides,
  };
}

describe("computeSaveDiff", () => {
  it("writes vehicle, driver and 1-based route_order for newly planned jobs", () => {
    const original = [job({ id: "a" }), job({ id: "b" })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d1", jobIds: ["b", "a"] }];
    expect(computeSaveDiff(original, lanes, [])).toEqual([
      { id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 2 },
      { id: "b", vehicle_id: "v1", driver_id: "d1", route_order: 1 },
    ]);
  });

  it("emits nothing for jobs whose assignment did not change", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d1", jobIds: ["a"] }];
    expect(computeSaveDiff(original, lanes, [])).toEqual([]);
  });

  it("clears all three columns when a job is unassigned", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    expect(computeSaveDiff(original, [], ["a"])).toEqual([
      { id: "a", vehicle_id: null, driver_id: null, route_order: null },
    ]);
  });

  it("does not clear a job that was never assigned", () => {
    const original = [job({ id: "a" })];
    expect(computeSaveDiff(original, [], ["a"])).toEqual([]);
  });

  it("detects a driver-only change", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d2", jobIds: ["a"] }];
    expect(computeSaveDiff(original, lanes, [])).toEqual([
      { id: "a", vehicle_id: "v1", driver_id: "d2", route_order: 1 },
    ]);
  });

  it("ignores jobs that are in no lane and not explicitly unassigned (subcontracted)", () => {
    const original = [job({ id: "sub", subcontractor_id: "s1" })];
    expect(computeSaveDiff(original, [], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/planning/saveDiff.test.ts`
Expected: FAIL with a module resolution error for `./saveDiff`.

- [ ] **Step 3: Write the implementation**

Create `lib/planning/saveDiff.ts`:

```ts
import type { PlanJob } from "./types";

export type LanePlan = {
  vehicleId: string;
  driverId: string | null;
  /** Job ids in running order. Position in this array IS the route_order. */
  jobIds: string[];
};

export type JobUpdate = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  route_order: number | null;
};

/* What Save actually writes: one update per job whose assignment changed,
   compared field-by-field against what was loaded. Unassigning clears all
   three columns; the driver is deliberately included so a job dragged out of
   a lane does not keep a driver it no longer rides with. Jobs in neither a
   lane nor the unassigned list (the subcontracted ones) are untouched. */
export function computeSaveDiff(
  original: PlanJob[],
  lanes: LanePlan[],
  unassignedJobIds: string[]
): JobUpdate[] {
  const target = new Map<string, JobUpdate>();
  for (const lane of lanes) {
    lane.jobIds.forEach((id, index) => {
      target.set(id, {
        id,
        vehicle_id: lane.vehicleId,
        driver_id: lane.driverId,
        route_order: index + 1,
      });
    });
  }
  for (const id of unassignedJobIds) {
    target.set(id, { id, vehicle_id: null, driver_id: null, route_order: null });
  }

  const updates: JobUpdate[] = [];
  for (const job of original) {
    const t = target.get(job.id);
    if (!t) continue;
    if (
      t.vehicle_id !== job.vehicle_id ||
      t.driver_id !== job.driver_id ||
      t.route_order !== job.route_order
    ) {
      updates.push(t);
    }
  }
  return updates;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/planning/saveDiff.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/planning/saveDiff.ts lib/planning/saveDiff.test.ts
git commit -m "feat: compute which job assignments Save writes"
```

---

### Task 7: Display formatting

**Files:**
- Create: `lib/planning/format.ts`
- Test: `lib/planning/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/planning/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration } from "./format";

describe("formatDistance", () => {
  it("renders kilometres to one decimal", () => {
    expect(formatDistance(92_400)).toBe("92.4 km");
  });

  it("renders short hops in metres", () => {
    expect(formatDistance(850)).toBe("850 m");
  });

  it("drops a trailing .0", () => {
    expect(formatDistance(92_000)).toBe("92 km");
  });
});

describe("formatDuration", () => {
  it("renders hours and minutes", () => {
    expect(formatDuration(9_660)).toBe("2 h 41 m");
  });

  it("renders minutes only under an hour", () => {
    expect(formatDuration(1_740)).toBe("29 m");
  });

  it("rounds seconds to the nearest minute and never shows 0 m for a real trip", () => {
    expect(formatDuration(29)).toBe("1 m");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/planning/format.test.ts`
Expected: FAIL with a module resolution error for `./format`.

- [ ] **Step 3: Write the implementation**

Create `lib/planning/format.ts`:

```ts
/* Display strings for route metrics. Kept out of the components so the lane
   header, the top bar and the per-leg chips cannot drift apart on rounding. */

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} km` : `${rounded.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  // A 29-second trip rendered as "0 m" reads as no data; the floor is 1 minute.
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/planning/format.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/planning/format.ts lib/planning/format.test.ts
git commit -m "feat: distance and duration display formatting"
```

---

### Task 8: TomTom URL builders and response parsers

**Files:**
- Create: `lib/tomtom/api.ts`
- Test: `lib/tomtom/api.test.ts`

These are pure: the route handlers in Tasks 9 do the `fetch`, this module builds what to send and interprets what comes back, so the interesting logic is testable without network.

- [ ] **Step 1: Write the failing tests**

Create `lib/tomtom/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  geocodeUrl, matrixBody, matrixUrl, parseGeocode, parseMatrix, parseRoute, routeUrl,
} from "./api";

describe("geocodeUrl", () => {
  it("encodes the query and pins countrySet to GB", () => {
    const url = geocodeUrl("1 Dock Rd, Leeds", "KEY");
    expect(url).toBe(
      "https://api.tomtom.com/search/2/geocode/1%20Dock%20Rd%2C%20Leeds.json?key=KEY&limit=1&countrySet=GB"
    );
  });
});

describe("parseGeocode", () => {
  it("reads the first result's position", () => {
    expect(parseGeocode({ results: [{ position: { lat: 53.8, lon: -1.55 } }] }))
      .toEqual({ lat: 53.8, lng: -1.55 });
  });

  it("returns null for no results or malformed positions", () => {
    expect(parseGeocode({ results: [] })).toBeNull();
    expect(parseGeocode({ results: [{ position: { lat: "53.8" } }] })).toBeNull();
    expect(parseGeocode(null)).toBeNull();
  });
});

describe("routeUrl", () => {
  it("joins lat,lng pairs with colons", () => {
    const url = routeUrl(
      [{ lat: 53.8, lng: -1.55 }, { lat: 53.96, lng: -1.08 }],
      "KEY"
    );
    expect(url).toBe(
      "https://api.tomtom.com/routing/1/calculateRoute/53.8,-1.55:53.96,-1.08/json?key=KEY&travelMode=car&traffic=false&routeRepresentation=polyline"
    );
  });
});

describe("parseRoute", () => {
  const good = {
    routes: [{
      summary: { lengthInMeters: 92_400, travelTimeInSeconds: 9_660 },
      legs: [
        {
          summary: { lengthInMeters: 41_000, travelTimeInSeconds: 3_480 },
          points: [{ latitude: 53.8, longitude: -1.55 }, { latitude: 53.96, longitude: -1.08 }],
        },
        {
          summary: { lengthInMeters: 51_400, travelTimeInSeconds: 6_180 },
          points: [{ latitude: 53.96, longitude: -1.08 }, { latitude: 53.74, longitude: -0.33 }],
        },
      ],
    }],
  };

  it("flattens leg points and keeps per-leg summaries in order", () => {
    const result = parseRoute(good);
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(4);
    expect(result!.points[0]).toEqual({ lat: 53.8, lng: -1.55 });
    expect(result!.legs).toEqual([
      { distanceMeters: 41_000, travelTimeSeconds: 3_480 },
      { distanceMeters: 51_400, travelTimeSeconds: 6_180 },
    ]);
    expect(result!.totalDistanceMeters).toBe(92_400);
    expect(result!.totalTravelTimeSeconds).toBe(9_660);
  });

  it("returns null for an empty or malformed response", () => {
    expect(parseRoute({ routes: [] })).toBeNull();
    expect(parseRoute(null)).toBeNull();
    expect(parseRoute({ routes: [{ summary: {}, legs: [] }] })).toBeNull();
  });
});

describe("matrixUrl and matrixBody", () => {
  it("builds the v2 sync endpoint and a square origins/destinations body", () => {
    expect(matrixUrl("KEY")).toBe("https://api.tomtom.com/routing/matrix/2?key=KEY");
    const body = matrixBody([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
    expect(body).toEqual({
      origins: [{ point: { latitude: 1, longitude: 2 } }, { point: { latitude: 3, longitude: 4 } }],
      destinations: [{ point: { latitude: 1, longitude: 2 } }, { point: { latitude: 3, longitude: 4 } }],
      options: { travelMode: "car" },
    });
  });
});

describe("parseMatrix", () => {
  it("places travel times by origin and destination index, with a zero diagonal", () => {
    const json = {
      data: [
        { originIndex: 0, destinationIndex: 1, routeSummary: { travelTimeInSeconds: 100 } },
        { originIndex: 1, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 90 } },
      ],
    };
    expect(parseMatrix(json, 2)).toEqual([
      [0, 100],
      [90, 0],
    ]);
  });

  it("leaves unreported cells as Infinity so the optimizer avoids them", () => {
    const m = parseMatrix({ data: [] }, 2)!;
    expect(m[0][1]).toBe(Number.POSITIVE_INFINITY);
    expect(m[0][0]).toBe(0);
  });

  it("returns null when the response has no data array", () => {
    expect(parseMatrix({}, 2)).toBeNull();
    expect(parseMatrix(null, 2)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tomtom/api.test.ts`
Expected: FAIL with a module resolution error for `./api`.

- [ ] **Step 3: Write the implementation**

Create `lib/tomtom/api.ts`:

```ts
/* THE TOMTOM WIRE FORMAT, in one place.

   Pure builders and parsers only: the route handlers under app/api/tomtom/
   own fetch, auth and the database, this module owns URLs and response
   shapes. Splitting it this way is what lets the response-shape assumptions
   (the part of an API integration that actually breaks) be unit tested.

   countrySet=GB and travelMode=car are deliberate v1 constraints: this is a
   UK haulage console (en-GB currency and Europe/London throughout the app),
   and truck-specific routing (vehicle dimensions, restrictions) needs
   per-vehicle data the schema does not hold yet. */

import type { LatLng, RouteResult } from "../planning/types";

const BASE = "https://api.tomtom.com";

export function geocodeUrl(query: string, key: string): string {
  return `${BASE}/search/2/geocode/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}&limit=1&countrySet=GB`;
}

export function parseGeocode(json: any): LatLng | null {
  const pos = json?.results?.[0]?.position;
  if (typeof pos?.lat !== "number" || typeof pos?.lon !== "number") return null;
  return { lat: pos.lat, lng: pos.lon };
}

export function routeUrl(points: LatLng[], key: string): string {
  const locations = points.map((p) => `${p.lat},${p.lng}`).join(":");
  return `${BASE}/routing/1/calculateRoute/${locations}/json?key=${encodeURIComponent(key)}&travelMode=car&traffic=false&routeRepresentation=polyline`;
}

export function parseRoute(json: any): RouteResult | null {
  const route = json?.routes?.[0];
  const summary = route?.summary;
  if (
    !Array.isArray(route?.legs) ||
    route.legs.length === 0 ||
    typeof summary?.lengthInMeters !== "number" ||
    typeof summary?.travelTimeInSeconds !== "number"
  ) {
    return null;
  }

  const legs: RouteResult["legs"] = [];
  const points: LatLng[] = [];
  for (const leg of route.legs) {
    const s = leg?.summary;
    if (typeof s?.lengthInMeters !== "number" || typeof s?.travelTimeInSeconds !== "number") {
      return null;
    }
    legs.push({ distanceMeters: s.lengthInMeters, travelTimeSeconds: s.travelTimeInSeconds });
    for (const p of leg.points ?? []) {
      if (typeof p?.latitude === "number" && typeof p?.longitude === "number") {
        points.push({ lat: p.latitude, lng: p.longitude });
      }
    }
  }

  return {
    points,
    legs,
    totalDistanceMeters: summary.lengthInMeters,
    totalTravelTimeSeconds: summary.travelTimeInSeconds,
  };
}

export function matrixUrl(key: string): string {
  return `${BASE}/routing/matrix/2?key=${encodeURIComponent(key)}`;
}

export function matrixBody(points: LatLng[]): object {
  const list = points.map((p) => ({ point: { latitude: p.lat, longitude: p.lng } }));
  return { origins: list, destinations: list, options: { travelMode: "car" } };
}

/** Unreported cells stay Infinity rather than 0: a zero would tell the
    optimizer an unreachable hop is free, which is exactly backwards. */
export function parseMatrix(json: any, n: number): number[][] | null {
  const data = json?.data;
  if (!Array.isArray(data)) return null;
  const matrix = Array.from({ length: n }, () =>
    Array<number>(n).fill(Number.POSITIVE_INFINITY)
  );
  for (let i = 0; i < n; i++) matrix[i][i] = 0;
  for (const cell of data) {
    const i = cell?.originIndex;
    const j = cell?.destinationIndex;
    const t = cell?.routeSummary?.travelTimeInSeconds;
    if (
      Number.isInteger(i) && Number.isInteger(j) &&
      i >= 0 && i < n && j >= 0 && j < n &&
      typeof t === "number"
    ) {
      matrix[i][j] = t;
    }
  }
  return matrix;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tomtom/api.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tomtom/api.ts lib/tomtom/api.test.ts
git commit -m "feat: TomTom URL builders and response parsers"
```

---

### Task 9: TomTom route handlers

**Files:**
- Create: `app/api/tomtom/geocode/route.ts`
- Create: `app/api/tomtom/route/route.ts`
- Create: `app/api/tomtom/matrix/route.ts`

House pattern: `app/api/driver/me/route.ts` shows the cookie-based `createServerClient` auth helper. The geocode handler uses that RLS-scoped client for the database too (NOT the service-role admin client), so tenant filtering on `job_stops` is enforced by the same policies as everywhere else. The route and matrix handlers touch no tables but still require a signed-in user, otherwise they are an open proxy for a paid API key. All three return 503 when `TOMTOM_API_KEY` is unset, which is what the page's board-only degraded mode keys off.

- [ ] **Step 1: Write the geocode handler**

Create `app/api/tomtom/geocode/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { geocodeQuery } from "../../../../lib/planning/geocoding";
import { geocodeUrl, parseGeocode } from "../../../../lib/tomtom/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Callers only send stops that are missing coordinates (see
   stopsNeedingGeocode), so every row this touches is a cache miss. Results
   are written straight back to job_stops through the RLS-scoped client:
   a user can only geocode, and only overwrite, their own tenant's stops. */

const MAX_STOPS = 100;

async function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase public env vars.");
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

export async function POST(request: Request) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const stopIds: string[] = Array.isArray(body?.stopIds)
    ? body.stopIds.filter((id: unknown) => typeof id === "string").slice(0, MAX_STOPS)
    : [];
  if (stopIds.length === 0) {
    return NextResponse.json({ error: "stopIds is required." }, { status: 400 });
  }

  try {
    const client = await authClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    // RLS silently drops rows from other tenants, so a hostile id list simply
    // comes back shorter rather than erroring or leaking.
    const { data: stops, error } = await client
      .from("job_stops")
      .select("id, address_line, city, postcode, lat, lng")
      .in("id", stopIds);
    if (error) throw new Error(error.message);

    const geocoded: { id: string; lat: number; lng: number }[] = [];
    const failed: string[] = [];

    for (const stop of stops ?? []) {
      if (stop.lat !== null && stop.lng !== null) {
        geocoded.push({ id: stop.id, lat: stop.lat, lng: stop.lng });
        continue;
      }
      const query = geocodeQuery(stop);
      if (!query) {
        failed.push(stop.id);
        continue;
      }
      const response = await fetch(geocodeUrl(query, key));
      const position = response.ok ? parseGeocode(await response.json()) : null;
      if (!position) {
        failed.push(stop.id);
        continue;
      }
      const { error: updateError } = await client
        .from("job_stops")
        .update({ lat: position.lat, lng: position.lng, geocoded_at: new Date().toISOString() })
        .eq("id", stop.id);
      if (updateError) {
        failed.push(stop.id);
        continue;
      }
      geocoded.push({ id: stop.id, ...position });
    }

    return NextResponse.json({ geocoded, failed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Geocoding failed." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Write the route handler**

Create `app/api/tomtom/route/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { LatLng } from "../../../../lib/planning/types";
import { parseRoute, routeUrl } from "../../../../lib/tomtom/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* No table access, but auth is still required: without it this endpoint is an
   open proxy that spends the premium TomTom key for anyone on the internet. */

const MAX_POINTS = 50;

function parsePoints(body: any): LatLng[] | null {
  if (!Array.isArray(body?.points)) return null;
  const points: LatLng[] = [];
  for (const p of body.points) {
    if (typeof p?.lat !== "number" || typeof p?.lng !== "number") return null;
    points.push({ lat: p.lat, lng: p.lng });
  }
  return points;
}

async function requireUser(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const store = await cookies();
  const client = createServerClient(url, anon, {
    cookies: { getAll: () => store.getAll(), setAll() {} },
  });
  const { data: { user } } = await client.auth.getUser();
  return Boolean(user);
}

export async function POST(request: Request) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
  }
  if (!(await requireUser())) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const points = parsePoints(body);
  if (!points || points.length < 2 || points.length > MAX_POINTS) {
    return NextResponse.json({ error: "points must be 2 to 50 lat/lng pairs." }, { status: 400 });
  }

  try {
    const response = await fetch(routeUrl(points, key));
    if (!response.ok) {
      return NextResponse.json({ error: `TomTom routing failed (${response.status}).` }, { status: 502 });
    }
    const route = parseRoute(await response.json());
    if (!route) {
      return NextResponse.json({ error: "TomTom returned no route." }, { status: 502 });
    }
    return NextResponse.json(route);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Routing failed." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Write the matrix handler**

Create `app/api/tomtom/matrix/route.ts`. It shares `requireUser` shape with the route handler; the duplication is two small functions in two thin files, matching how the existing api routes each carry their own `authClient` rather than importing a shared one:

```ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { LatLng } from "../../../../lib/planning/types";
import { matrixBody, matrixUrl, parseMatrix } from "../../../../lib/tomtom/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The synchronous Matrix v2 endpoint caps at 100 cells, so 10 jobs is the
   ceiling (10 x 10). The page never optimizes more than one vehicle's day at
   a time, so hitting this limit means a single van with 11+ jobs in one day;
   the handler rejects rather than silently truncating. */

const MAX_JOBS = 10;

function parsePoints(body: any): LatLng[] | null {
  if (!Array.isArray(body?.points)) return null;
  const points: LatLng[] = [];
  for (const p of body.points) {
    if (typeof p?.lat !== "number" || typeof p?.lng !== "number") return null;
    points.push({ lat: p.lat, lng: p.lng });
  }
  return points;
}

async function requireUser(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const store = await cookies();
  const client = createServerClient(url, anon, {
    cookies: { getAll: () => store.getAll(), setAll() {} },
  });
  const { data: { user } } = await client.auth.getUser();
  return Boolean(user);
}

export async function POST(request: Request) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
  }
  if (!(await requireUser())) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const points = parsePoints(body);
  if (!points || points.length < 2 || points.length > MAX_JOBS) {
    return NextResponse.json(
      { error: `points must be 2 to ${MAX_JOBS} lat/lng pairs.` },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(matrixUrl(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(matrixBody(points)),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `TomTom matrix failed (${response.status}).` }, { status: 502 });
    }
    const travelSeconds = parseMatrix(await response.json(), points.length);
    if (!travelSeconds) {
      return NextResponse.json({ error: "TomTom returned no matrix." }, { status: 502 });
    }
    return NextResponse.json({ travelSeconds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Matrix routing failed." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/tomtom
git commit -m "feat: TomTom geocode, route and matrix API endpoints"
```

---

### Task 10: Map component

**Files:**
- Create: `app/planning/PlanningMap.tsx`
- Modify: `package.json` (new dependency)

- [ ] **Step 1: Install the map SDK**

```bash
npm install @tomtom-international/web-sdk-maps
```

Expected: package.json gains the dependency; lockfile updates.

- [ ] **Step 2: Write the component**

Create `app/planning/PlanningMap.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";
import type { LatLng, RouteResult } from "../../lib/planning/types";

export type MapMarker = { position: LatLng; label: string };

type Props = {
  markers: MapMarker[];
  route: RouteResult | null;
  /** Non-null renders an overlay chip: route fetch failed, stops unroutable, etc. */
  notice: string | null;
};

/* THE PLANNING MAP MOUNT.

   The SDK touches `window` at import time, so it is loaded with a dynamic
   import inside an effect rather than at module top. Everything TomTom is
   confined to this file: the page hands in plain markers and a RouteResult
   and knows nothing about tt.Marker or geojson sources.

   With no NEXT_PUBLIC_TOMTOM_MAP_KEY this renders a labelled placeholder in
   the TrackingMap mould: an honest statement, not a spinner pretending tiles
   are on the way. The board around it keeps working either way. */

const MAP_KEY = process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY;
const HEIGHT = 380;
// Roughly central England, wide enough to see a UK operation before data loads.
const DEFAULT_CENTER: [number, number] = [-1.5, 53.0];
const DEFAULT_ZOOM = 6;

export default function PlanningMap({ markers, route, notice }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<{ tt: any; map: any } | null>(null);
  const markerObjsRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!MAP_KEY || !containerRef.current || handleRef.current) return;
    let cancelled = false;
    (async () => {
      const tt = (await import("@tomtom-international/web-sdk-maps")).default;
      if (cancelled || !containerRef.current) return;
      const map = tt.map({
        key: MAP_KEY,
        container: containerRef.current,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });
      handleRef.current = { tt, map };
      // "load" fires once the style is ready; layers added before it throw.
      map.on("load", () => setReady(true));
    })();
    return () => {
      cancelled = true;
      handleRef.current?.map?.remove();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !ready) return;
    const { tt, map } = handle;

    markerObjsRef.current.forEach((m) => m.remove());
    markerObjsRef.current = markers.map((m) => {
      const el = document.createElement("div");
      el.textContent = m.label;
      el.style.cssText =
        "width:26px;height:26px;border-radius:50%;background:#2563eb;color:#fff;" +
        "display:flex;align-items:center;justify-content:center;" +
        "font:600 13px sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)";
      return new tt.Marker({ element: el })
        .setLngLat([m.position.lng, m.position.lat])
        .addTo(map);
    });

    if (map.getLayer("plan-route")) map.removeLayer("plan-route");
    if (map.getSource("plan-route")) map.removeSource("plan-route");
    if (route && route.points.length >= 2) {
      map.addSource("plan-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: route.points.map((p) => [p.lng, p.lat]),
          },
        },
      });
      map.addLayer({
        id: "plan-route",
        type: "line",
        source: "plan-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#e2574c", "line-width": 4 },
      });
    }

    if (markers.length > 0) {
      const lats = markers.map((m) => m.position.lat);
      const lngs = markers.map((m) => m.position.lng);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 14, duration: 300 }
      );
    }
  }, [markers, route, ready]);

  if (!MAP_KEY) {
    return (
      <section
        aria-label="Route map"
        className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 p-6 text-center shadow-sm"
        style={{ height: HEIGHT }}
      >
        <p className="text-sm font-semibold text-ink-2">
          The route map appears here once the TomTom map key is configured.
        </p>
        <p className="max-w-[46ch] text-xs text-ink-3">
          Set NEXT_PUBLIC_TOMTOM_MAP_KEY. Assigning and sequencing jobs works without it.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Route map" className="relative overflow-hidden rounded-lg border border-line shadow-sm">
      <div ref={containerRef} style={{ height: HEIGHT }} />
      {notice ? (
        <p className="absolute bottom-2 left-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 shadow-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If the SDK ships no types and TS complains about the import, add `// @ts-expect-error TomTom SDK has no bundled types` above the dynamic import line only (do not add a global .d.ts for one import site).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app/planning/PlanningMap.tsx
git commit -m "feat: TomTom planning map with placeholder mode"
```

---

### Task 11: Board components

**Files:**
- Create: `app/planning/PlanJobCard.tsx`
- Create: `app/planning/VehicleLane.tsx`
- Create: `app/planning/UnassignedPool.tsx`

Drag and drop is native HTML5: a card writes its job id into `dataTransfer` on dragstart; lanes and the pool are drop targets. Dropping ON a card inserts BEFORE that card (identified by job id, not index, so no off-by-one when a card moves within its own lane); dropping on a lane's trailing zone appends; dropping on the pool unassigns.

- [ ] **Step 1: Write the job card**

Create `app/planning/PlanJobCard.tsx`:

```tsx
"use client";

import type { DragEvent } from "react";
import { isRoutable, sortedStops } from "../../lib/planning/waypoints";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  job: PlanJob;
  /** 1-based position in its lane; null in the unassigned pool. */
  sequence: number | null;
  /** True once geocoding has been attempted, so the badge means "failed",
      never "still loading". */
  geocodeSettled: boolean;
  onDropBefore?: (draggedJobId: string) => void;
};

export const JOB_ID_MIME = "text/plain";

export default function PlanJobCard({ job, sequence, geocodeSettled, onDropBefore }: Props) {
  const stops = sortedStops(job);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const placeSummary =
    stops.length === 0
      ? "No stops"
      : `${stops.length} ${stops.length === 1 ? "stop" : "stops"} · ${first.city ?? first.postcode ?? "?"}${
          stops.length > 1 ? ` → ${last.city ?? last.postcode ?? "?"}` : ""
        }`;
  const warn = geocodeSettled && !isRoutable(job);

  function handleDragStart(e: DragEvent) {
    e.dataTransfer.setData(JOB_ID_MIME, job.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent) {
    if (onDropBefore) e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    if (!onDropBefore) return;
    e.preventDefault();
    e.stopPropagation(); // the lane's own drop handler would otherwise append
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId && draggedId !== job.id) onDropBefore(draggedId);
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="cursor-grab rounded-md border border-line bg-surface px-2.5 py-2 text-sm shadow-sm active:cursor-grabbing"
    >
      <p className="font-semibold text-ink">
        {sequence !== null ? `${sequence} · ` : ""}
        {job.reference ?? "No reference"}
        {warn ? (
          <span
            className="ml-1.5 rounded border border-line px-1 text-xs font-normal text-warning"
            title="One or more stops could not be geocoded; this job is excluded from the route."
          >
            no map fix
          </span>
        ) : null}
      </p>
      <p className="text-xs text-ink-3">
        {job.customer_name ?? "No customer"} · {placeSummary}
      </p>
    </div>
  );
}
```

(`text-warning` is a real token: `tailwind.config.ts:93` maps `warning` to `var(--warning)`.)

- [ ] **Step 2: Write the vehicle lane**

Create `app/planning/VehicleLane.tsx`:

```tsx
"use client";

import type { DragEvent } from "react";
import PlanJobCard, { JOB_ID_MIME } from "./PlanJobCard";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  vehicle: { id: string; registration: string };
  jobs: PlanJob[];
  driverId: string | null;
  drivers: { id: string; name: string }[];
  selected: boolean;
  /** e.g. "3 jobs · 92 km · 2 h 41 m", or null before this lane has a route. */
  summary: string | null;
  geocodeSettled: boolean;
  onSelect: () => void;
  onDriverChange: (driverId: string | null) => void;
  /** beforeJobId null means append to the end of the lane. */
  onDropJob: (draggedJobId: string, beforeJobId: string | null) => void;
};

export default function VehicleLane({
  vehicle, jobs, driverId, drivers, selected, summary, geocodeSettled,
  onSelect, onDriverChange, onDropJob,
}: Props) {
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId) onDropJob(draggedId, null);
  }

  return (
    <section
      aria-label={`Route for ${vehicle.registration}`}
      onClick={onSelect}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-surface" : "border-line bg-surface-2 hover:bg-surface"
      }`}
    >
      <header className="mb-2 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">{vehicle.registration}</h3>
        <select
          aria-label={`Driver for ${vehicle.registration}`}
          value={driverId ?? ""}
          onChange={(e) => onDriverChange(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink"
        >
          <option value="">No driver</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-3">
          {summary ?? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
        </span>
      </header>

      <div className="flex flex-wrap items-stretch gap-2">
        {jobs.map((job, index) => (
          <PlanJobCard
            key={job.id}
            job={job}
            sequence={index + 1}
            geocodeSettled={geocodeSettled}
            onDropBefore={(draggedId) => onDropJob(draggedId, job.id)}
          />
        ))}
        <div
          className="flex min-h-[52px] min-w-[110px] items-center justify-center rounded-md border border-dashed border-line px-2 text-xs text-ink-3"
          aria-hidden
        >
          drop a job here
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Write the unassigned pool**

Create `app/planning/UnassignedPool.tsx`:

```tsx
"use client";

import type { DragEvent } from "react";
import PlanJobCard, { JOB_ID_MIME } from "./PlanJobCard";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  jobs: PlanJob[];
  subcontracted: PlanJob[];
  geocodeSettled: boolean;
  onDropJob: (draggedJobId: string) => void;
};

export default function UnassignedPool({ jobs, subcontracted, geocodeSettled, onDropJob }: Props) {
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId) onDropJob(draggedId);
  }

  return (
    <section
      aria-label="Unassigned jobs"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex w-[240px] flex-none flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3"
    >
      <h3 className="text-sm font-semibold text-ink">Unassigned · {jobs.length}</h3>
      {jobs.length === 0 ? (
        <p className="text-xs text-ink-3">Every job for this date is assigned.</p>
      ) : (
        jobs.map((job) => (
          <PlanJobCard key={job.id} job={job} sequence={null} geocodeSettled={geocodeSettled} />
        ))
      )}

      {subcontracted.length > 0 ? (
        <>
          <h3 className="mt-2 text-sm font-semibold text-ink">
            Subcontracted · {subcontracted.length}
          </h3>
          {/* Read-only: visible so the day's full picture is here, but routed
              by the subcontractor, not by this operator's fleet. */}
          {subcontracted.map((job) => (
            <div key={job.id} className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm opacity-70">
              <p className="font-semibold text-ink">{job.reference ?? "No reference"}</p>
              <p className="text-xs text-ink-3">{job.customer_name ?? "No customer"}</p>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/planning/PlanJobCard.tsx app/planning/VehicleLane.tsx app/planning/UnassignedPool.tsx
git commit -m "feat: planning board components with native drag and drop"
```

---

### Task 12: The page

**Files:**
- Modify: `app/planning/page.tsx` (replace the Task 2 stub wholesale)

State model: `laneOrders` maps vehicle id to ordered job ids and `laneDrivers` maps vehicle id to a driver id; both initialize from the loaded jobs (grouped by `vehicle_id`, ordered by `route_order` with nulls last). The unassigned pool is derived: fleet jobs in no lane. Dirty state is derived by running `computeSaveDiff` against the loaded jobs, so the Save button and the indicator can never disagree with what Save would write.

- [ ] **Step 1: Write the page**

Replace `app/planning/page.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Button from "../../components/Button";
import PlanningMap, { type MapMarker } from "./PlanningMap";
import UnassignedPool from "./UnassignedPool";
import VehicleLane from "./VehicleLane";
import { stopsNeedingGeocode } from "../../lib/planning/geocoding";
import { computeSaveDiff, type LanePlan } from "../../lib/planning/saveDiff";
import { formatDistance, formatDuration } from "../../lib/planning/format";
import {
  isRoutable, jobRepresentativePoint, laneWaypoints,
} from "../../lib/planning/waypoints";
import { bestOrder } from "../../lib/planning/optimize";
import type { PlanJob, RouteResult } from "../../lib/planning/types";
import { operatorDay } from "../../lib/time";

/* Same embedded-relation normalisation as /tracking: Supabase returns an
   embedded relation as an object or a one-element array depending on how it
   infers the relationship, and both shapes have appeared in this codebase. */
function rel(value: any): any {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type Vehicle = { id: string; registration: string };
type Driver = { id: string; name: string };

export default function PlanningPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [date, setDate] = useState(() => operatorDay(new Date()));
  const [jobs, setJobs] = useState<PlanJob[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [laneOrders, setLaneOrders] = useState<Record<string, string[]>>({});
  const [laneDrivers, setLaneDrivers] = useState<Record<string, string | null>>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteResult>>({});
  const [geocodeSettled, setGeocodeSettled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [message, setMessage] = useState("");
  const [mapNotice, setMapNotice] = useState<string | null>(null);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const fleetJobs = useMemo(() => jobs.filter((j) => !j.subcontractor_id), [jobs]);
  const subcontracted = useMemo(() => jobs.filter((j) => j.subcontractor_id), [jobs]);

  const assignedIds = useMemo(
    () => new Set(Object.values(laneOrders).flat()),
    [laneOrders]
  );
  const unassigned = useMemo(
    () => fleetJobs.filter((j) => !assignedIds.has(j.id)),
    [fleetJobs, assignedIds]
  );

  const lanePlans: LanePlan[] = useMemo(
    () =>
      vehicles.map((v) => ({
        vehicleId: v.id,
        driverId: laneDrivers[v.id] ?? null,
        jobIds: laneOrders[v.id] ?? [],
      })),
    [vehicles, laneOrders, laneDrivers]
  );
  const pendingUpdates = useMemo(
    () => computeSaveDiff(jobs, lanePlans, unassigned.map((j) => j.id)),
    [jobs, lanePlans, unassigned]
  );
  const dirty = pendingUpdates.length > 0;

  async function loadData() {
    setLoading(true);
    setMessage("");
    setGeocodeSettled(false);
    setRoutes({});

    const jobsQuery = supabase
      .from("jobs")
      .select(`
        id, reference, status, scheduled_date, vehicle_id, driver_id,
        subcontractor_id, route_order,
        customers ( name ),
        job_stops ( id, stop_order, type, address_line, city, postcode, lat, lng )
      `)
      .eq("scheduled_date", date);

    const { data: jobsData, error: jobsError } = await tenant
      .filterByTenant(jobsQuery)
      .order("created_at", { ascending: true });
    const { data: vehicleData, error: vehicleError } = await tenant
      .filterByTenant(supabase.from("vehicles").select("id, registration"))
      .eq("active", true)
      .order("registration", { ascending: true });
    const { data: driverData, error: driverError } = await tenant
      .filterByTenant(supabase.from("drivers").select("id, name"))
      .eq("active", true)
      .order("name", { ascending: true });

    if (jobsError) { setMessage(`Jobs load error: ${jobsError.message}`); setLoading(false); return; }
    if (vehicleError) { setMessage(`Vehicles load error: ${vehicleError.message}`); setLoading(false); return; }
    if (driverError) { setMessage(`Drivers load error: ${driverError.message}`); setLoading(false); return; }

    const loaded: PlanJob[] = (jobsData ?? []).map((row: any) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      vehicle_id: row.vehicle_id,
      driver_id: row.driver_id,
      subcontractor_id: row.subcontractor_id,
      route_order: row.route_order,
      customer_name: rel(row.customers)?.name ?? null,
      stops: (row.job_stops ?? []).map((s: any) => ({
        id: s.id, stop_order: s.stop_order, type: s.type,
        address_line: s.address_line, city: s.city, postcode: s.postcode,
        lat: s.lat, lng: s.lng,
      })),
    }));

    // Lanes from the saved plan: group by vehicle, order by route_order with
    // unsequenced jobs after, in load order. Lane drivers come from the first
    // job that names one, so a saved plan round-trips exactly.
    const orders: Record<string, string[]> = {};
    const laneDriverInit: Record<string, string | null> = {};
    const grouped = loaded
      .filter((j) => j.vehicle_id && !j.subcontractor_id)
      .sort((a, b) => (a.route_order ?? 1e9) - (b.route_order ?? 1e9));
    for (const job of grouped) {
      const vid = job.vehicle_id as string;
      (orders[vid] ??= []).push(job.id);
      if (laneDriverInit[vid] === undefined && job.driver_id) laneDriverInit[vid] = job.driver_id;
    }

    setJobs(loaded);
    setVehicles(vehicleData ?? []);
    setDrivers(driverData ?? []);
    setLaneOrders(orders);
    setLaneDrivers(laneDriverInit);
    setSelectedVehicleId(
      (vehicleData ?? []).find((v: Vehicle) => (orders[v.id] ?? []).length > 0)?.id ??
        (vehicleData ?? [])[0]?.id ?? null
    );
    setLoading(false);

    // Geocode cache misses, then merge results into state. Failures leave
    // lat/lng null; geocodeSettled turns the null into a "no map fix" badge.
    const missing = stopsNeedingGeocode(loaded);
    if (missing.length === 0) { setGeocodeSettled(true); return; }
    try {
      const response = await fetch("/api/tomtom/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopIds: missing }),
      });
      if (response.ok) {
        const { geocoded } = await response.json();
        const byStop = new Map<string, { lat: number; lng: number }>(
          (geocoded ?? []).map((g: any) => [g.id, { lat: g.lat, lng: g.lng }])
        );
        setJobs((prev) =>
          prev.map((job) => ({
            ...job,
            stops: job.stops.map((s) => {
              const hit = byStop.get(s.id);
              return hit ? { ...s, lat: hit.lat, lng: hit.lng } : s;
            }),
          }))
        );
      }
    } catch {
      // Board-only mode: badges explain themselves once settled.
    }
    setGeocodeSettled(true);
  }

  useEffect(() => {
    if (tenant.status !== "ready") return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId, date]);

  // Route for the selected vehicle, refetched when its lane content changes.
  const selectedLaneJobs = useMemo(() => {
    if (!selectedVehicleId) return [];
    return (laneOrders[selectedVehicleId] ?? [])
      .map((id) => jobById.get(id))
      .filter((j): j is PlanJob => Boolean(j));
  }, [selectedVehicleId, laneOrders, jobById]);

  useEffect(() => {
    if (!selectedVehicleId || !geocodeSettled) return;
    const points = laneWaypoints(selectedLaneJobs);
    if (points.length < 2) {
      setRoutes((prev) => {
        const next = { ...prev };
        delete next[selectedVehicleId];
        return next;
      });
      setMapNotice(
        selectedLaneJobs.length > 0 && points.length < 2
          ? "Not enough mappable stops to draw a route."
          : null
      );
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/tomtom/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points }),
        });
        if (cancelled) return;
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setMapNotice(body?.error ?? "Route calculation failed.");
          return;
        }
        const route: RouteResult = await response.json();
        setRoutes((prev) => ({ ...prev, [selectedVehicleId]: route }));
        setMapNotice(null);
      } catch {
        if (!cancelled) setMapNotice("Route calculation failed.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, selectedLaneJobs, geocodeSettled]);

  function moveJob(jobId: string, vehicleId: string | null, beforeJobId: string | null) {
    const job = jobById.get(jobId);
    if (!job || job.subcontractor_id) return;
    setLaneOrders((prev) => {
      const next: Record<string, string[]> = {};
      for (const [vid, ids] of Object.entries(prev)) next[vid] = ids.filter((id) => id !== jobId);
      if (vehicleId) {
        const lane = next[vehicleId] ?? [];
        const at = beforeJobId ? lane.indexOf(beforeJobId) : -1;
        if (at === -1) lane.push(jobId);
        else lane.splice(at, 0, jobId);
        next[vehicleId] = lane;
      }
      return next;
    });
  }

  async function savePlan() {
    if (saving || pendingUpdates.length === 0) return;
    setSaving(true);
    setMessage("");
    for (const u of pendingUpdates) {
      const { error } = await supabase
        .from("jobs")
        .update({ vehicle_id: u.vehicle_id, driver_id: u.driver_id, route_order: u.route_order })
        .eq("id", u.id);
      if (error) {
        setMessage(`Save error: ${error.message}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    await loadData();
  }

  async function optimize() {
    if (optimizing || !selectedVehicleId) return;
    const routable = selectedLaneJobs.filter(isRoutable);
    if (routable.length < 2) {
      setMessage("Optimize needs at least two mappable jobs in the selected lane.");
      return;
    }
    setOptimizing(true);
    setMessage("");
    try {
      const points = routable.map((j) => jobRepresentativePoint(j));
      const response = await fetch("/api/tomtom/matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(body?.error ?? "Optimize failed.");
        return;
      }
      const { travelSeconds } = await response.json();
      const order = bestOrder(travelSeconds);
      const reordered = order
        .map((i) => routable[i].id)
        .concat(selectedLaneJobs.filter((j) => !isRoutable(j)).map((j) => j.id));
      setLaneOrders((prev) => ({ ...prev, [selectedVehicleId]: reordered }));
    } catch {
      setMessage("Optimize failed.");
    } finally {
      setOptimizing(false);
    }
  }

  const selectedRoute = selectedVehicleId ? (routes[selectedVehicleId] ?? null) : null;
  const markers: MapMarker[] = selectedLaneJobs
    .filter(isRoutable)
    .map((job, index) => ({
      position: jobRepresentativePoint(job) as { lat: number; lng: number },
      label: String(index + 1),
    }));

  function laneSummary(vehicleId: string): string | null {
    const route = routes[vehicleId];
    const count = (laneOrders[vehicleId] ?? []).length;
    if (!route) return null;
    return `${count} ${count === 1 ? "job" : "jobs"} · ${formatDistance(route.totalDistanceMeters)} · ${formatDuration(route.totalTravelTimeSeconds)}`;
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <div className="flex flex-col gap-4 p-6">
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">Planning</h1>
            <input
              type="date"
              aria-label="Plan date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            />
            {selectedRoute ? (
              <span className="text-sm text-ink-2">
                {formatDistance(selectedRoute.totalDistanceMeters)} · {formatDuration(selectedRoute.totalTravelTimeSeconds)}
              </span>
            ) : null}
            {dirty ? <span className="text-xs text-ink-3">Unsaved changes</span> : null}
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={optimize} loading={optimizing}>
                Optimize order
              </Button>
              <Button size="sm" onClick={savePlan} loading={saving} disabled={!dirty}>
                Save plan
              </Button>
            </span>
          </header>

          {message ? <p className="text-sm text-danger">{message}</p> : null}

          <PlanningMap markers={markers} route={selectedRoute} notice={mapNotice} />

          {loading ? (
            <p className="text-sm text-ink-3">Loading the day's jobs...</p>
          ) : (
            <div className="flex items-start gap-4">
              <UnassignedPool
                jobs={unassigned}
                subcontracted={subcontracted}
                geocodeSettled={geocodeSettled}
                onDropJob={(jobId) => moveJob(jobId, null, null)}
              />
              <div className="flex flex-1 flex-col gap-3">
                {vehicles.length === 0 ? (
                  <p className="text-sm text-ink-3">No active vehicles. Add one under Fleet.</p>
                ) : (
                  vehicles.map((v) => (
                    <VehicleLane
                      key={v.id}
                      vehicle={v}
                      jobs={(laneOrders[v.id] ?? [])
                        .map((id) => jobById.get(id))
                        .filter((j): j is PlanJob => Boolean(j))}
                      driverId={laneDrivers[v.id] ?? null}
                      drivers={drivers}
                      selected={v.id === selectedVehicleId}
                      summary={laneSummary(v.id)}
                      geocodeSettled={geocodeSettled}
                      onSelect={() => setSelectedVehicleId(v.id)}
                      onDriverChange={(driverId) =>
                        setLaneDrivers((prev) => ({ ...prev, [v.id]: driverId }))
                      }
                      onDropJob={(jobId, beforeJobId) => moveJob(jobId, v.id, beforeJobId)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </TenantGate>
  );
}
```

(`"ready"` is a real status: `lib/tenant/context.ts:2` defines `TenantStatus = "loading" | "ready" | "signed-out" | "no-tenant"`.)

- [ ] **Step 2: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: both exit 0; all planning and tomtom suites pass.

- [ ] **Step 3: Commit**

```bash
git add app/planning/page.tsx
git commit -m "feat: planning page with lanes, geocoding, routing and optimize"
```

---

### Task 13: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: exit 0, no failures anywhere (not just the new suites).

- [ ] **Step 2: Manual pass (works without TomTom keys)**

Reminder before touching anything: `.env.local` points at the LIVE Supabase project. Use clearly-marked test data (reference like `PLAN-TEST-1`) and delete it afterwards.

1. `npm run dev`, sign in (scripts/dev-login.mjs is the local path around magic links).
2. "Planning" appears in the sidebar above Jobs, with an icon, and highlights when active.
3. Create two jobs on `/jobs` for today with real UK addresses, unassigned.
4. `/planning`: both jobs sit in the Unassigned pool; the map area shows the key-missing placeholder (no keys yet) and the board still works.
5. Drag both into a vehicle lane, reorder them, pick a driver: "Unsaved changes" appears; Save plan; reload the page: the lane round-trips exactly.
6. In Supabase: the two `jobs` rows have `vehicle_id`, `driver_id`, `route_order` 1 and 2.
7. Drag one job back to the pool, Save, verify its three columns are null again.

- [ ] **Step 3: Manual pass (with TomTom keys, once the premium key arrives)**

1. Add `TOMTOM_API_KEY` and `NEXT_PUBLIC_TOMTOM_MAP_KEY` to `.env.local`, restart dev.
2. Load `/planning`: stops geocode (check `job_stops.lat/lng/geocoded_at` fill in), map shows tiles, numbered markers and a route polyline, top bar shows distance and time.
3. Reload: no new geocode calls for the same stops (network tab: `/api/tomtom/geocode` is not called, or called with an empty result).
4. Add a job with a garbage address ("zzzzz, nowhere"): it gets the "no map fix" badge, stays draggable, route still draws for the others.
5. Three or more jobs in one lane, deliberately badly ordered: Optimize reorders them and the route updates; the change shows as unsaved until Save.
6. Signed-out check: `curl -X POST localhost:3000/api/tomtom/route -H "Content-Type: application/json" -d '{"points":[{"lat":53,"lng":-1},{"lat":54,"lng":-1}]}'` returns 401.
7. Delete the test jobs.

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR/cleanup.
```
