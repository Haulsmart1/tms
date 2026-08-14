# Tracking Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/tracking` as a design-system console page: a job-first queue rail beside a stacked detail column of header, map, journey and activity cards, with every GPS-dependent element degrading honestly because no position feed exists yet.

**Architecture:** All deciding lives in pure, tested modules under `lib/tracking/`. `app/tracking/page.tsx` owns only the Supabase query, the poll and selection state. Components are presentational. TomTom is prepared for behind one `PositionSource` interface, with no network call in this change.

**Tech Stack:** Next.js App Router, React client components, Supabase JS, Tailwind with `var()`-backed tokens, Vitest (node env, `lib/**/*.test.ts` only), Playwright for the local layout regression check.

**Spec:** `docs/superpowers/specs/2026-08-14-tracking-console-design.md`

**Branch:** `ethan/tracking-console` (already created)

---

## Before you start: five things about this codebase

1. **`:root` is DARK.** `app/tokens.css` inverts the usual convention on purpose. Never write a Tailwind `dark:` variant. Theme differences belong in token values. Read the header comment in `app/tokens.css` if tempted.
2. **Preflight is OFF.** A component renders correctly only inside a `class="ds"` wrapper, which supplies `border-style: solid` and box-sizing. Omit `ds` and borders vanish and containers overflow. Omit `font-sans` and you silently get Inter.
3. **Opacity modifiers compile to nothing.** `bg-primary/10` and `text-ink/60` emit no CSS, silently, because the token colours are plain `var()` strings. Use a `-tint` token instead.
4. **The `—` glyph is an approved UI fallback.** `lib/pod/queue.ts` uses it deliberately for narrow mono columns and explains why. Use it the same way in cells. Do not use em-dashes in prose, comments or commit messages.
5. **Vitest only sees `lib/**/*.test.ts`**, in the `node` environment. There is no component test runner. Components are verified by `npm run typecheck`, by running the app, and by the Playwright layout spec in Task 14.

## Three refinements to the spec, made while planning

Each preserves the approved contract. Flagged here so review can catch them.

1. **The position seam is split across two files, not one.** `lib/tracking/position.ts` holds the types and the pure staleness helpers so Vitest can cover them. `lib/tracking/supabasePositions.ts` holds the Supabase adapter behind the same `PositionSource` interface. The seam is unchanged.
2. **The activity feed uses no extra tables and no extra query.** The spec listed `pod_records`, `pod_files` and `job_documents` as sources. Nothing in the app writes any of them, so they would contribute zero events. `job_stops.pod_updated_at` IS written by `/pod`, so the feed is built entirely from `jobs.created_at`, `job_stops.delivered_at` and `job_stops.pod_updated_at`, all already in the page's existing query.
3. **Timestamps are normalised before parsing.** `telematics_positions.recorded_at` is `timestamp without time zone`, so Supabase returns `"2026-08-14T09:41:00"` with no offset and `new Date()` reads it as local time. Task 1 adds a helper and a test for this.

## File structure

**Create, `lib/tracking/`:**

| File | Responsibility |
| --- | --- |
| `types.ts` | `TrackingJob` and `TrackingStop` row shapes. No logic. |
| `position.ts` | `PositionReading`, `PositionSource`, staleness, ping labels, timestamp normalisation. |
| `position.test.ts` | Tests for the above. |
| `supabasePositions.ts` | The adapter reading `telematics_positions` then `vehicle_locations`. |
| `onTheRoad.ts` | Rail predicate, phase derivation, sort, row shape. |
| `onTheRoad.test.ts` | Tests for the above. |
| `journey.ts` | Stop timeline nodes, route glyph adapter, date formatting. |
| `journey.test.ts` | Tests for the above. |
| `telemetry.ts` | The four header tiles. |
| `telemetry.test.ts` | Tests for the above. |
| `activity.ts` | Synthesised event list. |
| `activity.test.ts` | Tests for the above. |

**Create, `app/tracking/`:** `TrackingRail.tsx`, `TrackingHeader.tsx`, `TrackingMap.tsx`, `JourneyTimeline.tsx`, `ActivityFeed.tsx`.

**Modify:** `app/tracking/page.tsx` (full rewrite), `lib/nav/themeableRoutes.ts` (one line), `app/globals.css` (one components layer).

**Create:** `tests/tracking-layout.spec.mjs`.

**Do not touch:** `app/pod/*`, `lib/pod/*`, `components/RouteProgress.tsx`.

---

### Task 1: Position primitives and staleness

**Files:**
- Create: `lib/tracking/types.ts`
- Create: `lib/tracking/position.ts`
- Test: `lib/tracking/position.test.ts`

- [ ] **Step 1: Write the row types**

Create `lib/tracking/types.ts`:

```ts
/* Row shapes for the Tracking console, mirroring the columns app/tracking/page.tsx
   selects. Kept separate from the logic modules so onTheRoad, journey and
   activity can all import them without importing each other. */

export type TrackingStop = {
  id: string;
  stop_order: number;
  type: string | null;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  /* NOT a real planned time. app/jobs/page.tsx writes it as
     `${scheduled_date}T08:00:00`, so it is accurate to the day and not the
     hour. See lib/pod/overdue.ts, which says the same thing about the same
     column. Render it as a date, never as a time. */
  planned_at: string | null;
  delivered_at: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  pod_updated_at: string | null;
  pod_photo_url: string | null;
  pod_document_url: string | null;
};

export type TrackingJob = {
  id: string;
  reference: string | null;
  status: string | null;
  /** A `date` column, so "YYYY-MM-DD" with no time and no zone. */
  scheduled_date: string | null;
  created_at: string | null;
  customer_name: string | null;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  subcontractor_id: string | null;
  stops: TrackingStop[];
};
```

- [ ] **Step 2: Write the failing test**

Create `lib/tracking/position.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normaliseTimestamp,
  readingAgeMinutes,
  signalState,
  isLive,
  pingLabel,
  STALE_AFTER_MINUTES,
  type PositionReading,
} from "./position";

const NOW = new Date("2026-08-14T12:00:00Z");

function reading(recordedAt: string): PositionReading {
  return { vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 80, headingDeg: null, recordedAt };
}

describe("normaliseTimestamp", () => {
  it("appends Z to a naive stamp, because the column is stored in UTC", () => {
    // telematics_positions.recorded_at is `timestamp without time zone`, so
    // Supabase returns no offset and new Date() would read it as local time.
    expect(normaliseTimestamp("2026-08-14T09:41:00")).toBe("2026-08-14T09:41:00Z");
  });

  it("leaves a stamp that already carries Z alone", () => {
    expect(normaliseTimestamp("2026-08-14T09:41:00Z")).toBe("2026-08-14T09:41:00Z");
  });

  it("leaves a stamp that already carries a numeric offset alone", () => {
    expect(normaliseTimestamp("2026-08-14T09:41:00+01:00")).toBe("2026-08-14T09:41:00+01:00");
  });

  it("leaves a stamp with a two-digit offset and no minutes alone", () => {
    // Postgres emits +01 rather than +01:00 when the offset has zero minutes.
    expect(normaliseTimestamp("2026-08-14T09:41:00+01")).toBe("2026-08-14T09:41:00+01");
  });

  it("leaves a stamp with a negative two-digit offset alone", () => {
    expect(normaliseTimestamp("2026-08-14T09:41:00-05")).toBe("2026-08-14T09:41:00-05");
  });
});

describe("readingAgeMinutes", () => {
  it("returns elapsed minutes", () => {
    expect(readingAgeMinutes(reading("2026-08-14T11:45:00Z"), NOW)).toBeCloseTo(15, 5);
  });

  it("parses a naive stamp as UTC rather than local", () => {
    expect(readingAgeMinutes(reading("2026-08-14T11:45:00"), NOW)).toBeCloseTo(15, 5);
  });

  it("returns null for an unparseable stamp rather than NaN", () => {
    expect(readingAgeMinutes(reading("not-a-date"), NOW)).toBeNull();
  });
});

describe("signalState", () => {
  it("is none with no reading at all", () => {
    expect(signalState(null, NOW)).toBe("none");
  });

  it("is live under the threshold", () => {
    expect(signalState(reading("2026-08-14T11:55:00Z"), NOW)).toBe("live");
  });

  it("is live at exactly the threshold, so the boundary is not double-counted", () => {
    // Matches isPodOverdue in lib/pod/overdue.ts, which is also false at
    // exactly its threshold. One convention across the codebase.
    expect(signalState(reading("2026-08-14T11:50:00Z"), NOW)).toBe("live");
  });

  it("is stale past the threshold", () => {
    expect(signalState(reading("2026-08-14T11:49:00Z"), NOW)).toBe("stale");
  });

  it("is none for an unparseable stamp, because an unreadable fix is not a fix", () => {
    expect(signalState(reading("not-a-date"), NOW)).toBe("none");
  });

  it("is stale when the reading is far enough in the future to be a broken clock", () => {
    // 5 minutes ahead exceeds FUTURE_TOLERANCE_MINUTES. Reporting "live" here
    // would pin a green pill to a vehicle that may not have reported in days.
    expect(signalState(reading("2026-08-14T12:05:00Z"), NOW)).toBe("stale");
  });
});

describe("isLive", () => {
  it("is true only for a live reading", () => {
    expect(isLive(reading("2026-08-14T11:55:00Z"), NOW)).toBe(true);
    expect(isLive(reading("2026-08-14T09:00:00Z"), NOW)).toBe(false);
    expect(isLive(null, NOW)).toBe(false);
  });
});

describe("pingLabel", () => {
  it("says No GPS when there is no reading", () => {
    expect(pingLabel(null, NOW)).toBe("No GPS");
  });

  it("says just now under a minute", () => {
    expect(pingLabel(reading("2026-08-14T11:59:30Z"), NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(pingLabel(reading("2026-08-14T11:45:00Z"), NOW)).toBe("15 min ago");
    expect(pingLabel(reading("2026-08-14T09:00:00Z"), NOW)).toBe("3 h ago");
    expect(pingLabel(reading("2026-08-12T12:00:00Z"), NOW)).toBe("2 d ago");
  });

  it("reads 1 h ago at exactly 60 minutes", () => {
    expect(pingLabel(reading("2026-08-14T11:00:00Z"), NOW)).toBe("1 h ago");
  });

  it("reads 1 d ago at exactly 1440 minutes", () => {
    expect(pingLabel(reading("2026-08-13T12:00:00Z"), NOW)).toBe("1 d ago");
  });

  it("says clock ahead when the reading is far enough in the future to be a broken clock", () => {
    expect(pingLabel(reading("2026-08-14T12:05:00Z"), NOW)).toBe("clock ahead");
  });
});

describe("STALE_AFTER_MINUTES", () => {
  it("is 10", () => {
    expect(STALE_AFTER_MINUTES).toBe(10);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/tracking/position.test.ts`
Expected: FAIL, with a module resolution error for `./position`.

- [ ] **Step 4: Write the implementation**

Create `lib/tracking/position.ts`:

```ts
/* THE ENTIRE TOMTOM SURFACE.

   Every GPS-dependent thing on /tracking reads a PositionReading and nothing
   else. Today the only implementation of PositionSource is the Supabase
   adapter in ./supabasePositions.ts, which finds no rows because nothing in
   this repo writes a position table. A TomTom adapter later implements the
   same interface and no component changes.

   Staleness is deliberately a first-class state rather than a detail. The
   design mockup renders a pulsing green "Live GPS" pill, and showing that over
   a three-hour-old fix is the page lying to a dispatcher. */

export type PositionReading = {
  vehicleId: string;
  lat: number;
  lng: number;
  speedKph: number;
  headingDeg: number | null;
  /** As the source returned it, so it MAY be naive. Never pass this to new Date()
      directly: go through readingAgeMinutes, or normalise it first. */
  recordedAt: string;
};

export type PositionSource = {
  getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>>;
};

export type SignalState = "none" | "stale" | "live";

/** Minutes after which a reading is stale rather than live. */
export const STALE_AFTER_MINUTES = 10;

/* A fix a few seconds in the future is clock drift and still counts as live. A
   fix hours ahead is a broken device clock, and calling that live would pin a
   green pill to a vehicle that may not have reported in days. lib/pod/queue.ts
   made the same call about negative POD ages for the same reason. */
export const FUTURE_TOLERANCE_MINUTES = 2;

/* telematics_positions.recorded_at is `timestamp without time zone`, so
   Supabase returns "2026-08-14T09:41:00" with no offset and new Date() reads
   it as LOCAL time. The rows are assumed to be stored in UTC. Nothing in this
   repo writes this table, so that is unverified until a real feed lands. If
   the feed turns out to write local time, fixes read one hour old in summer
   rather than falsely live, which is the safe direction to be wrong in.
   vehicle_locations.recorded_at IS timezone-aware and already carries an
   offset, which this leaves untouched. */
export function normaliseTimestamp(raw: string): string {
  return /([Zz]|[+-]\d{2}(:?\d{2})?)$/.test(raw) ? raw : `${raw}Z`;
}

export function readingAgeMinutes(reading: PositionReading, now: Date): number | null {
  const t = new Date(normaliseTimestamp(reading.recordedAt)).getTime();
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 60000;
}

export function signalState(reading: PositionReading | null, now: Date): SignalState {
  if (!reading) return "none";
  const age = readingAgeMinutes(reading, now);
  // An unparseable stamp is not a fix. Treating it as live would put a green
  // pulsing pill over a reading we cannot date.
  if (age === null) return "none";
  // A reading far enough in the future to exceed clock drift tolerance is a
  // broken device clock, not a live fix. See FUTURE_TOLERANCE_MINUTES.
  if (age < -FUTURE_TOLERANCE_MINUTES) return "stale";
  return age > STALE_AFTER_MINUTES ? "stale" : "live";
}

export function isLive(reading: PositionReading | null, now: Date): boolean {
  return signalState(reading, now) === "live";
}

export function pingLabel(reading: PositionReading | null, now: Date): string {
  const age = reading ? readingAgeMinutes(reading, now) : null;
  if (age === null) return "No GPS";
  // Beyond drift tolerance, a negative age is a broken device clock, not a
  // fix from the near future. Say so rather than claiming "just now" forever.
  if (age < -FUTURE_TOLERANCE_MINUTES) return "clock ahead";
  // A small negative age is clock drift. "just now" is the least wrong thing
  // to say about a fix from the near future.
  if (age < 1) return "just now";
  if (age < 60) return `${Math.floor(age)} min ago`;
  if (age < 1440) return `${Math.floor(age / 60)} h ago`;
  return `${Math.floor(age / 1440)} d ago`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/tracking/position.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/tracking/types.ts lib/tracking/position.ts lib/tracking/position.test.ts
git commit -m "Add tracking position primitives and staleness model

Staleness is a first-class state because the mockup's pulsing Live GPS pill
over an hours-old fix would be the page lying to a dispatcher.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The Supabase position adapter

**Files:**
- Create: `lib/tracking/supabasePositions.ts`

No test file. This is thin I/O with no branching worth asserting in the node environment, and Vitest has no Supabase client to run it against. Its behaviour is verified by Task 12 rendering the page.

- [ ] **Step 1: Write the adapter**

Create `lib/tracking/supabasePositions.ts`:

```ts
import { normaliseTimestamp, type PositionReading, type PositionSource } from "./position";

/* The only implementation of PositionSource that exists today.

   It reads telematics_positions first because that table carries a heading
   column, then falls back to vehicle_locations, which does not. Both are
   read-only from this app's point of view: nothing in this repo writes either
   one, so in practice this returns an empty map and the page renders its
   no-signal state throughout. That is the expected outcome until a feed lands,
   not a bug.

   Both queries go through tenant.filterByTenant, exactly like every other
   query on the page. Do not bypass it. */

type TenantFilter = { filterByTenant: <T>(query: T) => T };

/* Rows per vehicle to pull before reducing to the newest. Supabase has no
   DISTINCT ON, so ordering by recorded_at desc and taking the first row per
   vehicle client-side is the cheap way to do this. Five gives headroom for a
   vehicle that reported several times in the window without fetching the
   unbounded history the old page fetched. */
const ROWS_PER_VEHICLE = 5;

function firstPerVehicle(
  rows: any[],
  vehicleKey: string,
  latKey: string,
  lngKey: string,
): Map<string, PositionReading> {
  const out = new Map<string, PositionReading>();
  // Rows arrive newest first, so the first row seen for a vehicle is its
  // newest and later rows for the same vehicle are skipped.
  for (const row of rows) {
    const id = row[vehicleKey];
    if (!id || out.has(id)) continue;
    out.set(id, {
      vehicleId: id,
      lat: Number(row[latKey]),
      lng: Number(row[lngKey]),
      speedKph: Number(row.speed ?? 0),
      headingDeg: row.heading == null ? null : Number(row.heading),
      recordedAt: normaliseTimestamp(String(row.recorded_at)),
    });
  }
  return out;
}

export function createSupabasePositionSource(
  supabase: any,
  tenant: TenantFilter,
): PositionSource {
  return {
    async getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>> {
      if (vehicleIds.length === 0) return new Map();
      const limit = vehicleIds.length * ROWS_PER_VEHICLE;

      const { data: telematics } = await tenant
        .filterByTenant(
          supabase
            .from("telematics_positions")
            .select("vehicle_id, latitude, longitude, speed, heading, recorded_at"),
        )
        .in("vehicle_id", vehicleIds)
        .order("recorded_at", { ascending: false })
        .limit(limit);

      if (telematics && telematics.length > 0) {
        return firstPerVehicle(telematics, "vehicle_id", "latitude", "longitude");
      }

      const { data: legacy } = await tenant
        .filterByTenant(
          supabase
            .from("vehicle_locations")
            .select("vehicle_id, latitude, longitude, speed, recorded_at"),
        )
        .in("vehicle_id", vehicleIds)
        .order("recorded_at", { ascending: false })
        .limit(limit);

      return firstPerVehicle(legacy ?? [], "vehicle_id", "latitude", "longitude");
    },
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors mentioning `lib/tracking/`.

- [ ] **Step 3: Commit**

```bash
git add lib/tracking/supabasePositions.ts
git commit -m "Add Supabase position source behind the tracking seam

Reads telematics_positions then falls back to vehicle_locations, both tenant
filtered. Bounded by vehicle count, unlike the old page which fetched every
vehicle_locations row ever recorded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The on-the-road predicate

**Files:**
- Create: `lib/tracking/onTheRoad.ts`
- Test: `lib/tracking/onTheRoad.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tracking/onTheRoad.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localDay, isOnTheRoad, jobPhase, buildRail, PHASE_LABEL, PHASE_TONE } from "./onTheRoad";
import type { TrackingJob, TrackingStop } from "./types";

const NOW = new Date("2026-08-14T12:00:00Z");
const TODAY = "2026-08-14";
const YESTERDAY = "2026-08-13";
const TOMORROW = "2026-08-15";

function stop(over: Partial<TrackingStop> = {}): TrackingStop {
  return {
    id: "s1", stop_order: 1, type: "delivery", address_line: "1 Dock Rd",
    city: "Hull", postcode: "HU3 4AB", planned_at: `${TODAY}T08:00:00Z`,
    delivered_at: null, pod_status: "pending", recipient_name: null,
    pod_updated_at: null, pod_photo_url: null, pod_document_url: null,
    ...over,
  };
}

function job(over: Partial<TrackingJob> = {}): TrackingJob {
  return {
    id: "j1", reference: "J-100", status: "planned", scheduled_date: TODAY,
    created_at: `${TODAY}T06:00:00Z`, customer_name: "Acme", vehicle_id: "v1",
    vehicle_registration: "YT19 KHR", driver_name: "A. Marsh",
    driver_phone: "07700900000", subcontractor_id: null,
    stops: [
      stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds", postcode: "LS10 1AA" }),
      stop(),
    ],
    ...over,
  };
}

describe("localDay", () => {
  it("formats the local calendar day, not the UTC one", () => {
    // A job scheduled for the 14th must still count as due at 23:30 local on
    // the 14th. Formatting via toISOString() would roll it to the 15th in any
    // zone ahead of UTC and quietly drop it from the rail.
    const d = new Date(2026, 7, 14, 23, 30);
    expect(localDay(d)).toBe("2026-08-14");
  });

  it("pads single-digit months and days", () => {
    expect(localDay(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05");
  });
});

describe("isOnTheRoad", () => {
  it("is true for an assigned, due, unfinished job", () => {
    expect(isOnTheRoad(job(), NOW)).toBe(true);
  });

  it("is true for an overdue job, which is the case that most needs showing", () => {
    expect(isOnTheRoad(job({ scheduled_date: YESTERDAY }), NOW)).toBe(true);
  });

  it("is false once the job is completed", () => {
    expect(isOnTheRoad(job({ status: "completed" }), NOW)).toBe(false);
  });

  it("is false with no vehicle assigned, because there is nothing to track", () => {
    expect(isOnTheRoad(job({ vehicle_id: null }), NOW)).toBe(false);
  });

  it("is false for a job scheduled in the future", () => {
    expect(isOnTheRoad(job({ scheduled_date: TOMORROW }), NOW)).toBe(false);
  });

  it("is false with no scheduled_date, which cannot be shown to be due", () => {
    expect(isOnTheRoad(job({ scheduled_date: null }), NOW)).toBe(false);
  });

  it("is false once every delivery stop is delivered", () => {
    const j = job();
    j.stops = j.stops.map((s) =>
      s.type === "delivery" ? { ...s, pod_status: "delivered" } : s,
    );
    expect(isOnTheRoad(j, NOW)).toBe(false);
  });

  it("is false for a job with no delivery stops at all", () => {
    // Mirrors the deliveryStops.length > 0 guard the POD completion cascade
    // applies in app/pod/page.tsx. A job with nothing to arrive at is not on
    // the road.
    expect(isOnTheRoad(job({ stops: [stop({ type: "collection" })] }), NOW)).toBe(false);
  });

  it("does NOT require the collection to be marked done", () => {
    // Nothing in the product prompts anyone to mark a collection: /pod only
    // ever surfaces delivery stops. Requiring it would leave the rail
    // permanently empty.
    expect(isOnTheRoad(job(), NOW)).toBe(true);
  });
});

describe("jobPhase", () => {
  it("is late when scheduled before today", () => {
    expect(jobPhase(job({ scheduled_date: YESTERDAY }), NOW)).toBe("late");
  });

  it("is due when scheduled today with nothing marked yet", () => {
    expect(jobPhase(job(), NOW)).toBe("due");
  });

  it("is in_progress when scheduled today and a stop is already delivered", () => {
    const j = job();
    j.stops[0] = { ...j.stops[0], pod_status: "delivered" };
    expect(jobPhase(j, NOW)).toBe("in_progress");
  });

  it("stays late even when a stop is already delivered, because late outranks progress", () => {
    const j = job({ scheduled_date: YESTERDAY });
    j.stops[0] = { ...j.stops[0], pod_status: "delivered" };
    expect(jobPhase(j, NOW)).toBe("late");
  });
});

describe("phase presentation", () => {
  it("labels every phase", () => {
    expect(PHASE_LABEL).toEqual({ late: "Late", in_progress: "In progress", due: "Due today" });
  });

  it("maps every phase to a Badge tone that exists in components/Badge.tsx", () => {
    expect(PHASE_TONE).toEqual({ late: "danger", in_progress: "info", due: "warning" });
  });
});

describe("buildRail", () => {
  it("drops jobs that are not on the road", () => {
    const rows = buildRail([job(), job({ id: "j2", status: "completed" })], NOW);
    expect(rows.map((r) => r.jobId)).toEqual(["j1"]);
  });

  it("puts late jobs first, then oldest scheduled date, then reference", () => {
    const rows = buildRail(
      [
        job({ id: "a", reference: "J-300", scheduled_date: TODAY }),
        job({ id: "b", reference: "J-100", scheduled_date: YESTERDAY }),
        job({ id: "c", reference: "J-200", scheduled_date: "2026-08-12" }),
        job({ id: "d", reference: "J-050", scheduled_date: TODAY }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.jobId)).toEqual(["c", "b", "d", "a"]);
  });

  it("carries the route towns", () => {
    const [row] = buildRail([job()], NOW);
    expect(row.originCity).toBe("Leeds");
    expect(row.destinationCity).toBe("Hull");
  });

  it("falls back rather than rendering blanks or the word null", () => {
    // A delivery-only job with no city still belongs in the rail. Every cell
    // must render something a dispatcher can read.
    const [row] = buildRail(
      [job({ reference: null, vehicle_registration: null, driver_name: null, stops: [stop({ city: null })] })],
      NOW,
    );
    expect(row.reference).toBe("—");
    expect(row.registration).toBe("—");
    expect(row.originCity).toBe("—");
    expect(row.destinationCity).toBe("—");
    expect(row.driverName).toBeNull(); // the component supplies "No driver assigned"
  });

  it("uses the LAST delivery stop as the destination on a multi-drop job", () => {
    const j = job({
      stops: [
        stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds" }),
        stop({ id: "s1", stop_order: 1, city: "York" }),
        stop({ id: "s2", stop_order: 2, city: "Hull" }),
      ],
    });
    expect(buildRail([j], NOW)[0].destinationCity).toBe("Hull");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tracking/onTheRoad.test.ts`
Expected: FAIL, module resolution error for `./onTheRoad`.

- [ ] **Step 3: Write the implementation**

Create `lib/tracking/onTheRoad.ts`:

```ts
import type { TrackingJob } from "./types";

/* THE SINGLE DEFINITION OF "ON THE ROAD".

   Nothing else in the app may redefine it, the same way lib/pod/overdue.ts
   owns "awaiting POD". If a second page ever needs this list, it imports from
   here rather than writing its own filter.

   The mockup this page is built from filters jobs on statuses called transit,
   loading and late. Those do not exist in this database. Real jobs.status is
   effectively binary: "planned" on create, "completed" once every delivery
   stop is signed off. job_stops.status is written as "planned" at insert and
   never updated by anything. So the rail is derived, and the phase below is
   deliberately coarser than the mockup's. Loading versus moving is a
   distinction only a live position can make. */

export type Phase = "late" | "in_progress" | "due";

export type RailRow = {
  jobId: string;
  reference: string;
  registration: string;
  driverName: string | null;
  originCity: string;
  destinationCity: string;
  scheduledDate: string | null;
  phase: Phase;
};

export const PHASE_LABEL: Record<Phase, string> = {
  late: "Late",
  in_progress: "In progress",
  due: "Due today",
};

/* Tones are the ones components/Badge.tsx actually defines. "info" is the
   primary-tinted tone; there is no tone called "primary". */
export const PHASE_TONE: Record<Phase, "danger" | "info" | "warning"> = {
  late: "danger",
  in_progress: "info",
  due: "warning",
};

/* jobs.scheduled_date is a `date` column, so it arrives as "YYYY-MM-DD" with
   no time and no zone. Comparing it against a UTC-formatted today would drop a
   job from the rail every evening in any zone ahead of UTC, so today is
   formatted from the LOCAL calendar day. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isOnTheRoad(job: TrackingJob, now: Date): boolean {
  if (job.status !== "planned") return false;
  if (!job.vehicle_id) return false;
  // A job with no date cannot be shown to be due. Treating undated jobs as due
  // would fill the rail with work nobody scheduled.
  if (!job.scheduled_date) return false;
  // Lexicographic comparison is correct for "YYYY-MM-DD".
  if (job.scheduled_date > localDay(now)) return false;

  const deliveries = job.stops.filter((s) => s.type === "delivery");
  if (deliveries.length === 0) return false;
  return deliveries.some((s) => s.pod_status !== "delivered");
}

export function jobPhase(job: TrackingJob, now: Date): Phase {
  // Late is checked first and outranks progress: a job running a day behind is
  // still the thing a dispatcher needs to see, however many stops it has done.
  if (job.scheduled_date && job.scheduled_date < localDay(now)) return "late";
  const anyDone = job.stops.some((s) => s.pod_status === "delivered");
  return anyDone ? "in_progress" : "due";
}

function toRailRow(job: TrackingJob, now: Date): RailRow {
  const ordered = [...job.stops].sort((a, b) => a.stop_order - b.stop_order);
  const collection = ordered.find((s) => s.type === "collection");
  // The LAST delivery, not the first: on a multi-drop job the destination is
  // where it finishes.
  const delivery = [...ordered].reverse().find((s) => s.type === "delivery");

  return {
    jobId: job.id,
    reference: job.reference ?? "—",
    registration: job.vehicle_registration ?? "—",
    driverName: job.driver_name,
    originCity: collection?.city ?? "—",
    destinationCity: delivery?.city ?? "—",
    scheduledDate: job.scheduled_date,
    phase: jobPhase(job, now),
  };
}

export function buildRail(jobs: TrackingJob[], now: Date): RailRow[] {
  const rows = jobs.filter((j) => isOnTheRoad(j, now)).map((j) => toRailRow(j, now));

  /* Late first, then oldest scheduled date, then reference. The reference
     tiebreak is load-bearing rather than cosmetic: without a total order the
     rail can reshuffle on every 30 second poll, which moves the row under the
     dispatcher's cursor. */
  rows.sort((a, b) => {
    const lateDiff = Number(b.phase === "late") - Number(a.phase === "late");
    if (lateDiff !== 0) return lateDiff;
    const dateDiff = (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "");
    if (dateDiff !== 0) return dateDiff;
    return a.reference.localeCompare(b.reference);
  });

  return rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tracking/onTheRoad.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/onTheRoad.ts lib/tracking/onTheRoad.test.ts
git commit -m "Add the on-the-road predicate and phase derivation

The mockup's transit/loading/late statuses do not exist in this database, so
the rail is derived from status, vehicle assignment, scheduled_date and stop
progress. Deliberately does not require a marked collection, since nothing in
the product prompts one and requiring it would leave the rail empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The journey timeline model

**Files:**
- Create: `lib/tracking/journey.ts`
- Test: `lib/tracking/journey.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tracking/journey.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildJourney, routeGlyph, arrowStateFor, type JourneyNode } from "./journey";
import type { PositionReading } from "./position";
import type { TrackingStop } from "./types";

const NOW = new Date("2026-08-14T12:00:00Z");

function stop(over: Partial<TrackingStop> = {}): TrackingStop {
  return {
    id: "s1", stop_order: 1, type: "delivery", address_line: "1 Dock Rd",
    city: "Hull", postcode: "HU3 4AB", planned_at: "2026-08-14T08:00:00Z",
    delivered_at: null, pod_status: "pending", recipient_name: null,
    pod_updated_at: null, pod_photo_url: null, pod_document_url: null,
    ...over,
  };
}

const pair = () => [
  stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds", postcode: "LS10 1AA" }),
  stop(),
];

function stops(nodes: JourneyNode[]) {
  return nodes.filter((n) => n.kind === "stop") as Extract<JourneyNode, { kind: "stop" }>[];
}

describe("buildJourney", () => {
  it("marks delivered stops done and the first undelivered one current", () => {
    const s = pair();
    s[0] = { ...s[0], pod_status: "delivered" };
    const n = stops(buildJourney(s, null, NOW));
    expect(n.map((x) => x.state)).toEqual(["done", "current"]);
  });

  it("marks later stops upcoming, not current", () => {
    const n = stops(buildJourney(
      [stop({ id: "a", stop_order: 0 }), stop({ id: "b", stop_order: 1 }), stop({ id: "c", stop_order: 2 })],
      null, NOW,
    ));
    expect(n.map((x) => x.state)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("orders by stop_order regardless of array order", () => {
    const n = stops(buildJourney([stop({ id: "b", stop_order: 2 }), stop({ id: "a", stop_order: 1 })], null, NOW));
    expect(n.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("has no current node when every stop is done", () => {
    const s = pair().map((x) => ({ ...x, pod_status: "delivered" }));
    const n = stops(buildJourney(s, null, NOW));
    expect(n.every((x) => x.state === "done")).toBe(true);
  });

  it("handles a single-stop job", () => {
    const n = stops(buildJourney([stop()], null, NOW));
    expect(n).toHaveLength(1);
    expect(n[0].isLast).toBe(true);
    expect(n[0].caption).toBe("Destination");
  });

  it("captions a done collection and a done delivery differently", () => {
    const s = pair().map((x) => ({ ...x, pod_status: "delivered", delivered_at: "2026-08-14T09:12:00Z" }));
    const n = stops(buildJourney(s, null, NOW));
    expect(n[0].caption).toBe("Collected");
    expect(n[1].caption).toBe("Delivered");
  });

  it("captions an intermediate undelivered stop as a waypoint", () => {
    const n = stops(buildJourney(
      [stop({ id: "a", stop_order: 0 }), stop({ id: "b", stop_order: 1 }), stop({ id: "c", stop_order: 2 })],
      null, NOW,
    ));
    expect(n.map((x) => x.caption)).toEqual(["Next stop", "Waypoint", "Destination"]);
  });

  it("shows delivered_at as a date and time", () => {
    const n = stops(buildJourney([stop({ delivered_at: "2026-08-12T14:32:00Z" })], null, NOW));
    expect(n[0].when).toBe("12 Aug 15:32"); // Europe/London, BST in August
  });

  it("shows planned_at as a DATE ONLY, because the 08:00 stamp is derived", () => {
    // app/jobs/page.tsx writes planned_at as `${scheduled_date}T08:00:00`.
    // Rendering a time from it would present a fabricated 8am as a real slot.
    const n = stops(buildJourney([stop({ planned_at: "2026-08-16T08:00:00Z" })], null, NOW));
    expect(n[0].when).toBe("16 Aug");
  });

  it("falls back rather than rendering a blank when both stamps are null", () => {
    const n = stops(buildJourney([stop({ planned_at: null })], null, NOW));
    expect(n[0].when).toBe("—");
  });

  it("labels a stop by city and postcode, falling back when both are null", () => {
    expect(stops(buildJourney([stop()], null, NOW))[0].label).toBe("Hull HU3 4AB");
    expect(stops(buildJourney([stop({ city: null, postcode: null })], null, NOW))[0].label)
      .toBe("Unnamed stop");
  });

  it("inserts no live node when there is no reading", () => {
    expect(buildJourney(pair(), null, NOW).some((n) => n.kind === "live")).toBe(false);
  });

  it("inserts no live node for a stale reading, because an old fix is not a position", () => {
    const stale: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 80,
      headingDeg: null, recordedAt: "2026-08-14T09:00:00Z",
    };
    expect(buildJourney(pair(), stale, NOW).some((n) => n.kind === "live")).toBe(false);
  });

  it("inserts a live node immediately before the current stop when the fix is live", () => {
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 81,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const s = pair();
    s[0] = { ...s[0], pod_status: "delivered" };
    const n = buildJourney(s, live, NOW);
    expect(n.map((x) => x.kind)).toEqual(["stop", "live", "stop"]);
    const liveNode = n[1] as Extract<JourneyNode, { kind: "live" }>;
    expect(liveNode.speedLabel).toBe("81 km/h");
    expect(liveNode.pingLabel).toBe("updated 2 min ago");
  });

  it("says Stationary rather than 0 km/h for a live fix that is not moving", () => {
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 0,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const n = buildJourney([stop()], live, NOW);
    expect((n[0] as Extract<JourneyNode, { kind: "live" }>).speedLabel).toBe("Stationary");
  });
});

describe("arrowStateFor", () => {
  it("is delivered when every stop is done", () => {
    const n = buildJourney(pair().map((x) => ({ ...x, pod_status: "delivered" })), null, NOW);
    expect(arrowStateFor(n, false)).toBe("delivered");
  });

  it("is overdue for a late job with work outstanding", () => {
    expect(arrowStateFor(buildJourney(pair(), null, NOW), true)).toBe("overdue");
  });

  it("is pending otherwise", () => {
    expect(arrowStateFor(buildJourney(pair(), null, NOW), false)).toBe("pending");
  });

  it("is not delivered for an empty journey, which has nothing to have delivered", () => {
    expect(arrowStateFor([], false)).toBe("pending");
  });
});

describe("routeGlyph", () => {
  it("drops the live node, since RouteProgress renders stops only", () => {
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 81,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const { nodes } = routeGlyph(buildJourney(pair(), live, NOW), "pending");
    expect(nodes.map((n) => n.id)).toEqual(["s0", "s1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tracking/journey.test.ts`
Expected: FAIL, module resolution error for `./journey`.

- [ ] **Step 3: Write the implementation**

Create `lib/tracking/journey.ts`:

```ts
import { isLive, pingLabel, type PositionReading } from "./position";
import type { TrackingStop } from "./types";
// Type-only import. RouteProgress is shared, its node shape is shared, and
// nothing at runtime crosses from tracking into pod.
import type { ArrowState, RouteNode } from "../pod/routeNodes";

export type JourneyStopState = "done" | "current" | "upcoming";

export type JourneyNode =
  | {
      kind: "stop";
      id: string;
      state: JourneyStopState;
      /** "Hull HU3 4AB" */
      label: string;
      addressLine: string | null;
      caption: string;
      when: string;
      isLast: boolean;
    }
  | {
      kind: "live";
      id: "live";
      speedLabel: string;
      pingLabel: string;
    };

/* Formatting is pinned to Europe/London rather than the runtime default. The
   fleet is UK-based (£ and en-GB throughout this codebase), and pinning it
   also makes these functions deterministic under Vitest, which would otherwise
   format against whatever TZ the machine happens to have. */
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
});

function formatWhen(stop: TrackingStop): string {
  /* delivered_at is a real event stamp, so it earns a time. planned_at is NOT:
     app/jobs/page.tsx writes it as `${scheduled_date}T08:00:00`, so showing a
     time from it would present a fabricated 8am as a booked slot. Date only.
     See lib/pod/overdue.ts, which documents the same column. */
  if (stop.delivered_at) {
    const d = new Date(stop.delivered_at);
    if (!Number.isNaN(d.getTime())) return `${DATE_FMT.format(d)} ${TIME_FMT.format(d)}`;
  }
  if (stop.planned_at) {
    const d = new Date(stop.planned_at);
    if (!Number.isNaN(d.getTime())) return DATE_FMT.format(d);
  }
  return "—";
}

function captionFor(stop: TrackingStop, state: JourneyStopState, isLast: boolean): string {
  if (state === "done") return stop.type === "collection" ? "Collected" : "Delivered";
  if (isLast) return "Destination";
  if (state === "current") return "Next stop";
  return "Waypoint";
}

export function buildJourney(
  stops: TrackingStop[],
  reading: PositionReading | null,
  now: Date,
): JourneyNode[] {
  const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);
  const currentIndex = ordered.findIndex((s) => s.pod_status !== "delivered");
  const showLive = isLive(reading, now);

  const nodes: JourneyNode[] = [];

  ordered.forEach((stop, i) => {
    const isLast = i === ordered.length - 1;
    const state: JourneyStopState =
      stop.pod_status === "delivered" ? "done" : i === currentIndex ? "current" : "upcoming";

    /* The live marker goes immediately BEFORE the stop being travelled to,
       which is how the mockup reads: the truck is between the last completed
       stop and the next one. A stale or absent fix inserts nothing at all
       rather than a marker nobody can date. */
    if (state === "current" && showLive && reading) {
      nodes.push({
        kind: "live",
        id: "live",
        speedLabel: reading.speedKph > 0 ? `${Math.round(reading.speedKph)} km/h` : "Stationary",
        pingLabel: `updated ${pingLabel(reading, now)}`,
      });
    }

    nodes.push({
      kind: "stop",
      id: stop.id,
      state,
      label: [stop.city, stop.postcode].filter(Boolean).join(" ") || "Unnamed stop",
      addressLine: stop.address_line,
      caption: captionFor(stop, state, isLast),
      when: formatWhen(stop),
      isLast,
    });
  });

  return nodes;
}

export function arrowStateFor(journey: JourneyNode[], isLate: boolean): ArrowState {
  const stopNodes = journey.filter((n) => n.kind === "stop");
  if (stopNodes.length > 0 && stopNodes.every((n) => n.kind === "stop" && n.state === "done")) {
    return "delivered";
  }
  return isLate ? "overdue" : "pending";
}

/** Adapts the journey to the node shape components/RouteProgress.tsx expects. */
export function routeGlyph(
  journey: JourneyNode[],
  arrowState: ArrowState,
): { nodes: RouteNode[]; arrowState: ArrowState } {
  const nodes: RouteNode[] = journey
    .filter((n) => n.kind === "stop")
    .map((n) => ({ id: n.id, state: (n as Extract<JourneyNode, { kind: "stop" }>).state }));
  return { nodes, arrowState };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tracking/journey.test.ts`
Expected: PASS, 20 tests.

If the two date assertions fail by exactly one hour, the `timeZone` option was dropped from a formatter. Do not "fix" the expectation, fix the formatter.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/journey.ts lib/tracking/journey.test.ts
git commit -m "Add the tracking journey timeline model

Renders planned_at as a date and never a time, because that column is a
derived 08:00 stamp rather than a booked slot. A live position node is
inserted only for a fix under the staleness threshold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The telemetry tiles

**Files:**
- Create: `lib/tracking/telemetry.ts`
- Test: `lib/tracking/telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tracking/telemetry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { telemetryTiles, ROUTING_HINT } from "./telemetry";
import type { PositionReading } from "./position";

const NOW = new Date("2026-08-14T12:00:00Z");

function reading(recordedAt: string, speedKph = 81): PositionReading {
  return { vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph, headingDeg: null, recordedAt };
}

describe("telemetryTiles", () => {
  it("always returns the mockup's four slots in order", () => {
    expect(telemetryTiles(null, NOW).map((t) => t.label))
      .toEqual(["Speed", "Distance to go", "Last ping", "ETA"]);
  });

  it("shows No signal for speed and ping when there is no reading", () => {
    const [speed, , ping] = telemetryTiles(null, NOW);
    expect(speed.value).toBe("No signal");
    expect(speed.muted).toBe(true);
    expect(ping.value).toBe("No signal");
  });

  it("never shows a zero speed for a missing fix", () => {
    // A "0 km/h" on a truck that is actually moving is worse than a blank.
    expect(telemetryTiles(null, NOW)[0].value).not.toContain("0");
  });

  it("populates speed and ping from a live reading", () => {
    const [speed, , ping] = telemetryTiles(reading("2026-08-14T11:58:00Z"), NOW);
    expect(speed.value).toBe("81 km/h");
    expect(speed.muted).toBe(false);
    expect(ping.value).toBe("2 min ago");
    expect(ping.muted).toBe(false);
  });

  it("says Stationary rather than 0 km/h for a live but halted vehicle", () => {
    expect(telemetryTiles(reading("2026-08-14T11:58:00Z", 0), NOW)[0].value).toBe("Stationary");
  });

  it("suppresses speed for a stale reading but still reports the ping", () => {
    // An old speed is meaningless. When it was last seen is not.
    const [speed, , ping] = telemetryTiles(reading("2026-08-14T09:00:00Z"), NOW);
    expect(speed.value).toBe("No signal");
    expect(ping.value).toBe("3 h ago");
    expect(ping.muted).toBe(true);
  });

  it("leaves distance and ETA blank in every case, with a hint saying why", () => {
    for (const r of [null, reading("2026-08-14T11:58:00Z"), reading("2026-08-14T09:00:00Z")]) {
      const [, distance, , eta] = telemetryTiles(r, NOW);
      expect(distance.value).toBe("—");
      expect(eta.value).toBe("—");
      expect(distance.hint).toBe(ROUTING_HINT);
      expect(eta.hint).toBe(ROUTING_HINT);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tracking/telemetry.test.ts`
Expected: FAIL, module resolution error for `./telemetry`.

- [ ] **Step 3: Write the implementation**

Create `lib/tracking/telemetry.ts`:

```ts
import { pingLabel, signalState, type PositionReading } from "./position";

export type Tile = {
  label: string;
  value: string;
  /** Render in the muted ink colour: this value is absent or not trustworthy. */
  muted: boolean;
  /** Explains an absent value. Rendered as a title attribute and for screen readers. */
  hint?: string;
};

export const ROUTING_HINT = "Available once telematics routing is connected";

const NO_SIGNAL = "No signal";

/* The mockup's four header slots. Two of them cannot be filled today and say
   so rather than guessing:

   Distance to go and ETA both need road routing. A straight-line haversine
   from the last fix to a destination postcode is not a road distance, and it
   would be wrong by a different amount on every job, which is the worst kind
   of wrong: plausible. They stay blank until TomTom Routing exists. */
export function telemetryTiles(reading: PositionReading | null, now: Date): Tile[] {
  const state = signalState(reading, now);

  const speed: Tile =
    state === "live" && reading
      ? {
          label: "Speed",
          value: reading.speedKph > 0 ? `${Math.round(reading.speedKph)} km/h` : "Stationary",
          muted: false,
        }
      : { label: "Speed", value: NO_SIGNAL, muted: true };

  const ping: Tile =
    state === "none"
      ? { label: "Last ping", value: NO_SIGNAL, muted: true }
      : { label: "Last ping", value: pingLabel(reading, now), muted: state === "stale" };

  return [
    speed,
    { label: "Distance to go", value: "—", muted: true, hint: ROUTING_HINT },
    ping,
    { label: "ETA", value: "—", muted: true, hint: ROUTING_HINT },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tracking/telemetry.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/telemetry.ts lib/tracking/telemetry.test.ts
git commit -m "Add tracking telemetry tiles with honest absent states

Speed reads No signal rather than 0 km/h when there is no fix, and is
suppressed entirely for a stale one. Distance and ETA stay blank with a hint,
because a haversine to a postcode is not a road distance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The synthesised activity feed

**Files:**
- Create: `lib/tracking/activity.ts`
- Test: `lib/tracking/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tracking/activity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildActivity } from "./activity";
import type { TrackingJob, TrackingStop } from "./types";

function stop(over: Partial<TrackingStop> = {}): TrackingStop {
  return {
    id: "s1", stop_order: 1, type: "delivery", address_line: "1 Dock Rd",
    city: "Hull", postcode: "HU3 4AB", planned_at: "2026-08-14T08:00:00Z",
    delivered_at: null, pod_status: "pending", recipient_name: null,
    pod_updated_at: null, pod_photo_url: null, pod_document_url: null,
    ...over,
  };
}

function job(over: Partial<TrackingJob> = {}): TrackingJob {
  return {
    id: "j1", reference: "J-100", status: "planned", scheduled_date: "2026-08-14",
    created_at: "2026-08-14T06:00:00Z", customer_name: "Acme", vehicle_id: "v1",
    vehicle_registration: "YT19 KHR", driver_name: "A. Marsh",
    driver_phone: "07700900000", subcontractor_id: null, stops: [stop()],
    ...over,
  };
}

describe("buildActivity", () => {
  it("always includes the job creation event", () => {
    const events = buildActivity(job());
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe("Job J-100 created");
  });

  it("returns an empty list rather than a bogus event when created_at is null", () => {
    expect(buildActivity(job({ created_at: null }))).toEqual([]);
  });

  it("reports a delivered delivery stop with its recipient", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z", recipient_name: "R. Bell" })],
    }));
    expect(events[0].text).toBe("Delivered to Hull, signed by R. Bell");
  });

  it("reports a delivered stop without a recipient, rather than saying signed by null", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z" })],
    }));
    expect(events[0].text).toBe("Delivered to Hull");
  });

  it("words a collection differently from a delivery", () => {
    const events = buildActivity(job({
      stops: [stop({ type: "collection", city: "Leeds", pod_status: "delivered", delivered_at: "2026-08-14T09:12:00Z" })],
    }));
    expect(events[0].text).toBe("Collected at Leeds");
  });

  it("reports POD evidence attached, using pod_updated_at", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_updated_at: "2026-08-14T11:05:00Z", pod_photo_url: "https://x/y.jpg" })],
    }));
    expect(events[0].text).toBe("POD evidence attached at Hull");
  });

  it("does not report evidence when pod_updated_at exists but no file is attached", () => {
    const events = buildActivity(job({ stops: [stop({ pod_updated_at: "2026-08-14T11:05:00Z" })] }));
    expect(events.map((e) => e.text)).toEqual(["Job J-100 created"]);
  });

  it("sorts newest first", () => {
    const events = buildActivity(job({
      stops: [
        stop({ id: "a", stop_order: 0, type: "collection", city: "Leeds", pod_status: "delivered", delivered_at: "2026-08-14T09:12:00Z" }),
        stop({ id: "b", stop_order: 1, pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z" }),
      ],
    }));
    expect(events.map((e) => e.text)).toEqual([
      "Delivered to Hull",
      "Collected at Leeds",
      "Job J-100 created",
    ]);
  });

  it("gives every event a stable unique id, so React keys do not collide", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z", pod_updated_at: "2026-08-14T11:05:00Z", pod_photo_url: "https://x/y.jpg" })],
    }));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("names an unreferenced job without printing null", () => {
    expect(buildActivity(job({ reference: null }))[0].text).toBe("Job created");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tracking/activity.test.ts`
Expected: FAIL, module resolution error for `./activity`.

- [ ] **Step 3: Write the implementation**

Create `lib/tracking/activity.ts`:

```ts
import type { TrackingJob, TrackingStop } from "./types";

export type ActivityEvent = {
  id: string;
  /** ISO stamp, used for sorting and rendered by the component. */
  at: string;
  text: string;
};

/* THE FEED USES NO EXTRA TABLES AND NO EXTRA QUERY.

   The design spec listed pod_records, pod_files and job_documents as sources.
   Nothing in this repo writes any of them, so they would contribute exactly
   zero events while costing three joins. job_stops.pod_updated_at IS written,
   by app/pod/page.tsx, so every event below comes from columns the page
   already selects.

   Every line here is something that provably happened. When a position feed
   exists, departed and arrived events join this list from the same function. */

function stopPlace(stop: TrackingStop): string {
  return stop.city ?? stop.postcode ?? "an unnamed stop";
}

export function buildActivity(job: TrackingJob): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  if (job.created_at) {
    events.push({
      id: `${job.id}:created`,
      at: job.created_at,
      text: job.reference ? `Job ${job.reference} created` : "Job created",
    });
  }

  for (const stop of job.stops) {
    if (stop.pod_status === "delivered" && stop.delivered_at) {
      const place = stopPlace(stop);
      const text =
        stop.type === "collection"
          ? `Collected at ${place}`
          : stop.recipient_name
            ? `Delivered to ${place}, signed by ${stop.recipient_name}`
            : `Delivered to ${place}`;
      events.push({ id: `${stop.id}:delivered`, at: stop.delivered_at, text });
    }

    // pod_updated_at alone proves only that the POD form was saved. Requiring a
    // file too means this line always corresponds to evidence a dispatcher can
    // actually open.
    const hasEvidence = Boolean(stop.pod_photo_url || stop.pod_document_url);
    if (hasEvidence && stop.pod_updated_at) {
      events.push({
        id: `${stop.id}:evidence`,
        at: stop.pod_updated_at,
        text: `POD evidence attached at ${stopPlace(stop)}`,
      });
    }
  }

  // Newest first. The id tiebreak keeps the order stable across the 30 second
  // poll when two events share a stamp, which the delivered/evidence pair
  // routinely does.
  events.sort((a, b) => {
    const byTime = b.at.localeCompare(a.at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });

  return events;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tracking/activity.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite, to be sure nothing else moved**

Run: `npm test`
Expected: PASS, all existing pod, dashboard and theme tests plus the five new tracking files.

- [ ] **Step 6: Commit**

```bash
git add lib/tracking/activity.ts lib/tracking/activity.test.ts
git commit -m "Add the synthesised tracking activity feed

Built from jobs.created_at and job_stops timestamps only. pod_records,
pod_files and job_documents were dropped from the design's source list because
nothing in the app writes them, so they would add joins and no events.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The pulse animation and its reduced-motion guard

**Files:**
- Modify: `app/globals.css` (append after the existing `@layer base` block, which currently ends at the end of the file)

Doing this before the components means every pulsing element written afterwards has a class to reach for.

- [ ] **Step 1: Append the components layer**

Add to the end of `app/globals.css`:

```css
/* Scoped to .ds so it cannot reach the ~14 legacy inline-styled pages.

   The design mockup animates the live-GPS dot and the current-stop marker with
   an infinite pulse and has no reduced-motion guard at all. An infinite
   animation is exactly what prefers-reduced-motion exists for, and this console
   is used for long shifts, so the guard is not optional. */
@layer components {
  @keyframes ds-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  .ds .ds-pulse {
    animation: ds-pulse 1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .ds .ds-pulse {
      animation: none;
    }
  }
}
```

- [ ] **Step 2: Verify the build compiles the new layer**

Run: `npm run build`
Expected: build succeeds. Tailwind emits `@layer components` content without needing a content-scan hit, because this is hand-written CSS rather than a utility.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Add a reduced-motion-guarded pulse class for the tracking console

The design mockup animates its live indicators infinitely with no guard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: TrackingRail

**Files:**
- Create: `app/tracking/TrackingRail.tsx`

- [ ] **Step 1: Write the component**

Create `app/tracking/TrackingRail.tsx`:

```tsx
import Badge from "../../components/Badge";
import { PHASE_LABEL, PHASE_TONE, type RailRow } from "../../lib/tracking/onTheRoad";

type Props = {
  rows: RailRow[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
  /** Rendered under the list, e.g. "Auto-refresh 30 s · updated 14:02". */
  footNote: string;
};

export default function TrackingRail({ rows, selectedJobId, onSelect, footNote }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex-1 text-sm font-semibold text-ink">On the road</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-data-sm tabular-nums text-ink-2">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Nothing on the road right now.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const selected = row.jobId === selectedJobId;
            return (
              <li key={row.jobId}>
                <button
                  type="button"
                  onClick={() => onSelect(row.jobId)}
                  aria-current={selected ? "true" : undefined}
                  /* The selected row is marked by an inset left bar rather than
                     a border, so selection does not shift the row's contents by
                     2px as it moves down the list. */
                  className={`flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    selected
                      ? "bg-primary-tint shadow-[inset_2px_0_0_var(--primary)]"
                      : "bg-transparent hover:bg-surface-2"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="font-mono text-data tabular-nums text-ink">{row.registration}</span>
                    <span className="flex-1" />
                    <Badge tone={PHASE_TONE[row.phase]}>{PHASE_LABEL[row.phase]}</Badge>
                  </span>

                  <span className="block truncate text-xs text-ink-2">
                    {row.driverName ?? "No driver assigned"}
                  </span>

                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-data-sm text-ink-3">
                      {row.originCity} → {row.destinationCity}
                    </span>
                    <span className="font-mono text-data-sm tabular-nums text-ink-2">
                      {row.scheduledDate ?? "—"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-4 py-2.5 text-xs text-ink-3">{footNote}</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors mentioning `app/tracking/TrackingRail.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/tracking/TrackingRail.tsx
git commit -m "Add the tracking rail

Rows are real buttons with aria-current, and selection is an inset bar rather
than a border so the row contents do not shift as selection moves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: TrackingHeader

**Files:**
- Create: `app/tracking/TrackingHeader.tsx`

- [ ] **Step 1: Write the component**

Create `app/tracking/TrackingHeader.tsx`:

```tsx
import Link from "next/link";
import Badge from "../../components/Badge";
import RouteProgress from "../../components/RouteProgress";
import { PHASE_LABEL, PHASE_TONE, type Phase } from "../../lib/tracking/onTheRoad";
import { arrowStateFor, routeGlyph, type JourneyNode } from "../../lib/tracking/journey";
import { pingLabel, signalState, type PositionReading } from "../../lib/tracking/position";
import { telemetryTiles } from "../../lib/tracking/telemetry";
import type { TrackingJob } from "../../lib/tracking/types";

type Props = {
  job: TrackingJob;
  phase: Phase;
  journey: JourneyNode[];
  reading: PositionReading | null;
  now: Date;
};

/* The GPS pill is the one element most likely to mislead. A green pulsing
   "Live GPS" over a three-hour-old fix tells a dispatcher the truck is
   reporting when it is not, so each signal state gets its own wording, its own
   tone, and only the live one animates. */
function GpsPill({ reading, now }: { reading: PositionReading | null; now: Date }) {
  const state = signalState(reading, now);

  if (state === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-tint px-2 py-0.5 text-xs font-medium text-success-strong">
        <span aria-hidden className="ds-pulse block h-1.5 w-1.5 rounded-full bg-success" />
        Live GPS
      </span>
    );
  }

  if (state === "stale") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-strong">
        <span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-warning" />
        Last seen {pingLabel(reading, now)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-3">
      <span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-ink-4" />
      No GPS
    </span>
  );
}

export default function TrackingHeader({ job, phase, journey, reading, now }: Props) {
  const tiles = telemetryTiles(reading, now);
  const glyph = routeGlyph(journey, arrowStateFor(journey, phase === "late"));

  const ordered = [...job.stops].sort((a, b) => a.stop_order - b.stop_order);
  const origin = ordered.find((s) => s.type === "collection")?.city ?? "—";
  const destination = [...ordered].reverse().find((s) => s.type === "delivery")?.city ?? "—";

  const isSubcontracted = Boolean(job.subcontractor_id);
  // A tel: link only when there is actually a number and the driver is ours.
  // Rendering a dead "Call driver" control is worse than rendering none.
  const callable = !isSubcontracted && job.driver_phone;

  const subtitle = [
    job.customer_name ?? "No customer",
    `${origin} → ${destination}`,
    isSubcontracted ? `${job.driver_name ?? "Carrier"} (carrier)` : (job.driver_name ?? "No driver"),
  ].join(" · ");

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-md font-semibold tabular-nums text-ink">
          {job.vehicle_registration ?? "—"}
        </span>
        <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
        <GpsPill reading={reading} now={now} />

        <span className="flex-1" />

        {callable ? (
          <a
            href={`tel:${job.driver_phone}`}
            className="rounded-sm border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-2"
          >
            Call {job.driver_name ?? "driver"}
          </a>
        ) : null}

        <Link
          href="/jobs"
          className="rounded-sm px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          Job detail
        </Link>
      </div>

      <p className="mt-1 text-xs text-ink-3">{subtitle}</p>

      <div className="mt-4">
        <RouteProgress
          nodes={glyph.nodes}
          arrowState={glyph.arrowState}
          label={`${origin} to ${destination}, ${glyph.nodes.length} stops, ${PHASE_LABEL[phase].toLowerCase()}`}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3.5 border-t border-line pt-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0">
            <dt className="truncate text-kicker uppercase text-ink-3">{tile.label}</dt>
            <dd
              className={`m-0 font-mono text-md font-semibold tabular-nums ${
                tile.muted ? "text-ink-3" : "text-ink"
              }`}
              title={tile.hint}
            >
              {tile.value}
              {tile.hint ? <span className="sr-only"> ({tile.hint})</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors mentioning `app/tracking/TrackingHeader.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/tracking/TrackingHeader.tsx
git commit -m "Add the tracking header card

The GPS pill has three distinct states and only the live one pulses, so the
page cannot show a green Live GPS badge over an hours-old fix. Call driver is
a tel: link and is omitted entirely when there is no number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: TrackingMap

**Files:**
- Create: `app/tracking/TrackingMap.tsx`

- [ ] **Step 1: Write the component**

Create `app/tracking/TrackingMap.tsx`:

```tsx
import { signalState, type PositionReading } from "../../lib/tracking/position";
import type { TrackingStop } from "../../lib/tracking/types";

type Props = {
  stops: TrackingStop[];
  reading: PositionReading | null;
  now: Date;
};

/* THE MAP SEAM.

   These props are already the ones a real TomTom Maps mount needs: the stops
   to draw a route through, and the reading to place the vehicle. Wiring TomTom
   later changes this file's internals and nothing else.

   Today it renders a labelled placeholder rather than a spinner or a fake map
   image. A spinner would claim something is loading that is not, and a static
   map picture would be a lie about a live system. */

const HEIGHT = 260;

export default function TrackingMap({ stops, reading, now }: Props) {
  const state = signalState(reading, now);
  const stopCount = stops.length;

  const message =
    state === "none"
      ? "Vehicle positions appear here once telematics is connected."
      : "Map tiles appear here once telematics is connected.";

  return (
    <section
      aria-label="Vehicle position map"
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 p-6 text-center shadow-sm"
      style={{ height: HEIGHT }}
    >
      <p className="text-sm font-semibold text-ink-2">{message}</p>
      <p className="max-w-[42ch] text-xs text-ink-3">
        {stopCount > 0
          ? `This job has ${stopCount} ${stopCount === 1 ? "stop" : "stops"} ready to plot.`
          : "This job has no stops to plot."}
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors mentioning `app/tracking/TrackingMap.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/tracking/TrackingMap.tsx
git commit -m "Add the tracking map card as a labelled placeholder

Props are already the ones a TomTom Maps mount needs. Renders a stated
placeholder rather than a spinner or a static map image, neither of which
would be honest about a system with no feed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: JourneyTimeline and ActivityFeed

**Files:**
- Create: `app/tracking/JourneyTimeline.tsx`
- Create: `app/tracking/ActivityFeed.tsx`

- [ ] **Step 1: Write JourneyTimeline**

Create `app/tracking/JourneyTimeline.tsx`:

```tsx
import type { JourneyNode } from "../../lib/tracking/journey";

type Props = { nodes: JourneyNode[]; note: string };

const DOT: Record<"done" | "current" | "upcoming", string> = {
  done: "bg-success border-success",
  current: "bg-primary border-primary-tint-border",
  upcoming: "bg-surface border-line-strong",
};

export default function JourneyTimeline({ nodes, note }: Props) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <h2 className="flex-1 text-sm font-semibold text-ink">Journey</h2>
        <span className="text-xs text-ink-3">{note}</span>
      </header>

      <ol className="m-0 list-none px-5 py-4">
        {nodes.map((node, i) => {
          const last = i === nodes.length - 1;

          if (node.kind === "live") {
            return (
              <li key={node.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3.5">
                <div className="flex flex-col items-center">
                  <span aria-hidden className="ds-pulse block h-3 w-3 rounded-full border-2 border-primary-tint-border bg-primary" />
                  {last ? null : <span aria-hidden className="w-0 flex-1 border-l-2 border-dotted border-line-strong" />}
                </div>
                <div className="min-w-0 pb-4">
                  <span className="inline-flex items-center gap-2 rounded-sm border border-primary-tint-border bg-primary-tint px-2.5 py-1.5">
                    <span className="font-mono text-data-sm tabular-nums text-primary-deep">{node.speedLabel}</span>
                    <span aria-hidden className="block h-3 w-px bg-primary-tint-border" />
                    <span className="text-xs text-primary-deep">{node.pingLabel}</span>
                  </span>
                </div>
              </li>
            );
          }

          return (
            <li key={node.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3.5">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-1 block h-2.5 w-2.5 flex-none rounded-full border-2 ${DOT[node.state]}`}
                />
                {last ? null : (
                  <span
                    aria-hidden
                    className={`mt-1 w-0 flex-1 border-l-2 ${
                      node.state === "done" ? "border-solid border-success-border" : "border-dotted border-line-strong"
                    }`}
                  />
                )}
              </div>

              <div className="min-w-0 pb-4">
                <div className="flex items-baseline gap-2.5">
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{node.label}</span>
                  <span className="flex-1" />
                  <span className="whitespace-nowrap font-mono text-data-sm tabular-nums text-ink-2">
                    {node.when}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">
                  {node.caption}
                  {node.addressLine ? ` · ${node.addressLine}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Write ActivityFeed**

Create `app/tracking/ActivityFeed.tsx`:

```tsx
import type { ActivityEvent } from "../../lib/tracking/activity";

type Props = { events: ActivityEvent[] };

const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

function stamp(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "—" : STAMP.format(d);
}

export default function ActivityFeed({ events }: Props) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <h2 className="flex-1 text-sm font-semibold text-ink">Activity</h2>
        <span className="font-mono text-data-sm tabular-nums text-ink-3">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </header>

      {events.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-3">Nothing recorded for this job yet.</p>
      ) : (
        <ol className="m-0 list-none px-5 py-4">
          {events.map((event, i) => (
            <li key={event.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-3">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-1 block h-2 w-2 flex-none rounded-full border-2 ${
                    i === 0 ? "border-primary bg-primary" : "border-line-strong bg-surface"
                  }`}
                />
                {i < events.length - 1 ? (
                  <span aria-hidden className="mt-1 w-0 flex-1 border-l-2 border-line" />
                ) : null}
              </div>
              <div className="min-w-0 pb-3.5">
                <p className="text-sm text-ink">{event.text}</p>
                <p className="mt-0.5 font-mono text-data-sm tabular-nums text-ink-3">{stamp(event.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Verify both typecheck**

Run: `npm run typecheck`
Expected: no errors mentioning `app/tracking/`.

- [ ] **Step 4: Commit**

```bash
git add app/tracking/JourneyTimeline.tsx app/tracking/ActivityFeed.tsx
git commit -m "Add the tracking journey timeline and activity feed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Rewrite the page

**Files:**
- Modify: `app/tracking/page.tsx` (full replacement)

- [ ] **Step 1: Replace the file**

Replace the entire contents of `app/tracking/page.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import TrackingRail from "./TrackingRail";
import TrackingHeader from "./TrackingHeader";
import TrackingMap from "./TrackingMap";
import JourneyTimeline from "./JourneyTimeline";
import ActivityFeed from "./ActivityFeed";
import { buildRail, jobPhase, localDay } from "../../lib/tracking/onTheRoad";
import { buildJourney } from "../../lib/tracking/journey";
import { buildActivity } from "../../lib/tracking/activity";
import { createSupabasePositionSource } from "../../lib/tracking/supabasePositions";
import { pingLabel, type PositionReading } from "../../lib/tracking/position";
import type { TrackingJob } from "../../lib/tracking/types";

/* The old page polled every 10 seconds and fetched every vehicle_locations row
   ever recorded on each pass. 30 seconds matches the design's own footnote, and
   the poll pauses while the tab is hidden so a forgotten background tab stops
   issuing queries against a live database. */
const POLL_MS = 30_000;

/* Supabase returns an embedded relation as an object or as a one-element array
   depending on how it infers the relationship. Both shapes have appeared in
   this codebase, so this normalises rather than assuming. */
function rel(value: any): any {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
});

export default function TrackingPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [jobs, setJobs] = useState<TrackingJob[]>([]);
  const [positions, setPositions] = useState<Map<string, PositionReading>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `cancelled` guards against setting state after the tenant changes or the
    // page unmounts mid-request. The old page had no such guard.
    let cancelled = false;

    async function load(showSkeleton: boolean) {
      if (showSkeleton) setLoading(true);

      const today = localDay(new Date());

      /* Narrowed server-side on the three cheap conditions before
         isOnTheRoad applies the rest client-side. The stop-level condition
         cannot be expressed here, which is why the predicate still runs. */
      const { data, error } = await tenant
        .filterByTenant(
          supabase.from("jobs").select(`
            id,
            reference,
            status,
            scheduled_date,
            created_at,
            vehicle_id,
            subcontractor_id,
            customers ( name ),
            vehicles ( registration ),
            drivers ( name, phone ),
            job_stops (
              id, stop_order, type, address_line, city, postcode,
              planned_at, delivered_at, pod_status, recipient_name,
              pod_updated_at, pod_photo_url, pod_document_url
            )
          `),
        )
        .eq("status", "planned")
        .not("vehicle_id", "is", null)
        .lte("scheduled_date", today);

      if (cancelled) return;

      if (error) {
        setLoadFailed(true);
        setLoading(false);
        return;
      }

      const mapped: TrackingJob[] = (data ?? []).map((row: any) => {
        const vehicle = rel(row.vehicles);
        const driver = rel(row.drivers);
        return {
          id: row.id,
          reference: row.reference,
          status: row.status,
          scheduled_date: row.scheduled_date,
          created_at: row.created_at,
          customer_name: rel(row.customers)?.name ?? null,
          vehicle_id: row.vehicle_id,
          vehicle_registration: vehicle?.registration ?? null,
          driver_name: driver?.name ?? null,
          driver_phone: driver?.phone ?? null,
          subcontractor_id: row.subcontractor_id,
          stops: [...(row.job_stops ?? [])].sort(
            (a: any, b: any) => a.stop_order - b.stop_order,
          ),
        };
      });

      const now = new Date();
      const vehicleIds = Array.from(
        new Set(
          buildRail(mapped, now)
            .map((r) => mapped.find((j) => j.id === r.jobId)?.vehicle_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const source = createSupabasePositionSource(supabase, tenant);
      const readings = await source.getPositions(vehicleIds);

      if (cancelled) return;

      setJobs(mapped);
      setPositions(readings);
      setLoadFailed(false);
      setLoading(false);
      setLastLoadedAt(new Date());
    }

    load(true);

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, POLL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") load(false);
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tenant.activeTenantId, reloadToken]);

  // One `now` per load, injected into every pure function, so the rail order,
  // the phase badge and the staleness pill cannot disagree by milliseconds
  // about what "today" or "stale" means. Same reasoning as app/pod/page.tsx.
  const now = useMemo(() => new Date(), [jobs]);

  const rail = useMemo(() => buildRail(jobs, now), [jobs, now]);

  // Falling back to the first row means a fresh load, or a poll that removes
  // the selected job, always leaves something selected rather than blanking
  // the detail column.
  const selected = useMemo(
    () => rail.find((r) => r.jobId === selectedId) ?? rail[0] ?? null,
    [rail, selectedId],
  );

  const selectedJob = useMemo(
    () => (selected ? jobs.find((j) => j.id === selected.jobId) ?? null : null),
    [jobs, selected],
  );

  const reading = selectedJob?.vehicle_id ? positions.get(selectedJob.vehicle_id) ?? null : null;

  const journey = useMemo(
    () => (selectedJob ? buildJourney(selectedJob.stops, reading, now) : []),
    [selectedJob, reading, now],
  );

  const activity = useMemo(
    () => (selectedJob ? buildActivity(selectedJob) : []),
    [selectedJob],
  );

  const footNote = lastLoadedAt
    ? `Auto-refresh 30 s · updated ${CLOCK.format(lastLoadedAt)}`
    : "Auto-refresh 30 s";

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <div className="text-kicker uppercase text-ink-3">Tracking</div>
          <h1 className="mb-4 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Jobs on the road
          </h1>

          {loading ? (
            <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
              <p className="text-sm text-ink-3">Loading jobs…</p>
            </div>
          ) : loadFailed ? (
            <div className="rounded-lg border border-danger-border bg-danger-tint p-6 shadow-sm">
              <p className="text-sm font-semibold text-danger-strong">Could not load tracking</p>
              <p className="mt-1 text-sm text-ink-2">
                The jobs query failed. Nothing has been changed.
              </p>
              <button
                type="button"
                onClick={() => setReloadToken((t) => t + 1)}
                className="mt-3 rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-2"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="max-h-[40vh] overflow-y-auto xl:max-h-none xl:overflow-visible">
                <TrackingRail
                  rows={rail}
                  selectedJobId={selected?.jobId ?? null}
                  onSelect={setSelectedId}
                  footNote={footNote}
                />
              </div>

              <div className="grid min-w-0 gap-3">
                {selectedJob && selected ? (
                  <>
                    <TrackingHeader
                      job={selectedJob}
                      phase={jobPhase(selectedJob, now)}
                      journey={journey}
                      reading={reading}
                      now={now}
                    />
                    <TrackingMap stops={selectedJob.stops} reading={reading} now={now} />
                    <JourneyTimeline
                      nodes={journey}
                      note={reading ? `Position ${pingLabel(reading, now)}` : "No position reported"}
                    />
                    <ActivityFeed events={activity} />
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface px-6 py-16 text-center shadow-sm">
                    <p className="text-md font-semibold text-ink">No jobs on the road</p>
                    <p className="max-w-[46ch] text-sm text-ink-2">
                      Assigned jobs appear here once they are due and still have a delivery
                      outstanding.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </TenantGate>
  );
}
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add app/tracking/page.tsx
git commit -m "Rebuild /tracking as a design-system console page

Replaces the inline-styled vehicle table with a job-first rail beside a
header, map, journey and activity column.

Fixes three defects in the old page: it fetched every vehicle_locations row
ever recorded and filtered client-side, it discarded the Supabase error so a
failed load rendered as an empty table, and it polled every 10 seconds
including in hidden tabs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Activate the theme for /tracking

Do this last of the code tasks. Until the page is fully tokenised, `ThemeScope` pinning it dark is what keeps it readable, and adding the route early would render the old inline colours on a light background.

**Files:**
- Modify: `lib/nav/themeableRoutes.ts`

- [ ] **Step 1: Add the route**

In `lib/nav/themeableRoutes.ts`, add one line to `THEMEABLE_ROUTES`, keeping the existing comment alignment:

```ts
export const THEMEABLE_ROUTES: readonly string[] = [
  "/",                       // app/page.tsx                      (self-pins .light)
  "/login",                  // app/login/page.tsx
  "/dashboard",              // app/dashboard/page.tsx
  "/jobs",                   // app/jobs/page.tsx
  "/pod",                    // app/pod/page.tsx
  "/tracking",               // app/tracking/page.tsx
  "/super-admin/requests",   // app/super-admin/requests/page.tsx
];
```

- [ ] **Step 2: Update the file's own header comment**

That header names `/tracking` as its example of a page that would render white-on-white if activated too early. That is now out of date and would mislead the next reader. Replace that sentence:

Find:

```
   theme would put their dark-tuned text on a light background: /tracking would
   render white-on-white.
```

Replace with:

```
   theme would put their dark-tuned text on a light background: /telematics
   would render white-on-white.
```

If the wrapping differs in the file, keep the surrounding lines intact and change only the route name.

- [ ] **Step 3: Verify the toggle works in both directions**

Run: `npm run dev`, then sign in locally.

Note: `scripts/dev-login.mjs` points at the LIVE Supabase project, so anything you change while testing writes production data. Read only. Do not save a POD or edit a job while checking this page.

```bash
node scripts/dev-login.mjs <your-email> /tracking
```

Open the printed link. Then:
- Toggle to light. The page must switch fully. Any element still dark is an untokenised colour left in a component from Tasks 8 to 12.
- Toggle back to dark.
- Check the theme toggle is now visible on `/tracking`, since `AppShell` renders it for themeable routes.

- [ ] **Step 4: Run the theme contrast suite**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: PASS. It reads `app/tokens.css` and asserts full parity plus every contrast pair, so it catches a token that regressed.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/themeableRoutes.ts
git commit -m "Activate light/dark theming for /tracking

Seventh themeable route, second converted after /pod. Updates the file's own
header comment, which used /tracking as its white-on-white example.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Layout regression check

**Files:**
- Create: `tests/tracking-layout.spec.mjs`

Read `tests/pod-layout.spec.mjs` first and follow its structure, its env-var convention and its exit codes. This task mirrors it rather than inventing a second approach.

- [ ] **Step 1: Write the spec**

Create `tests/tracking-layout.spec.mjs`:

```js
/* Layout regression check for /tracking.
 *
 * WHY THIS EXISTS: the same reason tests/pod-layout.spec.mjs exists. Two
 * overlap bugs shipped or nearly shipped in this repo on 2026-08-13, both
 * invisible in review and obvious the instant something rendered and measured
 * them. This page puts a four-card detail column beside a fixed 300px rail,
 * which is exactly that class of risk.
 *
 * SETUP, once (shared with pod-layout.spec.mjs):
 *   npm install playwright --prefix tests
 *   npx playwright install chromium
 *
 * RUN, from the repo root, with the dev server up:
 *   LINK=$(node scripts/dev-login.mjs <email> /tracking | grep -o 'http://[^ ]*')
 *   TRACKING_AUTH_URL="$LINK" node tests/tracking-layout.spec.mjs
 *
 * Without TRACKING_AUTH_URL it aborts, because signed out /tracking redirects
 * to /login.
 *
 * Exit codes:  0 = passed   1 = a layout failure   2 = nothing measured
 */
import { chromium } from "playwright";

const TARGET = process.env.TRACKING_URL || "http://localhost:3000/tracking";
const AUTH = process.env.TRACKING_AUTH_URL;

if (!AUTH) {
  console.error("TRACKING_AUTH_URL is required. See the header of this file.");
  process.exit(2);
}

const failures = [];
let measured = 0;

function check(name, condition, detail) {
  measured += 1;
  if (!condition) failures.push(`${name}: ${detail}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto(AUTH, { waitUntil: "networkidle" });
if (new URL(page.url()).pathname.startsWith("/login")) {
  console.error("Landed on /login. The auth link has expired, generate a fresh one.");
  await browser.close();
  process.exit(2);
}

await page.goto(TARGET, { waitUntil: "networkidle" });
await page.waitForSelector("h1", { timeout: 10000 });

// 1. The page must never scroll horizontally. This is the failure mode both
//    earlier bugs shared.
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow", overflow <= 0, `body overflows by ${overflow}px`);

// 2. Nothing may overflow its own parent's box.
const overflowing = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".ds *")) {
    const parent = el.parentElement;
    if (!parent) continue;
    const e = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    if (p.width === 0) continue;
    const spill = Math.round(Math.max(e.right - p.right, p.left - e.left));
    if (spill > 1) bad.push(`${el.tagName.toLowerCase()}.${el.className || "?"} spills ${spill}px`);
  }
  return bad.slice(0, 10);
});
check("no child spills its parent", overflowing.length === 0, overflowing.join("; "));

// 3. When the rail has rows, the detail column must be beside it, not under it.
const layout = await page.evaluate(() => {
  const rail = document.querySelector('[aria-current], .ds ul li button');
  const map = document.querySelector('[aria-label="Vehicle position map"]');
  if (!rail || !map) return null;
  const r = rail.getBoundingClientRect();
  const m = map.getBoundingClientRect();
  return { railRight: Math.round(r.right), mapLeft: Math.round(m.left) };
});
if (layout) {
  check(
    "detail column sits beside the rail at 1440px",
    layout.mapLeft >= layout.railRight,
    `rail ends at ${layout.railRight}, map starts at ${layout.mapLeft}`,
  );
}

// 4. The same two checks at the stacking breakpoint.
await page.setViewportSize({ width: 900, height: 1000 });
await page.waitForTimeout(300);
const narrowOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow at 900px", narrowOverflow <= 0, `body overflows by ${narrowOverflow}px`);

await browser.close();

if (measured === 0) {
  console.error("Nothing was measured.");
  process.exit(2);
}

if (failures.length > 0) {
  console.error(`FAIL (${failures.length} of ${measured})`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`PASS (${measured} checks)`);
process.exit(0);
```

- [ ] **Step 2: Run it**

With the dev server running:

```bash
LINK=$(node scripts/dev-login.mjs <your-email> /tracking | grep -o 'http://[^ ]*')
TRACKING_AUTH_URL="$LINK" node tests/tracking-layout.spec.mjs
```

Expected: `PASS (4 checks)`.

If check 3 reports nothing measured, the rail is empty, which is likely, since no job may currently satisfy the predicate. That is not a spec failure. Note it and move on; checks 1, 2 and 4 still run.

- [ ] **Step 3: Commit**

```bash
git add tests/tracking-layout.spec.mjs
git commit -m "Add a layout regression check for /tracking

Mirrors tests/pod-layout.spec.mjs. A four-card detail column beside a fixed
300px rail is the same class of risk the POD check was written for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Full verification

- [ ] **Step 1: Run everything**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all three pass.

- [ ] **Step 2: Confirm the old page's assets are unreferenced**

Run: `grep -rn "GPS.jpg" app components lib public`

If `public/GPS.jpg` is now referenced by nothing, leave the file in place. Deleting a public asset is outside this change's scope and belongs in a separate cleanup commit.

- [ ] **Step 3: Walk the page manually**

With the dev server up and signed in via `scripts/dev-login.mjs` (read only, it points at the live database):

- The rail lists jobs, or the empty state reads "No jobs on the road".
- Clicking a rail row swaps the detail column and moves `aria-current`.
- Tab into the rail. Focus is visible on each row.
- Every telemetry tile reads "No signal" or "—". None reads "0 km/h".
- The GPS pill reads "No GPS" in grey and does not pulse.
- The map card shows its placeholder text at 260px.
- Toggle light and dark. Nothing stays the wrong colour.
- Enable reduced motion at the OS level and reload. No element pulses.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin ethan/tracking-console
```

---

## Self-review notes

**Spec coverage.** Every section of the design spec maps to a task: `lib/tracking/` modules to Tasks 1 and 3 to 6, the position seam to Tasks 1 and 2, components to Tasks 8 to 11, composition and the three page states to Task 12, the theme conversion to Task 13, accessibility to Tasks 7 (reduced motion), 8 (`aria-current`) and 9 (`tel:` link), the three carried fixes to Task 12, and testing to every lib task plus Task 14.

**Deviations, all flagged above:** the position seam is two files rather than one; the activity feed drops three never-written tables; timestamp normalisation was added.

**Naming consistency.** `PositionReading`, `PositionSource`, `signalState`, `isLive`, `pingLabel`, `buildRail`, `RailRow`, `Phase`, `PHASE_LABEL`, `PHASE_TONE`, `buildJourney`, `JourneyNode`, `arrowStateFor`, `routeGlyph`, `telemetryTiles`, `Tile`, `ROUTING_HINT`, `buildActivity`, `ActivityEvent` are each defined once and used with the same name and signature everywhere they appear.
