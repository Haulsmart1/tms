# Tracking console redesign

Date: 2026-08-14
Status: approved, ready for planning
Route: `/tracking`

## Summary

Rebuild `/tracking` as a design-system console page: a job-first queue rail
beside a stacked detail column of header, map, journey and activity cards. The
shape comes from the `TMSWizzard Console.dc.html` mockup in the Claude Design
project `212e97f0-1818-4941-9d4c-3e741869887f`, adapted to the data this
codebase actually holds.

The page ships with no live position feed. TomTom is the intended source, and
this change prepares for it behind a single typed seam without making any
network call, requiring any key, or incurring any cost.

## Why now

The current page predates the console design system entirely. It renders a raw
table of every active vehicle over a `GPS.jpg` background with hardcoded inline
colours. `lib/nav/themeableRoutes.ts` names it as the example of a legacy page
that would render white-on-white if it followed the theme, so it is already a
known, planned conversion. It will be the seventh themeable route and the
second converted after `/pod`.

## What the mockup shows, and where the data does not reach

The mockup's Tracking screen is a 300px "On the road" rail listing active jobs,
beside a detail column with a header card (plate, status badge, live-GPS pulse,
call driver, route glyph, four telemetry tiles), a Journey stop timeline with a
pulsing live-position marker, and a Live activity feed.

Four gaps between that and this database, each resolved below:

1. **No position feed exists.** Nothing in the repo writes `vehicle_locations`
   or `telematics_positions`. Both are read-only from the app's point of view.
2. **The mockup's job statuses do not exist.** It filters on
   `transit`, `late` and `loading`. Real `jobs.status` is effectively binary:
   `planned` on create, `completed` once every delivery stop is signed off.
   `job_stops.status` is written as `"planned"` at insert and never updated.
3. **No event stream.** `audit_logs` exists but nothing writes to it, so the
   Live activity card has no direct source.
4. **No delivery window, and coarse timestamps.** The mockup renders a
   `window 14:00-15:00` line from a field with no equivalent here.
   `job_stops.planned_at` is written as a derived `${scheduled_date}T08:00:00`
   stamp, so it is accurate to the day and not the hour. This is documented in
   `lib/pod/overdue.ts`.

## Decisions

| Question | Decision |
| --- | --- |
| Position source | TomTom, later. Seam only in this change, no network calls. |
| Rail entity | Active jobs, matching the mockup, not vehicles. |
| Map | Yes, as its own card between the header and journey cards. |
| "On the road" definition | Derived from existing columns. No schema change. |
| Activity feed | Synthesised from real timestamps. |
| Code structure | Mirror `/pod`: thin page, presentational components, pure tested `lib/` modules. |

## Architecture

### Pure logic: `lib/tracking/`

Each module gets a colocated `.test.ts`. Vitest is configured for
`lib/**/*.test.ts` only, which is why all the deciding lives here.

**`onTheRoad.ts`** owns the rail predicate and sort. Nothing else in the app may
redefine "on the road", the same way `lib/pod/overdue.ts` owns "awaiting POD".

A job enters the rail when all four hold:

- `jobs.status === "planned"`
- `jobs.vehicle_id` is not null
- `jobs.scheduled_date` is today or earlier
- at least one delivery stop has `pod_status !== "delivered"`

Read plainly: assigned, due, not finished.

The fourth condition also excludes a job with no delivery stops at all, which is
correct: such a job has nothing to arrive at. This mirrors the
`deliveryStops.length > 0` guard the POD completion cascade already applies.

The predicate deliberately does **not** require the collection stop to be
marked done. `/pod` only ever surfaces delivery stops
(`splitDeliveryStops` filters on `type === "delivery"`), and while `/jobs` will
accept a POD against any stop, nothing prompts anyone to mark a collection. A
collection-done requirement would leave the rail permanently empty.

Sort: late jobs first, then `scheduled_date` ascending, then `reference`. The
row needing attention stays at the top and the order does not jitter between
polls.

The same module derives a **phase**, rendered by both the rail badge and the
header badge. Three values, each provable from real data:

| Phase | Condition | Label | Tone |
| --- | --- | --- | --- |
| `late` | `scheduled_date` strictly before today | Late | danger |
| `in_progress` | scheduled today, at least one stop `delivered` | In progress | primary |
| `due` | scheduled today, nothing marked yet | Due today | warning |

This is coarser than the mockup's transit / loading / late. Loading versus
moving is a distinction only a live position can make, so it arrives with
TomTom rather than being faked now.

**`journey.ts`** turns `job_stops` ordered by `stop_order` into timeline nodes.
A stop is `done` when `pod_status === "delivered"`; the first non-done stop is
`current`; the rest are `upcoming`. Each node carries address line, town,
postcode, and a timestamp taken from `delivered_at` where present, otherwise the
derived `planned_at` rendered as a date rather than a time, because the `08:00`
stamp is only accurate to the day. The mockup's delivery-window line is dropped:
no such column exists.

The function accepts an optional `PositionReading`. When one is present it
inserts a synthetic live-position node before the current stop. Today it always
returns null for that node.

**`activity.ts`** merges timestamps into one reverse-chronological list: job
created, each stop marked delivered with its recipient name, each `pod_records`
signature, each `pod_files` upload, each `job_documents` upload. Typically three
to six events per job, every one of them true.

**`telemetry.ts`** formats the four header tiles from a reading, including the
absent case. Slots match the mockup: Speed, Distance to go, Last ping, ETA.

With no reading, all four render a "No signal" state rather than zeroes. A
`0 km/h` on a truck that is actually moving is worse than an honest blank.

With a live reading, speed and last ping come from it. With a stale reading only
last ping is shown, because an old speed is meaningless; see the staleness table
below. Distance to go and ETA stay blank in every case until TomTom Routing
exists. A straight-line haversine to a postcode is not a road distance and would
be quietly wrong.

**`position.ts`** is the entire TomTom surface.

```ts
type PositionReading = {
  vehicleId: string;
  lat: number;
  lng: number;
  speedKph: number;
  headingDeg: number | null;
  recordedAt: string;
};

function getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>>;
```

Today's adapter reads the newest row per vehicle from `telematics_positions`,
falling back to `vehicle_locations`, both tenant-filtered through
`tenant.filterByTenant` exactly as the rest of the page is.

**What the seam does and does not buy, stated precisely, because it is the
justification for the whole shape of this change.**

What it does buy, and this is the real value: the four `lib/tracking/` modules
and all five components read a `PositionReading` and nothing else. Not one of
them changes on the day a live feed lands. Every question about staleness,
speed wording, ping wording, the live timeline node and the map marker is
already decided against that one type.

What it does not buy is a one-file swap. `page.tsx` constructs
`createSupabasePositionSource` directly, so choosing a different adapter is an
edit to the page. And because `page.tsx` is `"use client"`, a real TomTom key
cannot live in a client-side adapter: a live feed needs a server route holding
the key, a fetch adapter implementing `PositionSource` against it, and the page
wired to use it. Three files, not one. The seam makes those three files the
whole blast radius, which is the claim worth making.

**Staleness is a first-class state.** A reading older than 10 minutes is stale,
not live. The mockup renders a pulsing green "Live GPS" pill, and showing that
over a three-hour-old fix is the page lying to a dispatcher. Three states
throughout:

| State | Condition | Pill | Telemetry | Map card |
| --- | --- | --- | --- | --- |
| No signal | no row for this vehicle | grey, "No GPS" | blank | placeholder |
| Stale | reading over 10 minutes old | amber, "Last seen 2h ago", no pulse | speed suppressed, ping shown | placeholder |
| Live | reading under 10 minutes old | green, pulsing, "Live GPS" | populated | live |

Every vehicle is in the first state on the day this ships. That is the expected
outcome, and the page should read as a working console awaiting a feed rather
than a broken one.

### Components: `app/tracking/`

- **`page.tsx`** owns the Supabase query, the poll, selected-job state and the
  three load states. Target under 200 lines, matching `app/pod/page.tsx`.
- **`TrackingRail.tsx`**, the 300px queue. Rows show plate, phase badge, driver,
  `collection town -> delivery town`, and the scheduled date.
- **`TrackingHeader.tsx`**, plate, phase badge, GPS pill, call link, job link,
  subtitle line, route glyph, four telemetry tiles.
- **`TrackingMap.tsx`**, the map card. Renders only its placeholder today.
- **`JourneyTimeline.tsx`** and **`ActivityFeed.tsx`**.

Reused unchanged: `RouteProgress` for the header route glyph, plus `Badge`,
`Card` and `Button` from `components/`. `TenantGate` and
`tenant.filterByTenant` stay exactly as they are, so tenant isolation is
unchanged by this work.

### The map card

Props are `stops` and an optional `reading`, which are already the props a real
TomTom Maps mount needs. Today it renders a bordered panel at a fixed 260px with
a centred message: "Vehicle positions appear here once telematics is connected."
Not a spinner, and not a fake map image. Wiring TomTom later changes this one
component's internals only.

## Composition

Root is `<TenantGate>` wrapping `<main className="ds font-sans bg-canvas text-ink">`,
following the three-step conversion procedure in `lib/nav/themeableRoutes.ts`:
tokenise the colours, add the class to the root element, add `/tracking` to
`THEMEABLE_ROUTES`.

A page header carries the title, the on-the-road count, and a footnote line with
the last refresh time. Below it, `grid-cols-[300px_minmax(0,1fr)] gap-4 items-start`,
the mockup's proportions and the same shape `/pod` uses. The detail column stacks
header, map, journey and activity cards, each a `Card` with standard border,
radius and shadow tokens.

Below 1024px the grid collapses to one column with the rail on top, capped at
roughly 40vh with its own scroll. Dispatchers work on desktop, so one breakpoint
is the right amount of responsive.

Three page-level states, matching `/pod`: a skeleton while loading, an error card
with a retry when the query fails, and an empty state reading "No jobs on the
road" with a line explaining that assigned jobs appear once they are due. That
empty state is what most people will see on day one, so it must read as calm and
correct.

## Accessibility

- The pulsing GPS dot and the pulsing current-stop marker both animate
  infinitely in the mockup, which has no guard. Both are wrapped in
  `@media (prefers-reduced-motion: reduce)` so they hold still.
- Rail rows are real `<button>` elements with `aria-current="true"` on the
  selected one, as the mockup already does correctly.
- "Call driver" is an `<a href="tel:...">` rather than a button, using
  `drivers.phone`. When the job is subcontracted or the phone is missing the
  control is omitted rather than rendered dead.
- Colour is tokens only, so `lib/theme/contrast.test.ts` continues to cover this
  page for free.

## Fixes carried by the rewrite

Three defects in the current page, fixed because leaving them would be knowingly
shipping them:

1. The existing query pulls every row `vehicle_locations` has ever held,
   unbounded and unpaginated, then does a client-side `.find()` per vehicle. It
   grows without limit. The replacement fetches the latest row per vehicle only.
2. It destructures `data` and discards `error`, so a failed load renders as an
   empty table with no explanation. The new page carries the
   `loading` / `loaded` / `error` triad `/pod` uses, with a retry.
3. The 10 second poll becomes 30 seconds, matching the mockup's own footnote,
   and pauses while the tab is hidden so a forgotten background tab stops
   issuing queries.

## Testing

One Vitest file per `lib/tracking/` module:

- **`onTheRoad`**: no vehicle assigned, completed job, future `scheduled_date`,
  every delivery stop already delivered, and each of the three phase boundaries
  around midnight.
- **`journey`**: current-node selection, all stops done, a single-stop job, and a
  stop with a null `planned_at`.
- **`activity`**: ordering, and a job with nothing but a `created_at`.
- **`telemetry`**: no reading, stale reading, live reading.
- **`position`**: `telematics_positions` preferred, `vehicle_locations` fallback,
  empty result.

Plus `tests/tracking-layout.spec.mjs`, mirroring `tests/pod-layout.spec.mjs`.
That file exists because two overlap bugs shipped or nearly shipped in one day
and its header is blunt that reading CSS is not sufficient evidence. A four-card
detail column beside a fixed 300px rail is exactly that class of risk. It follows
the same local-only Playwright setup, run against a dev-login URL, and stays out
of the root `package.json`.

## Out of scope

Named explicitly so the plan does not drift into them:

- Any TomTom network call, API key, or key-handling decision.
- A migration adding real job statuses (`in_transit`, `loading`, `late`).
- Writing `audit_logs`.
- A delivery-window column on `job_stops`.
- Any change to `PodRail`, `PodQueue` or a shared rail abstraction. Two rails
  with slightly different needs is not yet enough evidence for one.

## Follow-ups this design implies

Not commitments, just the things it makes visible:

1. **Real job statuses.** The three-phase derivation is honest but coarse. A
   status column driven by the driver app would let the rail distinguish loading
   from moving. That needs its own spec, and swapping it in touches
   `onTheRoad.ts` only.
2. **TomTom adapters.** Webfleet for positions, Routing for distance and ETA,
   Maps for tiles. Only the first of the three has an interface waiting for it,
   and even that one is three files rather than a drop-in: a server route
   holding the key, a fetch adapter implementing `PositionSource`, and the line
   in `page.tsx` that picks the adapter.

   Routing has **no** interface at all. `telemetry.ts` hardcodes the Distance
   and ETA tiles as blanks carrying `ROUTING_HINT`, so wiring routing means
   changing `telemetryTiles`' signature to accept a route estimate and updating
   its callers and its tests. That is a small change, but it is a design
   decision this spec has not made, and calling it "behind an interface this
   change defines" would be untrue.

   Maps likewise: `TrackingMap.tsx` already takes the props a real mount needs,
   which is as far as it goes.
3. **A collection-done signal.** Nothing currently prompts a driver to mark a
   collection, which is why the rail predicate cannot use one.
