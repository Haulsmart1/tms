# Proof of delivery, Console redesign: design

Date: 2026-08-13
Status: approved (Ethan, 2026-08-13)

## Problem

A new Claude Design project, `TMSWizzard Dashboard Mockups`
(`212e97f0-1818-4941-9d4c-3e741869887f`), defines an expanded Console design system: 19
components, a Lucide icon set, an IBM Plex Sans + Mono type scale, and a "plotted route" brand
motif. Ethan wants it applied to the app.

Applying it wholesale is not one piece of work. This spec covers a single vertical slice,
`/pod`, chosen deliberately for reasons recorded under Decisions.

Two facts shape everything here:

- **The design has no dark theme.** Its manifest reports `"themes": []` and its tokens are
  light-first (`--surface-canvas: #f2f4f8`, `--surface-card: #ffffff`). That is the palette
  demoted from `:root` earlier the same day by
  `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md`.
- **The design's screens are not this app's screens.** Its UI kit covers login, dispatch board,
  order detail and fleet. The August spec already recorded that Console mockup inventions
  (assign dialog, order-detail route, filter bar) have no equivalent in the real data model and
  were cut during planning. That lesson is applied here rather than relearned.

## Goals

- Bring the Console visual language to `/pod`: mono for operational data, kicker labels, dense
  bordered tables, status pills, the route motif.
- Turn `/pod` from a job-first list into a stop-first work queue, which is what the page is
  actually for.
- Do it on the dark palette already shipped, without reverting any of it.
- Move `/pod` from legacy-pinned to theme-following, exercising the activation switch built
  earlier today for the first time on a real page.

## Non-goals

- **No change to `savePod`, `uploadFile`, or the delivered-cascade.** The JSX around them is
  rewritten; they are not.
- **Orphaned POD files on re-upload stay unfixed**, as recorded in the August spec.
- **No tenant re-check added** to the `job_stops` update. It relies on RLS, consistent with the
  rest of the app.
- **No schema change.** Nothing is added to `job_stops` or `jobs`.
- **No "missed" status.** See Decisions.
- **No component built that this page does not use.** `Toast`, `ToastStack`, `Tooltip`,
  `Switch` and `Select` are in the design system and are deliberately not built here.
- The other 18 routes are out of scope. This is one slice.

## Decisions

Seven decisions were settled with Ethan before this was written.

| # | Decision | Reasoning |
|---|---|---|
| 1 | Keep dark default; take the design's structure, not its palette | The design is treated as visual language (type, density, motif, components) and its colour roles are mapped onto the tokens already shipped. The control-room brief that drove the dark work still holds, and a mockup being light is not an argument against it. |
| 2 | Vertical slice first, not a component library | Build only what one real page needs. The August spec specced `Drawer`, `AssignDialog` and a `Toast` stack, then cut all three once someone read the real page. Slicing prevents a repeat. |
| 3 | The slice is `/pod` | Ethan's choice. It is also the best fit for the route motif, since `job_stops` is literally a route with waypoints and arrival states, and it is a legacy page, so it exercises the activation switch. |
| 4 | Stop-first work queue, not a job-first list | The page today lists every job with every stop, including collection stops that have no POD form and jobs already completed. A dispatcher wants the pending queue. |
| 5 | Awaiting / Completed tabs | A queue of "awaiting only" would remove the ability to correct a POD after delivery, which the page has today (the form renders for every delivery stop regardless of `pod_status`). Tabs preserve every existing capability. |
| 6 | The route motif goes in the table row, not the detail panel | Ethan's call, against the readme's "one motif per view, used sparingly". Defensible: shrunk to a ~68px glyph in a cell it is a status column, not decoration, and the readme calls dense tables the system's workhorse. The arrowhead colour carries state so the column reads at a glance. |
| 7 | Drop "missed" | No such status exists. `jobs.status` holds only `planned` or `completed`; `job_stops.pod_status` is `delivered` or not. "Overdue > 48h" already carries the meaning and is honestly derived from elapsed time. |

Also dropped during design: an "Invoiced this week" figure on the revenue card. It was the only
number on the page needing a separate `invoices` read, and it was not taken up. Excluded rather
than left ambiguous.

## Architecture

### Layout

Page content is capped at **1480px and centred**, sized for the 1080p monitor this is used on:
1920 wide, less the 220px sidebar and page gutters, leaves roughly 1650px.

```
[ rail 400px ] [ gap 24px ] [ main 1056px ]
```

**Left rail (400px), two cards:**

- **Revenue awaiting POD.** The sum of `jobs.customer_price` across jobs with a stop awaiting
  POD, framed as "delivered work that cannot be invoiced yet", split into overdue (>48h) and
  under-48h with a proportional bar each. This framing is the point: it turns POD from an admin
  chore into a number with money attached.
- **Needs attention.** A list, not a banner, so it holds every problem job rather than only the
  worst. Each entry names the job, destination, waiting time, and what is missing
  ("no photo, no document"). Colour-coded left border: red past 48h, amber under.

**Main column (1056px):** three KPI tiles (Awaiting POD, Delivered today, Overdue > 48h), the
Awaiting / Completed tabs, then the queue.

Below 1280px the two columns stack with the **queue first** and the rail beneath it, because
the queue is the work and the rail is context.

### The queue table

Extends the existing `components/DataTable.tsx` rather than adding a parallel component. It
already carries the loading, error, empty and ready states plus row-click and keyboard
handling, all of which this page wants. Two additions:

- `columns[].width?: string`, emitted as a `<colgroup>` with `table-layout: fixed`.
- `renderExpanded?: (row: T) => ReactNode` with an `expandedKey`, rendered as a following
  `<tr>` containing a single `<td colSpan={columns.length}>`.

Both are additive and optional, so existing consumers are unaffected.

Columns, all fixed width. These are `<colgroup>` widths, so they are **inclusive of cell
padding**, unlike the mockup, which used a CSS grid with separate gaps. They sum to 1056:

| Column | Width | Content |
|---|---|---|
| Job | 84px | `jobs.reference`, mono |
| Route | 320px | `Leeds → Hull`, with postcode and customer beneath in mono |
| Progress | 92px | `RouteProgress` glyph |
| Vehicle & driver | 232px | Registration in mono, model and driver beneath |
| Evidence | 128px | Filled or hollow dot per `pod_photo_url` / `pod_document_url` |
| Status | 200px | Status pill, waiting time beneath, right-aligned |

The **Evidence** column answers the question the queue exists to answer, which is what a given
POD is actually waiting for, without opening the row. Both fields are already loaded.

### `RouteProgress`

Nodes plus an arrowhead at a fixed 68px. A four-stop job compresses the dotted spans rather
than widening the column. Node filled when that stop is delivered, hollow ringed when it is the
one awaiting POD, and the arrowhead carries state by colour: amber pending, red overdue, green
delivered. Driven entirely by `job_stops` ordered by `stop_order`, using `pod_status` and
`delivered_at`. Display only.

### The expanded panel

Capped at **620px**. Recipient, notes, the two upload cards, and the existing Save edit and
Mark delivered buttons. Nothing about their behaviour changes. A recipient-name input has no
business being 1000px wide, which is the same mistake as a table column with nowhere to put its
slack.

### Components

Four new: `Tabs`, `Card`, `Icon` (Lucide is already a dependency), `RouteProgress`.

Existing components, precisely:

- `DataTable` gains the two additive optional props above.
- `Field` and `Textarea` gain an optional kicker-style label, since the Console language puts an
  11px uppercase label above an input rather than a 14px sentence-case one.
- `Badge` and `Button` are already token-driven and are expected to need no change at all. The
  same expectation held for them in the August work and proved correct. The plan confirms it by
  reading them rather than assuming.

### Foundation

Type tokens the design has and this app does not: `--text-kicker` (11px/16px, 600, uppercase,
0.08em tracking), `--text-data-md` (500 13px/18px mono), `--text-data-sm` (500 12px/16px mono),
and `--tabular` (`'tnum' 1, 'zero' 1`) for figures that line up in columns.

These go into **all three token blocks** in `app/tokens.css`. `lib/theme/contrast.test.ts`
asserts the blocks declare identical key sets, so a missed one fails the build rather than
silently inheriting.

### Pure logic

The genuinely new decision-making code goes to `lib/pod/` as pure functions with unit tests,
not inline in the page. Vitest only collects `lib/**/*.test.ts`, so anything left in the
component is untestable by construction.

- `splitStops(jobs)` → awaiting and completed delivery stops
- `waitingTime(stop, now)` → elapsed since `planned_at`
- `podKpis(jobs, now)` → the four figures, including the revenue split
- `attentionItems(jobs, now)` → the needs-attention list, sorted oldest first
- `routeNodes(job)` → the node and arrowhead states `RouteProgress` renders

`now` is injected rather than read inside, so the tests are not time-dependent.

### Data

One query change, additive and read-only, through the same `filterByTenant`:
`job_stops.planned_at`, `jobs.customer_price`, and the vehicle and driver joins. No new write
path and no new RLS surface.

### Activation

`/pod` is added to `THEMEABLE_ROUTES` in `lib/nav/themeableRoutes.ts`, so `ThemeScope` stops
pinning it dark and it follows the theme. This is the first real use of that mechanism.

## Overlap and layout verification

Ethan asked specifically that the final pass carry no strange overlapping parts. This has bitten
the project twice in one day: job-form fields overlapping by 25 to 57 pixels with ordinary data,
and a several-hundred-pixel gap in the first mockup of this very table. Both were invisible in
the source and obvious the moment something rendered and measured them. So this is a
requirement with a test, not an intention.

**Rules:**

- No queue column flexes. Every width is fixed, via `<colgroup>` and `table-layout: fixed`.
  A flexible column dumps all leftover width in one place, which is exactly how the first gap
  appeared.
- Every cell that can hold long content (route, customer, vehicle, driver) truncates:
  `min-w-0` plus `truncate`. Long values ellipsize rather than overflow into the next column.
  This is the same `min-width: auto` mechanism that caused the job-form overlap.
- The table keeps `overflow-x-auto` with `min-width` set to the column sum, so a narrow viewport
  scrolls rather than collapsing columns into each other.
- The expanded panel is capped at 620px and the page at 1480px.

**Test:** a Playwright check, rendering `/pod` against the real compiled CSS at 1920, 1440,
1280, 900 and 375 wide, asserting for each that no element's bounding box extends beyond its
container's right edge, and that no two sibling cells in a row have intersecting boxes. Run with
realistic worst-case data: a long customer name, a four-stop job, a long driver name.

## Known risks

- **`job_stops.planned_at` is unverified.** The August spec references it but the POD query does
  not select it, and the "Overdue > 48h" tile and waiting times depend on it. Verify it exists
  before relying on it. If it does not, stop and raise it rather than silently substituting
  `jobs.scheduled_date`, which means something different.
- **Completed work leaves the default view.** This is the change dispatchers will notice. It is
  reachable via the Completed tab, but it is a workflow change and worth telling them rather
  than shipping silently.
- **This is the riskiest page to have picked**, because it carries file uploads and the cascade
  that flips `jobs.status`. That is why those functions are untouched and why the new logic is
  isolated in `lib/pod/`.

## Verification

- `npm run typecheck`, `npm run build`, `npm test` clean.
- Unit tests for every function in `lib/pod/`, including the awaiting/completed split, the
  revenue figures, and `routeNodes` for one-stop, two-stop and four-stop jobs.
- The contrast test picks up the new type tokens automatically and must stay green.
- The overlap test above, at all five widths.
- Manual, signed in: upload a photo and a document, save an edit, mark a stop delivered, and
  confirm the delivered-cascade still flips the job to completed when the last delivery stop
  lands. Confirm the stop then moves from Awaiting to Completed.
- Manual: toggle to light on `/pod` and confirm it now follows the theme rather than staying
  pinned dark.

## Open questions

None. The seven decisions above are settled, and the two items raised during design that were
not taken up ("missed", "Invoiced this week") are recorded as dropped rather than deferred.
