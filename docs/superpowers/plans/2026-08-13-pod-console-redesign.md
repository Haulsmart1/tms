# POD Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/pod` as a stop-first work queue in the Console visual language, on the dark palette already shipped, without touching any write path.

**Architecture:** All decision-making logic lives in `lib/pod/` as pure, unit-tested functions with `now` injected. The page composes three presentational pieces (rail, queue, form) over the existing `DataTable`, extended with fixed column widths and expandable rows. `/pod` joins `THEMEABLE_ROUTES`, so it stops being pinned dark and follows the theme.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 3 (Preflight off, tokens via CSS variables), Vitest (`lib/**/*.test.ts`, node env), Playwright for the layout check, lucide-react (already a dependency).

**Spec:** `docs/superpowers/specs/2026-08-13-pod-console-redesign-design.md`

**Branch:** `feat/pod-console-redesign` (exists; spec committed at `45b5c2e`).

---

## Deviations from the spec, decided while planning

**1. No `Icon` component.** The spec lists four new components including `Icon`. Dropping it. `lucide-react` is already a direct dependency and `app/components/AppShell.tsx:5-9` already imports icons directly. A wrapper would add indirection with no benefit; the design system only has one because its own bundle bakes icon paths. Three new components, not four.

**2. There is no existing 48h threshold to share.** The spec says the overdue rule must be shared with the dashboard. On reading `app/dashboard/page.tsx:114-116` and `lib/dashboard/aggregate.ts:14-20`, the dashboard applies **no** threshold at all: every awaiting POD enters needs-attention, sorted by age. So this plan extracts the two things that genuinely exist and are duplicated (the age calculation, and the predicate for "awaiting POD"), and introduces `POD_OVERDUE_HOURS` as new, in the shared module so the dashboard can adopt it later.

**3. The `jobs.status === "planned"` filter applies to Awaiting only.** The dashboard's awaiting set is `type = delivery`, `pod_status != delivered`, **and** `jobs.status === "planned"` (`page.tsx:94-96`). POD's Awaiting tab matches it so the counts agree. The Completed tab must NOT apply it, because delivered stops live on completed jobs and the filter would empty the tab.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `lib/pod/overdue.ts` | The shared rule: `podAgeHours`, `isAwaitingPod`, `isPodOverdue`, `POD_OVERDUE_HOURS`. The one definition both pages consume. |
| `lib/pod/overdue.test.ts` | Tests, including one asserting the dashboard and POD classify the same stop identically. |
| `lib/pod/queue.ts` | `splitDeliveryStops` into awaiting and completed, sorted; `waitingLabel` for display. |
| `lib/pod/queue.test.ts` | Tests. |
| `lib/pod/kpis.ts` | `podKpis` (the three tiles plus the revenue split) and `attentionItems`. |
| `lib/pod/kpis.test.ts` | Tests. |
| `lib/pod/routeNodes.ts` | `routeNodes(stops)` returning the node and arrowhead states `RouteProgress` renders. |
| `lib/pod/routeNodes.test.ts` | Tests for one-stop, two-stop and four-stop jobs. |
| `components/Card.tsx` | The bordered surface used by the rail cards and the queue container. |
| `components/Tabs.tsx` | Awaiting / Completed. |
| `components/RouteProgress.tsx` | The plotted-route glyph. |
| `app/pod/PodRail.tsx` | Revenue card + needs-attention list. |
| `app/pod/PodQueue.tsx` | The queue table wiring columns to `DataTable`. |
| `app/pod/PodForm.tsx` | The expanded POD form, extracted from the current page. |
| `tests/pod-layout.spec.mjs` | The Playwright overlap check. |

**Modify:**

| File | Change |
|---|---|
| `app/tokens.css` | Four type tokens in all three blocks. |
| `tailwind.config.ts` | `fontSize` keys for kicker and the two data sizes. |
| `components/DataTable.tsx` | Optional `width` per column and `renderExpanded`. |
| `components/Field.tsx`, `components/Textarea.tsx` | Optional kicker-style label. |
| `lib/dashboard/aggregate.ts` | Consume `podAgeHours` instead of computing age inline. |
| `app/dashboard/page.tsx:114-116` | Consume `isAwaitingPod` instead of the inline predicate. |
| `app/pod/page.tsx` | Rewired onto the new pieces. Data fetch extended; write paths untouched. |
| `lib/nav/themeableRoutes.ts` | Add `/pod`. |

**Not touched:** `savePod`, `uploadFile`, the delivered-cascade, `app/components/PodLink.tsx`, any RLS policy, any schema.

---

## Task 1: The shared overdue rule

**Files:**
- Create: `lib/pod/overdue.ts`, `lib/pod/overdue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/pod/overdue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { podAgeHours, isAwaitingPod, isPodOverdue, POD_OVERDUE_HOURS } from "./overdue";

const NOW = new Date("2026-08-13T12:00:00Z");

describe("podAgeHours", () => {
  it("returns elapsed hours since planned_at", () => {
    expect(podAgeHours("2026-08-13T08:00:00Z", NOW)).toBeCloseTo(4, 5);
    expect(podAgeHours("2026-08-11T12:00:00Z", NOW)).toBeCloseTo(48, 5);
  });

  it("returns null for a null planned_at rather than a misleading number", () => {
    // planned_at is nullable: app/jobs/page.tsx only sets it when the job has a
    // scheduled_date. Returning 0 or Infinity here would silently make undated
    // jobs look either fresh or maximally overdue.
    expect(podAgeHours(null, NOW)).toBeNull();
  });

  it("returns null for an unparseable date rather than NaN", () => {
    expect(podAgeHours("not-a-date", NOW)).toBeNull();
  });
});

describe("isAwaitingPod", () => {
  const awaiting = { type: "delivery", pod_status: "pending", jobStatus: "planned" };

  it("is true for a planned job's undelivered delivery stop", () => {
    expect(isAwaitingPod(awaiting)).toBe(true);
  });

  it("is false for collection stops, which have no POD form", () => {
    expect(isAwaitingPod({ ...awaiting, type: "collection" })).toBe(false);
  });

  it("is false once the stop is delivered", () => {
    expect(isAwaitingPod({ ...awaiting, pod_status: "delivered" })).toBe(false);
  });

  it("is false when the job is no longer planned, matching the dashboard", () => {
    // app/dashboard/page.tsx:94-96 filters overdue POD stops to jobs.status
    // === "planned". POD must apply the same predicate or the two pages will
    // report different counts for the same data.
    expect(isAwaitingPod({ ...awaiting, jobStatus: "completed" })).toBe(false);
  });

  it("treats a missing pod_status as awaiting, since the column is nullable", () => {
    expect(isAwaitingPod({ ...awaiting, pod_status: null })).toBe(true);
  });
});

describe("isPodOverdue", () => {
  it("is true past the threshold", () => {
    expect(isPodOverdue("2026-08-11T11:00:00Z", NOW)).toBe(true);
  });

  it("is false at exactly the threshold, so the boundary is not double-counted", () => {
    expect(isPodOverdue("2026-08-11T12:00:00Z", NOW)).toBe(false);
  });

  it("is false when planned_at is null", () => {
    expect(isPodOverdue(null, NOW)).toBe(false);
  });
});

describe("POD_OVERDUE_HOURS", () => {
  it("is 48", () => {
    expect(POD_OVERDUE_HOURS).toBe(48);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/pod/overdue.test.ts`
Expected: FAIL, cannot resolve `./overdue`.

- [ ] **Step 3: Write the implementation**

Create `lib/pod/overdue.ts`:

```ts
/* The single definition of "awaiting POD" and "how old is it".
   
   Both /pod and /dashboard answer these questions about the same rows. When
   they answered them separately, they could disagree about the same stop, which
   is the kind of inconsistency nobody reports and everybody quietly stops
   trusting. lib/dashboard/aggregate.ts and app/dashboard/page.tsx both consume
   this module. */

/** Hours past planned_at before a POD counts as overdue. */
export const POD_OVERDUE_HOURS = 48;

export type AwaitingInput = {
  type: string | null;
  pod_status: string | null;
  /** jobs.status for the stop's parent job. */
  jobStatus: string | null;
};

/* planned_at is NOT a real planned time: app/jobs/page.tsx writes it as
   `${scheduled_date}T08:00:00`, a derived 8am stamp. Ages are therefore
   accurate to the day, not the hour. It is also null whenever the job has no
   scheduled_date, which is why this returns null rather than a number: a
   caller that wants to treat undated stops as fresh, or as ancient, has to say
   so explicitly instead of inheriting whichever we happened to pick. */
export function podAgeHours(plannedAt: string | null, now: Date): number | null {
  if (!plannedAt) return null;
  const t = new Date(plannedAt).getTime();
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 36e5;
}

/* Mirrors app/dashboard/page.tsx's awaiting set exactly: a delivery stop, not
   yet delivered, on a job still marked planned. The job-status condition looks
   redundant because the delivered-cascade only completes a job once every
   delivery stop is delivered, so the excluded set should normally be empty.
   Keeping it means the two pages agree even when the data is not normal. */
export function isAwaitingPod(input: AwaitingInput): boolean {
  return (
    input.type === "delivery" &&
    input.pod_status !== "delivered" &&
    input.jobStatus === "planned"
  );
}

export function isPodOverdue(plannedAt: string | null, now: Date): boolean {
  const age = podAgeHours(plannedAt, now);
  return age !== null && age > POD_OVERDUE_HOURS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pod/overdue.test.ts`
Expected: PASS, 12 tests (3 for `podAgeHours`, 5 for `isAwaitingPod`, 3 for `isPodOverdue`, 1 for the constant).

- [ ] **Step 5: Commit**

```bash
git add lib/pod/overdue.ts lib/pod/overdue.test.ts
git commit -m "feat: add the shared awaiting-POD and age rule"
```

---

## Task 2: Point the dashboard at the shared rule

Proves the rule is genuinely shared rather than a second copy.

**Files:**
- Modify: `lib/dashboard/aggregate.ts:18`, `app/dashboard/page.tsx:94-96,114-116`

- [ ] **Step 1: Add a test asserting both pages agree**

Append to `lib/pod/overdue.test.ts`:

```ts
import { buildNeedsAttention } from "../dashboard/aggregate";

describe("dashboard and POD agree about the same stop", () => {
  it("computes the same age for a stop as buildNeedsAttention reports", () => {
    const plannedAt = "2026-08-11T08:00:00Z";
    const [item] = buildNeedsAttention(
      [{ stopId: "s1", jobRef: "J-1", plannedAt }],
      [],
      NOW,
    );
    expect(item.ageHours).toBeCloseTo(podAgeHours(plannedAt, NOW)!, 10);
  });
});
```

- [ ] **Step 2: Run it to verify it passes even before the refactor**

Run: `npx vitest run lib/pod/overdue.test.ts`
Expected: PASS. It passes now because both compute the same arithmetic independently. That is the point: the test locks the agreement in place so the refactor cannot silently break it, and so a future edit to either side fails loudly.

- [ ] **Step 3: Refactor `lib/dashboard/aggregate.ts` to consume the shared function**

Add the import at the top:

```ts
import { podAgeHours } from "../pod/overdue";
```

Replace line 18 (`ageHours: (now.getTime() - new Date(p.plannedAt).getTime()) / 36e5,`) with:

```ts
    // Shared with /pod so the two pages cannot disagree. Non-null asserted
    // because the caller filters null planned_at before mapping (see
    // app/dashboard/page.tsx and isAwaitingPod).
    ageHours: podAgeHours(p.plannedAt, now)!,
```

- [ ] **Step 4: Refactor `app/dashboard/page.tsx` to consume the shared predicate**

Add to the imports:

```tsx
import { isAwaitingPod } from "../../lib/pod/overdue";
```

Replace lines 94-96:

```tsx
      const overduePodStops = (overduePodStopsRaw ?? []).filter(
        (r: any) => r.jobs?.status === "planned",
      );
```

with:

```tsx
      // The query already restricts to delivery stops that are not delivered;
      // isAwaitingPod re-states the whole predicate in one place so /pod and
      // this page cannot drift apart. Kept client-side rather than as a
      // PostgREST embedded-relation filter, matching this codebase's existing
      // convention (see app/invoices/page.tsx).
      const overduePodStops = (overduePodStopsRaw ?? []).filter((r: any) =>
        isAwaitingPod({
          type: "delivery",
          pod_status: r.pod_status ?? null,
          jobStatus: r.jobs?.status ?? null,
        }),
      );
```

The query at line 64-70 selects `id, planned_at, jobs ( reference, status )` but not `pod_status`. Add it, since `isAwaitingPod` now reads it:

```tsx
          .select("id, planned_at, pod_status, jobs ( reference, status )")
```

- [ ] **Step 5: Verify nothing regressed**

Run: `npm test && npm run typecheck && npm run build`
Expected: all clean. `lib/dashboard/aggregate.test.ts` must still pass unchanged; if it does not, the refactor changed behaviour and must be corrected rather than the test adjusted.

- [ ] **Step 6: Commit**

```bash
git add lib/pod/overdue.test.ts lib/dashboard/aggregate.ts app/dashboard/page.tsx
git commit -m "refactor: dashboard consumes the shared awaiting-POD rule"
```

---

## Task 3: Queue splitting and waiting labels

**Files:**
- Create: `lib/pod/queue.ts`, `lib/pod/queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/pod/queue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitDeliveryStops, waitingLabel, type PodJob } from "./queue";

const NOW = new Date("2026-08-13T12:00:00Z");

const job = (over: Partial<PodJob> = {}): PodJob => ({
  id: "j1",
  reference: "J-1042",
  status: "planned",
  scheduled_date: "2026-08-11",
  customer_name: "Northern Freight",
  vehicle_registration: "MV-12-TRP",
  vehicle_model: "Scania R450",
  driver_name: "A. Okafor",
  customer_price: 1200,
  stops: [
    { id: "s1", stop_order: 1, type: "collection", city: "Leeds", postcode: "LS1 4AP",
      pod_status: "delivered", planned_at: "2026-08-11T08:00:00Z", delivered_at: "2026-08-11T09:00:00Z",
      pod_photo_url: null, pod_document_url: null },
    { id: "s2", stop_order: 2, type: "delivery", city: "Hull", postcode: "HU1 2BG",
      pod_status: "pending", planned_at: "2026-08-11T08:00:00Z", delivered_at: null,
      pod_photo_url: null, pod_document_url: "doc.pdf" },
  ],
  ...over,
});

describe("splitDeliveryStops", () => {
  it("puts an undelivered delivery stop in awaiting", () => {
    const { awaiting, completed } = splitDeliveryStops([job()], NOW);
    expect(awaiting.map((r) => r.stopId)).toEqual(["s2"]);
    expect(completed).toEqual([]);
  });

  it("excludes collection stops from both lists", () => {
    const { awaiting, completed } = splitDeliveryStops([job()], NOW);
    expect([...awaiting, ...completed].some((r) => r.stopId === "s1")).toBe(false);
  });

  it("puts a delivered delivery stop in completed regardless of job status", () => {
    const j = job({ status: "completed" });
    j.stops[1] = { ...j.stops[1], pod_status: "delivered", delivered_at: "2026-08-12T10:00:00Z" };
    const { awaiting, completed } = splitDeliveryStops([j], NOW);
    expect(awaiting).toEqual([]);
    expect(completed.map((r) => r.stopId)).toEqual(["s2"]);
  });

  it("drops an undelivered stop whose job is completed, matching the dashboard", () => {
    // Anomalous data: the delivered-cascade should make this impossible. It is
    // excluded here for the same reason the dashboard excludes it, so the two
    // pages report the same count.
    const { awaiting } = splitDeliveryStops([job({ status: "completed" })], NOW);
    expect(awaiting).toEqual([]);
  });

  it("sorts awaiting oldest first, with null planned_at last", () => {
    const a = job({ id: "a", reference: "J-A" });
    a.stops[1] = { ...a.stops[1], id: "sa", planned_at: "2026-08-12T08:00:00Z" };
    const b = job({ id: "b", reference: "J-B" });
    b.stops[1] = { ...b.stops[1], id: "sb", planned_at: "2026-08-09T08:00:00Z" };
    const c = job({ id: "c", reference: "J-C" });
    c.stops[1] = { ...c.stops[1], id: "sc", planned_at: null };
    const { awaiting } = splitDeliveryStops([a, b, c], NOW);
    expect(awaiting.map((r) => r.stopId)).toEqual(["sb", "sa", "sc"]);
  });

  it("carries the fields the row renders", () => {
    const { awaiting } = splitDeliveryStops([job()], NOW);
    expect(awaiting[0]).toMatchObject({
      stopId: "s2",
      jobReference: "J-1042",
      customerName: "Northern Freight",
      originCity: "Leeds",
      destinationCity: "Hull",
      destinationPostcode: "HU1 2BG",
      vehicleRegistration: "MV-12-TRP",
      driverName: "A. Okafor",
      hasPhoto: false,
      hasDocument: true,
      isOverdue: true,
    });
    expect(awaiting[0].ageHours).toBeCloseTo(52, 0);
  });

  it("reports no origin when a job has no collection stop", () => {
    const j = job();
    j.stops = [j.stops[1]];
    const { awaiting } = splitDeliveryStops([j], NOW);
    expect(awaiting[0].originCity).toBeNull();
  });
});

describe("waitingLabel", () => {
  it("formats days and hours", () => {
    expect(waitingLabel(52)).toBe("2 d 4 h");
  });

  it("formats hours alone under a day", () => {
    expect(waitingLabel(3.4)).toBe("3 h");
  });

  it("formats minutes under an hour, so a fresh stop does not read as 0 h", () => {
    expect(waitingLabel(0.5)).toBe("30 m");
  });

  it("returns a dash when the age is unknown", () => {
    expect(waitingLabel(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/pod/queue.test.ts`
Expected: FAIL, cannot resolve `./queue`.

- [ ] **Step 3: Write the implementation**

Create `lib/pod/queue.ts`:

```ts
import { isAwaitingPod, isPodOverdue, podAgeHours } from "./overdue";

export type PodStop = {
  id: string;
  stop_order: number;
  type: string | null;
  city: string | null;
  postcode: string | null;
  pod_status: string | null;
  planned_at: string | null;
  delivered_at: string | null;
  pod_photo_url: string | null;
  pod_document_url: string | null;
};

export type PodJob = {
  id: string;
  reference: string | null;
  status: string | null;
  scheduled_date: string | null;
  customer_name: string | null;
  vehicle_registration: string | null;
  vehicle_model: string | null;
  driver_name: string | null;
  customer_price: number | null;
  stops: PodStop[];
};

export type QueueRow = {
  stopId: string;
  jobId: string;
  jobReference: string;
  customerName: string;
  originCity: string | null;
  destinationCity: string;
  destinationPostcode: string;
  vehicleRegistration: string | null;
  vehicleModel: string | null;
  driverName: string | null;
  dropCount: number;
  hasPhoto: boolean;
  hasDocument: boolean;
  ageHours: number | null;
  isOverdue: boolean;
  deliveredAt: string | null;
  stops: PodStop[];
};

function firstCollectionCity(stops: PodStop[]): string | null {
  const c = [...stops].sort((a, b) => a.stop_order - b.stop_order)
    .find((s) => s.type === "collection");
  return c?.city ?? null;
}

function toRow(job: PodJob, stop: PodStop, now: Date): QueueRow {
  return {
    stopId: stop.id,
    jobId: job.id,
    jobReference: job.reference ?? "—",
    customerName: job.customer_name ?? "No customer",
    originCity: firstCollectionCity(job.stops),
    destinationCity: stop.city ?? "—",
    destinationPostcode: stop.postcode ?? "",
    vehicleRegistration: job.vehicle_registration,
    vehicleModel: job.vehicle_model,
    driverName: job.driver_name,
    dropCount: job.stops.filter((s) => s.type === "delivery").length,
    hasPhoto: Boolean(stop.pod_photo_url),
    hasDocument: Boolean(stop.pod_document_url),
    ageHours: podAgeHours(stop.planned_at, now),
    isOverdue: isPodOverdue(stop.planned_at, now),
    deliveredAt: stop.delivered_at,
    stops: [...job.stops].sort((a, b) => a.stop_order - b.stop_order),
  };
}

/* Awaiting applies the dashboard's full predicate, including jobs.status ===
   "planned", so the two pages report the same count. Completed deliberately
   does NOT: delivered stops live on completed jobs, so applying the job filter
   there would empty the tab. */
export function splitDeliveryStops(
  jobs: PodJob[],
  now: Date,
): { awaiting: QueueRow[]; completed: QueueRow[] } {
  const awaiting: QueueRow[] = [];
  const completed: QueueRow[] = [];

  for (const job of jobs) {
    for (const stop of job.stops) {
      if (stop.type !== "delivery") continue;

      if (stop.pod_status === "delivered") {
        completed.push(toRow(job, stop, now));
        continue;
      }
      if (isAwaitingPod({ type: stop.type, pod_status: stop.pod_status, jobStatus: job.status })) {
        awaiting.push(toRow(job, stop, now));
      }
    }
  }

  // Oldest first. Unknown age sorts last: an undated stop is not urgent, it is
  // unmeasured, and putting it at the top would push real problems down.
  awaiting.sort((a, b) => {
    if (a.ageHours === null) return 1;
    if (b.ageHours === null) return -1;
    return b.ageHours - a.ageHours;
  });
  completed.sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""));

  return { awaiting, completed };
}

export function waitingLabel(ageHours: number | null): string {
  if (ageHours === null) return "—";
  if (ageHours < 1) return `${Math.max(0, Math.floor(ageHours * 60))} m`;
  if (ageHours < 24) return `${Math.floor(ageHours)} h`;
  return `${Math.floor(ageHours / 24)} d ${Math.floor(ageHours % 24)} h`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pod/queue.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pod/queue.ts lib/pod/queue.test.ts
git commit -m "feat: split delivery stops into awaiting and completed queues"
```

---

## Task 4: KPI figures and the attention list

**Files:**
- Create: `lib/pod/kpis.ts`, `lib/pod/kpis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/pod/kpis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { podKpis, attentionItems } from "./kpis";
import type { QueueRow } from "./queue";

const NOW = new Date("2026-08-13T12:00:00Z");

const row = (over: Partial<QueueRow> = {}): QueueRow => ({
  stopId: "s1", jobId: "j1", jobReference: "J-1", customerName: "C",
  originCity: "Leeds", destinationCity: "Hull", destinationPostcode: "HU1",
  vehicleRegistration: "AB-12-CDE", vehicleModel: "DAF", driverName: "D",
  dropCount: 1, hasPhoto: false, hasDocument: false,
  ageHours: 10, isOverdue: false, deliveredAt: null, stops: [],
  ...over,
});

describe("podKpis", () => {
  it("counts awaiting stops", () => {
    const k = podKpis([row(), row({ stopId: "s2" })], [], new Map(), NOW);
    expect(k.awaiting).toBe(2);
  });

  it("counts stops delivered today only", () => {
    const completed = [
      row({ stopId: "c1", deliveredAt: "2026-08-13T09:00:00Z" }),
      row({ stopId: "c2", deliveredAt: "2026-08-12T09:00:00Z" }),
    ];
    expect(podKpis([], completed, new Map(), NOW).deliveredToday).toBe(1);
  });

  it("counts overdue stops", () => {
    const k = podKpis([row({ isOverdue: true }), row({ stopId: "s2" })], [], new Map(), NOW);
    expect(k.overdue).toBe(1);
  });

  it("sums job value once per job, not once per stop", () => {
    // A two-drop job has two awaiting stops but one customer_price. Summing per
    // stop would double-count the job's value.
    const prices = new Map([["j1", 1000]]);
    const k = podKpis([row({ stopId: "s1" }), row({ stopId: "s2" })], [], prices, NOW);
    expect(k.valueAwaiting).toBe(1000);
  });

  it("splits value into overdue and recent", () => {
    const prices = new Map([["j1", 800], ["j2", 200]]);
    const rows = [row({ jobId: "j1", isOverdue: true }), row({ jobId: "j2", stopId: "s2" })];
    const k = podKpis(rows, [], prices, NOW);
    expect(k.valueOverdue).toBe(800);
    expect(k.valueRecent).toBe(200);
    expect(k.valueAwaiting).toBe(1000);
  });

  it("treats a job with no price as zero rather than NaN", () => {
    const k = podKpis([row()], [], new Map(), NOW);
    expect(k.valueAwaiting).toBe(0);
  });
});

describe("attentionItems", () => {
  it("returns only overdue rows, oldest first", () => {
    const rows = [
      row({ stopId: "a", isOverdue: true, ageHours: 60 }),
      row({ stopId: "b", isOverdue: false, ageHours: 5 }),
      row({ stopId: "c", isOverdue: true, ageHours: 150 }),
    ];
    expect(attentionItems(rows).map((i) => i.stopId)).toEqual(["c", "a"]);
  });

  it("says what evidence is missing", () => {
    const [none] = attentionItems([row({ isOverdue: true })]);
    expect(none.missing).toBe("no photo, no document");

    const [photoOnly] = attentionItems([row({ isOverdue: true, hasPhoto: true })]);
    expect(photoOnly.missing).toBe("photo only");

    const [both] = attentionItems([row({ isOverdue: true, hasPhoto: true, hasDocument: true })]);
    expect(both.missing).toBe("evidence attached");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/pod/kpis.test.ts`
Expected: FAIL, cannot resolve `./kpis`.

- [ ] **Step 3: Write the implementation**

Create `lib/pod/kpis.ts`:

```ts
import type { QueueRow } from "./queue";

export type PodKpis = {
  awaiting: number;
  deliveredToday: number;
  overdue: number;
  valueAwaiting: number;
  valueOverdue: number;
  valueRecent: number;
};

function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/* jobPrices maps jobId to customer_price. Value is summed per JOB, not per
   stop: a two-drop job has two awaiting stops but one price, and summing per
   stop would report double the money actually at risk. A job counts as overdue
   value if ANY of its awaiting stops is overdue. */
export function podKpis(
  awaiting: QueueRow[],
  completed: QueueRow[],
  jobPrices: Map<string, number>,
  now: Date,
): PodKpis {
  const jobIsOverdue = new Map<string, boolean>();
  for (const r of awaiting) {
    jobIsOverdue.set(r.jobId, (jobIsOverdue.get(r.jobId) ?? false) || r.isOverdue);
  }

  let valueOverdue = 0;
  let valueRecent = 0;
  for (const [jobId, overdue] of jobIsOverdue) {
    const price = jobPrices.get(jobId) ?? 0;
    if (overdue) valueOverdue += price;
    else valueRecent += price;
  }

  return {
    awaiting: awaiting.length,
    deliveredToday: completed.filter((r) => r.deliveredAt && isSameLocalDay(r.deliveredAt, now)).length,
    overdue: awaiting.filter((r) => r.isOverdue).length,
    valueAwaiting: valueOverdue + valueRecent,
    valueOverdue,
    valueRecent,
  };
}

export type AttentionEntry = {
  stopId: string;
  jobReference: string;
  destinationCity: string;
  ageHours: number | null;
  missing: string;
};

export function attentionItems(awaiting: QueueRow[]): AttentionEntry[] {
  return awaiting
    .filter((r) => r.isOverdue)
    .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0))
    .map((r) => ({
      stopId: r.stopId,
      jobReference: r.jobReference,
      destinationCity: r.destinationCity,
      ageHours: r.ageHours,
      missing:
        r.hasPhoto && r.hasDocument
          ? "evidence attached"
          : r.hasPhoto
            ? "photo only"
            : r.hasDocument
              ? "document only"
              : "no photo, no document",
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pod/kpis.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pod/kpis.ts lib/pod/kpis.test.ts
git commit -m "feat: derive POD KPI figures and the attention list"
```

---

## Task 5: Route node states

**Files:**
- Create: `lib/pod/routeNodes.ts`, `lib/pod/routeNodes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/pod/routeNodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { routeNodes } from "./routeNodes";
import type { PodStop } from "./queue";

const stop = (over: Partial<PodStop>): PodStop => ({
  id: "s", stop_order: 1, type: "delivery", city: "X", postcode: "",
  pod_status: null, planned_at: null, delivered_at: null,
  pod_photo_url: null, pod_document_url: null,
  ...over,
});

describe("routeNodes", () => {
  it("marks delivered stops done and the focused stop current", () => {
    const stops = [
      stop({ id: "a", stop_order: 1, type: "collection", pod_status: "delivered" }),
      stop({ id: "b", stop_order: 2 }),
    ];
    expect(routeNodes(stops, "b", false)).toEqual({
      nodes: [
        { id: "a", state: "done" },
        { id: "b", state: "current" },
      ],
      arrowState: "pending",
    });
  });

  it("colours the arrowhead red when the focused stop is overdue", () => {
    const stops = [stop({ id: "a", stop_order: 1 })];
    expect(routeNodes(stops, "a", true).arrowState).toBe("overdue");
  });

  it("colours the arrowhead green once the focused stop is delivered", () => {
    const stops = [stop({ id: "a", stop_order: 1, pod_status: "delivered" })];
    expect(routeNodes(stops, "a", false).arrowState).toBe("delivered");
  });

  it("orders by stop_order regardless of input order", () => {
    const stops = [stop({ id: "b", stop_order: 2 }), stop({ id: "a", stop_order: 1 })];
    expect(routeNodes(stops, "b", false).nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("handles a four-stop job", () => {
    const stops = [1, 2, 3, 4].map((i) =>
      stop({ id: `s${i}`, stop_order: i, pod_status: i <= 2 ? "delivered" : null }),
    );
    const { nodes } = routeNodes(stops, "s3", false);
    expect(nodes.map((n) => n.state)).toEqual(["done", "done", "current", "upcoming"]);
  });

  it("handles a single-stop job", () => {
    const { nodes, arrowState } = routeNodes([stop({ id: "only", stop_order: 1 })], "only", false);
    expect(nodes).toEqual([{ id: "only", state: "current" }]);
    expect(arrowState).toBe("pending");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/pod/routeNodes.test.ts`
Expected: FAIL, cannot resolve `./routeNodes`.

- [ ] **Step 3: Write the implementation**

Create `lib/pod/routeNodes.ts`:

```ts
import type { PodStop } from "./queue";

export type NodeState = "done" | "current" | "upcoming";
export type ArrowState = "pending" | "overdue" | "delivered";

export type RouteNode = { id: string; state: NodeState };

/* The arrowhead carries the row's state by colour, so the Progress column reads
   as status from across the room before anyone parses the nodes. That is what
   keeps a motif on every row from becoming wallpaper. */
export function routeNodes(
  stops: PodStop[],
  focusedStopId: string,
  focusedIsOverdue: boolean,
): { nodes: RouteNode[]; arrowState: ArrowState } {
  const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);

  const nodes: RouteNode[] = ordered.map((s) => ({
    id: s.id,
    state:
      s.id === focusedStopId
        ? "current"
        : s.pod_status === "delivered"
          ? "done"
          : "upcoming",
  }));

  const focused = ordered.find((s) => s.id === focusedStopId);
  const arrowState: ArrowState =
    focused?.pod_status === "delivered" ? "delivered" : focusedIsOverdue ? "overdue" : "pending";

  return { nodes, arrowState };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pod/routeNodes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test && npm run typecheck`
Expected: clean.

```bash
git add lib/pod/routeNodes.ts lib/pod/routeNodes.test.ts
git commit -m "feat: derive route node and arrowhead states"
```

---

## Task 6: Type tokens

**Files:**
- Modify: `app/tokens.css` (all three blocks), `tailwind.config.ts`

- [ ] **Step 1: Add the tokens to all three blocks**

In `app/tokens.css`, add these four lines to `:root`, to `.dark`, and to `.light`, immediately before each block's `--focus` declaration. The values are identical in all three: they are type, not colour, and do not vary by theme.

```
  /* Console type additions. Identical in every block: these are type, not
     colour. They live here rather than in tailwind.config.ts so the parity test
     covers them, and so a future theme cannot forget one. */
  --text-kicker: 600 11px/16px var(--font-sans);
  --tracking-kicker: .08em;
  --text-data-md: 500 13px/18px var(--font-mono);
  --text-data-sm: 500 12px/16px var(--font-mono);
```

- [ ] **Step 2: Verify the parity test still passes**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: PASS. The structure tests assert all three blocks declare an identical key set, so if you missed a block this fails now. If it does, add the missing block rather than relaxing the test.

- [ ] **Step 3: Add the Tailwind font sizes**

In `tailwind.config.ts`, inside `theme.fontSize`, add:

```ts
      kicker: ["11px", { lineHeight: "16px", letterSpacing: "0.08em", fontWeight: "600" }],
      data: ["13px", { lineHeight: "18px", fontWeight: "500" }],
      "data-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
```

Note `overline` already exists at 11px with 0.06em tracking. Leave it: it is used by `app/components/AppShell.tsx`, and changing shared type under a component this task does not otherwise touch is how unrelated pages break.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add app/tokens.css tailwind.config.ts
git commit -m "feat: add Console kicker and mono data type tokens"
```

---

## Task 7: Card and Tabs

**Files:**
- Create: `components/Card.tsx`, `components/Tabs.tsx`

- [ ] **Step 1: Write `Card`**

Create `components/Card.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   border here depends on the scoped reset in app/globals.css supplying
   border-style: solid. Outside `.ds` the border disappears entirely. */

type Props = {
  children: ReactNode;
  /** Section label rendered as an uppercase kicker above the content. */
  kicker?: string;
  className?: string;
  /** Removes padding, for cards whose child manages its own (a table). */
  flush?: boolean;
};

export default function Card({ children, kicker, className, flush }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface shadow-sm",
        flush ? "overflow-hidden" : "p-4",
        className,
      )}
    >
      {kicker ? (
        <div className="mb-2 text-kicker uppercase text-ink-3">{kicker}</div>
      ) : null}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write `Tabs`**

Create `components/Tabs.tsx`:

```tsx
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper, same as Card and Button. */

export type Tab = { id: string; label: string; count?: number };

type Props = {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list, e.g. "Proof of delivery views". */
  label: string;
};

export default function Tabs({ tabs, activeId, onChange, label }: Props) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "border-primary-tint-border bg-primary-tint text-primary-deep"
                : "border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="font-mono text-data-sm tabular-nums">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/Card.tsx components/Tabs.tsx
git commit -m "feat: add Card and Tabs components"
```

---

## Task 8: RouteProgress

**Files:**
- Create: `components/RouteProgress.tsx`

- [ ] **Step 1: Write the component**

Create `components/RouteProgress.tsx`:

```tsx
import type { ArrowState, RouteNode } from "../lib/pod/routeNodes";

/* The plotted-route motif from the design system, as a status glyph.

   Fixed width by design: a four-stop job compresses its dotted spans rather
   than widening the column, so the table cannot reflow when a job has more
   stops. That is what lets every column be a fixed width, which is what stops
   a gap opening anywhere in the row. */

const NODE_FILL: Record<RouteNode["state"], string> = {
  done: "bg-success",
  current: "bg-surface",
  upcoming: "bg-surface",
};

const NODE_RING: Record<RouteNode["state"], string> = {
  done: "border-success",
  current: "border-warning",
  upcoming: "border-line-strong",
};

const ARROW: Record<ArrowState, string> = {
  pending: "border-l-warning",
  overdue: "border-l-danger",
  delivered: "border-l-success",
};

type Props = {
  nodes: RouteNode[];
  arrowState: ArrowState;
  /** Describes the route for screen readers, e.g. "Leeds to Hull, stop 2 of 2, awaiting POD". */
  label: string;
};

export default function RouteProgress({ nodes, arrowState, label }: Props) {
  return (
    <span role="img" aria-label={label} className="flex w-[68px] items-center">
      {nodes.map((node, i) => (
        <span key={node.id} className="flex flex-1 items-center last:flex-none">
          <span
            className={`h-2 w-2 flex-none rounded-full border-2 ${NODE_FILL[node.state]} ${NODE_RING[node.state]}`}
          />
          {i < nodes.length - 1 ? (
            <span
              className={`h-0 flex-1 border-t-2 border-dotted ${
                node.state === "done" ? "border-success-border" : "border-line-strong"
              }`}
            />
          ) : null}
        </span>
      ))}
      <span
        aria-hidden
        className={`ml-0.5 h-0 w-0 flex-none border-y-[5px] border-l-[8px] border-y-transparent ${ARROW[arrowState]}`}
      />
    </span>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/RouteProgress.tsx
git commit -m "feat: add the RouteProgress motif as a fixed-width status glyph"
```

---

## Task 9: Extend DataTable

**Files:**
- Modify: `components/DataTable.tsx`

- [ ] **Step 1: Add the two optional props**

In `components/DataTable.tsx`, add `width` to `Column`:

```ts
export type Column<T> = {
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  className?: string;
  /* Fixed CSS width, emitted as a <colgroup> with table-layout: fixed. Set it
     on every column or none: a mix lets the unspecified ones absorb all the
     leftover width, which opens a large gap in the middle of the row. */
  width?: string;
};
```

Add to `Props<T>`:

```ts
  /** Renders an extra full-width row beneath the matching row. */
  renderExpanded?: (row: T) => ReactNode;
  /** rowKey of the currently expanded row, if any. */
  expandedKey?: string | null;
```

Destructure them in the signature alongside the others:

```ts
  renderExpanded,
  expandedKey = null,
```

- [ ] **Step 2: Emit the colgroup**

Change the `<table>` element (line 42) from:

```tsx
      <table className="w-full min-w-[640px] border-collapse text-sm">
```

to:

```tsx
      <table
        className={cn(
          "w-full min-w-[640px] border-collapse text-sm",
          columns.some((c) => c.width) && "table-fixed",
        )}
      >
        {columns.some((c) => c.width) ? (
          <colgroup>
            {columns.map((col, i) => (
              <col key={`col-${col.header}-${i}`} style={{ width: col.width }} />
            ))}
          </colgroup>
        ) : null}
```

- [ ] **Step 3: Render the expanded row**

In the `state === "ready"` branch, the rows are currently mapped to a single `<tr>`. Wrap each in a fragment so an expansion row can follow. Replace `rows.map((row) => (` and its closing with a fragment, keeping the existing `<tr>` exactly as it is, and adding after it:

```tsx
                  {renderExpanded && expandedKey === rowKey(row) ? (
                    <tr>
                      <td colSpan={columns.length} className="border-b border-line p-0 last:border-0">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  ) : null}
```

The fragment needs the key, so the map becomes:

```tsx
            ? rows.map((row) => (
                <Fragment key={rowKey(row)}>
                  {/* existing <tr> here, with its key attribute REMOVED since
                      the Fragment now carries it */}
                </Fragment>
              ))
```

Add `Fragment` to the React import at the top:

```tsx
import { Fragment, type ReactNode } from "react";
```

- [ ] **Step 4: Verify existing consumers are unaffected**

Both new props are optional and the colgroup is only emitted when a width is set, so `/dashboard`'s table renders identically.

Run: `npm run typecheck && npm run build && npm test`
Expected: all clean.

Then confirm by eye that `/dashboard`'s today's-jobs table still renders with auto-sized columns: `grep -n "columns=" app/dashboard/page.tsx` and check none of its column definitions set `width`.

- [ ] **Step 5: Commit**

```bash
git add components/DataTable.tsx
git commit -m "feat: DataTable supports fixed column widths and expandable rows"
```

---

## Task 10: Kicker labels on Field and Textarea

**Files:**
- Modify: `components/Field.tsx`, `components/Textarea.tsx`

- [ ] **Step 1: Read both files first**

Run: `cat components/Field.tsx components/Textarea.tsx`

`Field`'s label is currently `className="text-sm font-medium text-ink-2"`. `Textarea` follows the same shape.

- [ ] **Step 2: Add the opt-in prop to `Field`**

Add to `Props`:

```ts
  /** Renders the label as an uppercase Console kicker instead of body text. */
  kickerLabel?: boolean;
```

Destructure it, and change the `<label>` className to:

```tsx
      <label
        htmlFor={id}
        className={
          kickerLabel
            ? "text-kicker uppercase text-ink-3"
            : "text-sm font-medium text-ink-2"
        }
      >
```

- [ ] **Step 3: Make the identical change to `Textarea`**

Same prop, same conditional on its label element. Do not change anything else in either file: the `border-ink-3` choice is a deliberate accessibility decision documented in `Field.tsx` and must stay.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean. Existing consumers (`app/jobs/JobForm.tsx`, `app/jobs/StopCard.tsx`, `app/login/page.tsx`, `components/landing/RequestAccessForm.tsx`) pass no `kickerLabel`, so they keep body-text labels.

- [ ] **Step 5: Commit**

```bash
git add components/Field.tsx components/Textarea.tsx
git commit -m "feat: optional kicker labels on Field and Textarea"
```

---

## Task 11: The left rail

**Files:**
- Create: `app/pod/PodRail.tsx`

- [ ] **Step 1: Write the component**

Create `app/pod/PodRail.tsx`:

```tsx
import Card from "../../components/Card";
import { waitingLabel } from "../../lib/pod/queue";
import type { PodKpis } from "../../lib/pod/kpis";
import type { AttentionEntry } from "../../lib/pod/kpis";

function money(n: number): string {
  // Thin-space thousands and no decimals: these are indicative totals, and
  // pence add noise to a number nobody reconciles from this screen.
  return `£${Math.round(n).toLocaleString("en-GB").replace(/,/g, " ")}`;
}

type Props = { kpis: PodKpis; attention: AttentionEntry[] };

export default function PodRail({ kpis, attention }: Props) {
  const total = kpis.valueAwaiting || 1; // avoid dividing by zero on an empty queue
  const overduePct = Math.round((kpis.valueOverdue / total) * 100);

  return (
    <div className="grid gap-2.5">
      <Card kicker="Revenue awaiting POD">
        <div className="font-mono text-[30px] font-semibold leading-tight tabular-nums slashed-zero text-ink">
          {money(kpis.valueAwaiting)}
        </div>
        <p className="mb-3 text-xs text-ink-3">Delivered work that cannot be invoiced yet</p>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-danger-strong">Overdue &gt; 48 h</span>
            <span className="font-mono text-data-sm tabular-nums text-danger-strong">
              {money(kpis.valueOverdue)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-danger" style={{ width: `${overduePct}%` }} />
          </div>

          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-warning-strong">Under 48 h</span>
            <span className="font-mono text-data-sm tabular-nums text-warning-strong">
              {money(kpis.valueRecent)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-warning" style={{ width: `${100 - overduePct}%` }} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-kicker uppercase text-ink-3">Needs attention</span>
          <span className="font-mono text-data-sm tabular-nums text-danger-strong">
            {attention.length}
          </span>
        </div>

        {attention.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing overdue right now.</p>
        ) : (
          <ul className="grid list-none gap-2.5 p-0">
            {attention.map((item) => (
              <li key={item.stopId} className="border-l-2 border-danger pl-2.5">
                <div className="text-sm text-ink">
                  <span className="font-mono font-semibold">{item.jobReference}</span>
                  {" · "}
                  {item.destinationCity}
                </div>
                <div className="text-xs text-ink-3">
                  Awaiting POD{" "}
                  <span className="font-mono tabular-nums text-danger-strong">
                    {waitingLabel(item.ageHours)}
                  </span>
                  {" · "}
                  {item.missing}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/pod/PodRail.tsx
git commit -m "feat: add the POD revenue and attention rail"
```

---

## Task 12: The POD form, extracted

**Files:**
- Create: `app/pod/PodForm.tsx`

Lifts the existing form out of `app/pod/page.tsx` unchanged in behaviour. Every handler stays in the page and is passed in.

- [ ] **Step 1: Write the component**

Create `app/pod/PodForm.tsx`:

```tsx
import Field from "../../components/Field";
import Textarea from "../../components/Textarea";
import Button from "../../components/Button";
import PodLink from "../components/PodLink";

export type PodFormValues = {
  recipient_name: string;
  pod_notes: string;
  pod_photo_url: string;
  pod_document_url: string;
};

type Props = {
  stopId: string;
  values: PodFormValues;
  saving: boolean;
  uploadingField: string;
  onChange: (field: keyof PodFormValues, value: string) => void;
  onUpload: (file: File | undefined, field: "pod_photo_url" | "pod_document_url") => void;
  onSave: (markDelivered: boolean) => void;
};

export default function PodForm({
  stopId, values, saving, uploadingField, onChange, onUpload, onSave,
}: Props) {
  return (
    <div className="grid max-w-[620px] gap-2 p-3">
      <Field
        id={`pod-${stopId}-recipient`}
        label="Recipient"
        kickerLabel
        placeholder="Recipient name"
        value={values.recipient_name}
        onChange={(e) => onChange("recipient_name", e.target.value)}
      />

      <Textarea
        id={`pod-${stopId}-notes`}
        label="Notes"
        kickerLabel
        placeholder="POD notes"
        rows={3}
        value={values.pod_notes}
        onChange={(e) => onChange("pod_notes", e.target.value)}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-dashed border-line-strong p-2.5">
          <div className="mb-1.5 text-kicker uppercase text-ink-3">Photo</div>
          <input
            type="file"
            accept="image/*"
            className="text-xs text-ink-2"
            onChange={(e) => onUpload(e.target.files?.[0], "pod_photo_url")}
          />
          {uploadingField === `${stopId}-pod_photo_url` ? (
            <p className="mt-1.5 text-xs text-ink-3">Uploading photo…</p>
          ) : null}
          {values.pod_photo_url ? (
            <div className="mt-2">
              <PodLink value={values.pod_photo_url} label="View uploaded photo" />
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-line p-2.5">
          <div className="mb-1.5 text-kicker uppercase text-ink-3">Document</div>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
            className="text-xs text-ink-2"
            onChange={(e) => onUpload(e.target.files?.[0], "pod_document_url")}
          />
          {uploadingField === `${stopId}-pod_document_url` ? (
            <p className="mt-1.5 text-xs text-ink-3">Uploading document…</p>
          ) : null}
          {values.pod_document_url ? (
            <div className="mt-2">
              <PodLink value={values.pod_document_url} label="View uploaded document" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={saving} onClick={() => onSave(false)}>
          Save edit
        </Button>
        <Button size="sm" loading={saving} onClick={() => onSave(true)}>
          Mark delivered
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check `Textarea`'s props match**

Run: `cat components/Textarea.tsx`. If its prop names differ from `Field`'s (`id`, `label`, `placeholder`, `rows`, `value`, `onChange`), adjust the usage above to match the real signature rather than changing `Textarea`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/pod/PodForm.tsx
git commit -m "feat: extract the POD form, behaviour unchanged"
```

---

## Task 13: The queue table

**Files:**
- Create: `app/pod/PodQueue.tsx`

- [ ] **Step 1: Write the component**

Create `app/pod/PodQueue.tsx`:

```tsx
import type { ReactNode } from "react";
import DataTable, { type Column } from "../../components/DataTable";
import Badge from "../../components/Badge";
import RouteProgress from "../../components/RouteProgress";
import { waitingLabel, type QueueRow } from "../../lib/pod/queue";
import { routeNodes } from "../../lib/pod/routeNodes";

/* Every width is fixed and they sum to 1056. A single flexible column would
   absorb all leftover width and open a large gap mid-row, which is exactly the
   bug this layout was redesigned to remove. Free-text cells truncate rather
   than overflow into the next column. */
const WIDTHS = {
  job: "84px",
  route: "320px",
  progress: "92px",
  vehicle: "232px",
  evidence: "128px",
  status: "200px",
} as const;

function EvidenceDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`block text-xs ${on ? "text-success-strong" : "text-ink-4"}`}>
      <span aria-hidden>{on ? "●" : "○"}</span>{" "}
      <span className="sr-only">{on ? `${label} attached` : `${label} missing`}</span>
      <span aria-hidden>{label}</span>
    </span>
  );
}

export function podColumns(): Column<QueueRow>[] {
  return [
    {
      header: "Job",
      width: WIDTHS.job,
      cell: (r) => <span className="font-mono text-data tabular-nums text-ink">{r.jobReference}</span>,
    },
    {
      header: "Route",
      width: WIDTHS.route,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate text-sm text-ink">
            {r.originCity ? `${r.originCity} → ${r.destinationCity}` : r.destinationCity}
          </span>
          <span className="block truncate font-mono text-data-sm text-ink-3">
            {[r.destinationPostcode, r.dropCount > 1 ? `${r.dropCount} drops` : null, r.customerName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      ),
    },
    {
      header: "Progress",
      width: WIDTHS.progress,
      cell: (r) => {
        const { nodes, arrowState } = routeNodes(r.stops, r.stopId, r.isOverdue);
        return (
          <RouteProgress
            nodes={nodes}
            arrowState={arrowState}
            label={`${r.originCity ?? "origin"} to ${r.destinationCity}, ${nodes.length} stops, ${
              arrowState === "delivered" ? "delivered" : arrowState === "overdue" ? "overdue" : "awaiting POD"
            }`}
          />
        );
      },
    },
    {
      header: "Vehicle & driver",
      width: WIDTHS.vehicle,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-data text-ink">
            {r.vehicleRegistration ?? "—"}
          </span>
          <span className="block truncate text-xs text-ink-3">
            {[r.vehicleModel, r.driverName].filter(Boolean).join(" · ") || "Unassigned"}
          </span>
        </span>
      ),
    },
    {
      header: "Evidence",
      width: WIDTHS.evidence,
      cell: (r) => (
        <span className="block">
          <EvidenceDot on={r.hasPhoto} label="photo" />
          <EvidenceDot on={r.hasDocument} label="doc" />
        </span>
      ),
    },
    {
      header: "Status",
      width: WIDTHS.status,
      align: "right",
      cell: (r) => (
        <span className="block">
          <Badge tone={r.isOverdue ? "danger" : r.deliveredAt ? "success" : "warning"}>
            {r.deliveredAt ? "Delivered" : r.isOverdue ? "Overdue" : "Pending"}
          </Badge>
          <span
            className={`mt-0.5 block font-mono text-data-sm tabular-nums ${
              r.isOverdue ? "text-danger-strong" : "text-ink-3"
            }`}
          >
            {waitingLabel(r.ageHours)}
          </span>
        </span>
      ),
    },
  ];
}

type Props = {
  rows: QueueRow[];
  state: "loading" | "error" | "empty" | "ready";
  expandedStopId: string | null;
  onRowClick: (row: QueueRow) => void;
  renderExpanded: (row: QueueRow) => ReactNode;
  onRetry: () => void;
  emptyTitle: string;
};

export default function PodQueue({
  rows, state, expandedStopId, onRowClick, renderExpanded, onRetry, emptyTitle,
}: Props) {
  return (
    <DataTable
      columns={podColumns()}
      rows={rows}
      rowKey={(r) => r.stopId}
      state={state}
      onRowClick={onRowClick}
      expandedKey={expandedStopId}
      renderExpanded={renderExpanded}
      onRetry={onRetry}
      errorMessage="Couldn't load proof of delivery."
      emptyTitle={emptyTitle}
    />
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/pod/PodQueue.tsx
git commit -m "feat: add the POD queue table with fixed columns"
```

---

## Task 14: Rewire the page

**Files:**
- Modify: `app/pod/page.tsx`

The most delicate task. `savePod`, `uploadFile` and the delivered-cascade move **verbatim**. Only the query's `select` and the JSX change.

- [ ] **Step 1: Extend the query**

In `loadJobs`, the `select` currently lists job and stop fields. Add the new reads, keeping
everything already there including `tenant_id` on `job_stops`, which `uploadFile` depends on.

At the job level add `customer_price, vehicles ( registration, make, model ), drivers ( name )`.
On `job_stops` add `planned_at`.

The embedded relationship names are verified, not guessed: `app/jobs/page.tsx:46` already selects
`customers ( name ), vehicles ( registration ), drivers ( name )` on this same table, and
`make` / `model` exist on `vehicles` (see the `Vehicle` type at `app/vehicles/page.tsx:44-53`).

- [ ] **Step 2: Map rows into `PodJob` shape**

After the existing `normalized` mapping, add:

```tsx
    const podJobs: PodJob[] = normalized.map((job: any) => ({
      id: job.id,
      reference: job.reference,
      status: job.status,
      scheduled_date: job.scheduled_date,
      customer_name: job.customers?.name ?? null,
      vehicle_registration: job.vehicles?.registration ?? null,
      vehicle_model: [job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" ") || null,
      driver_name: job.drivers?.name ?? null,
      customer_price: job.customer_price === null ? null : Number(job.customer_price),
      stops: job.job_stops ?? [],
    }));
    setPodJobs(podJobs);
```

- [ ] **Step 3: Derive everything with the pure functions**

Add near the top of the component:

```tsx
  const [tab, setTab] = useState<"awaiting" | "completed">("awaiting");
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [podJobs, setPodJobs] = useState<PodJob[]>([]);

  // One `now` per render, injected into every pure function, so the KPI tiles,
  // the queue order and the attention list cannot disagree by a few
  // milliseconds about what "overdue" means.
  const now = useMemo(() => new Date(), [podJobs]);

  const { awaiting, completed } = useMemo(
    () => splitDeliveryStops(podJobs, now),
    [podJobs, now],
  );

  const jobPrices = useMemo(
    () => new Map(podJobs.map((j) => [j.id, j.customer_price ?? 0])),
    [podJobs],
  );

  const kpis = useMemo(
    () => podKpis(awaiting, completed, jobPrices, now),
    [awaiting, completed, jobPrices, now],
  );

  const attention = useMemo(() => attentionItems(awaiting), [awaiting]);
```

- [ ] **Step 4: Replace the JSX**

Replace everything from `<main ...>` to its closing tag with:

```tsx
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <div className="text-kicker uppercase text-ink-3">Proof of delivery</div>
          <h1 className="mb-4 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Delivery stops awaiting POD
          </h1>

          {message ? (
            <div className="mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink">
              {message}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
            {/* The QUEUE is first in the DOM and the rail second, so when the
                two stack below 1280px the queue comes first: it is the work,
                the rail is context. On xl the order classes swap them, putting
                the rail into the 400px left column. DOM order also decides
                keyboard and screen-reader order, which is the other reason the
                queue leads. */}
            <div className="min-w-0 xl:order-2">
              <div className="mb-3 grid grid-cols-3 gap-2.5">
                <Stat label="Awaiting POD" value={String(kpis.awaiting)} />
                <Stat label="Delivered today" value={String(kpis.deliveredToday)} subTone="positive" />
                <Stat
                  label="Overdue > 48 h"
                  value={String(kpis.overdue)}
                  subTone="danger"
                  sub={kpis.overdue > 0 ? "cannot invoice" : undefined}
                />
              </div>

              <div className="mb-3">
                <Tabs
                  label="Proof of delivery views"
                  activeId={tab}
                  onChange={(id) => {
                    setTab(id as "awaiting" | "completed");
                    setExpandedStopId(null);
                  }}
                  tabs={[
                    { id: "awaiting", label: "Awaiting", count: awaiting.length },
                    { id: "completed", label: "Completed", count: completed.length },
                  ]}
                />
              </div>

              <PodQueue
                rows={tab === "awaiting" ? awaiting : completed}
                state="ready"
                expandedStopId={expandedStopId}
                onRowClick={(r) => setExpandedStopId(expandedStopId === r.stopId ? null : r.stopId)}
                onRetry={loadJobs}
                emptyTitle={tab === "awaiting" ? "No PODs awaiting" : "Nothing completed yet"}
                renderExpanded={(r) => (
                  <PodForm
                    stopId={r.stopId}
                    values={forms[r.stopId] ?? {
                      recipient_name: "", pod_notes: "", pod_photo_url: "", pod_document_url: "",
                    }}
                    saving={savingStopId === r.stopId}
                    uploadingField={uploadingField}
                    onChange={(field, value) => updateForm(r.stopId, field, value)}
                    onUpload={(file, field) => {
                      const stop = r.stops.find((s) => s.id === r.stopId);
                      uploadFile(file, r.stopId, (stop as any)?.tenant_id, field);
                    }}
                    onSave={(markDelivered) => savePod(r.stopId, markDelivered)}
                  />
                )}
              />
            </div>

            <div className="xl:order-1">
              <PodRail kpis={kpis} attention={attention} />
            </div>
          </div>
        </main>
      </div>
```

Note `uploadFile` still receives `tenant_id` from the stop row, exactly as today. Keep
`tenant_id` in the `job_stops` select or uploads break with "This stop has no tenant".

- [ ] **Step 5: Confirm the write paths are byte-identical**

Run: `git diff app/pod/page.tsx | grep -E "^[+-].*(savePod|uploadFile|updatePayload|allDelivered|upsert|replace\(/\[\^a)"`

Expected: no lines except pure indentation changes. If any logic line appears as both `-` and `+` with different content, the task has changed a write path and must be corrected.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add app/pod/page.tsx
git commit -m "feat: rebuild /pod as a stop-first queue, write paths untouched"
```

---

## Task 15: Activate the theme on /pod

**Files:**
- Modify: `lib/nav/themeableRoutes.ts`, `lib/nav/themeableRoutes.test.ts`

- [ ] **Step 1: Update the test first**

In `lib/nav/themeableRoutes.test.ts`, move `/pod` from the legacy list to the themeable list:

```ts
  it("returns true for the pages that paint their own bg-canvas on a .ds wrapper", () => {
    expect(isThemeableRoute("/")).toBe(true);
    expect(isThemeableRoute("/login")).toBe(true);
    expect(isThemeableRoute("/dashboard")).toBe(true);
    expect(isThemeableRoute("/jobs")).toBe(true);
    expect(isThemeableRoute("/pod")).toBe(true);
    expect(isThemeableRoute("/super-admin/requests")).toBe(true);
  });

  it("returns false for legacy inline-styled pages, which pin themselves dark", () => {
    expect(isThemeableRoute("/tracking")).toBe(false);
    expect(isThemeableRoute("/invoices")).toBe(false);
    expect(isThemeableRoute("/stats")).toBe(false);
  });
```

And update the exact-list assertion:

```ts
  it("lists exactly the pages known to be tokenised today", () => {
    expect([...THEMEABLE_ROUTES].sort()).toEqual(
      ["/", "/dashboard", "/jobs", "/login", "/pod", "/super-admin/requests"].sort(),
    );
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/nav/themeableRoutes.test.ts`
Expected: FAIL, because `/pod` is not yet in the list.

- [ ] **Step 3: Add the route**

In `lib/nav/themeableRoutes.ts`, add to `THEMEABLE_ROUTES`, keeping the annotation style of its neighbours:

```ts
  "/pod",                    // app/pod/page.tsx
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/nav/themeableRoutes.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/themeableRoutes.ts lib/nav/themeableRoutes.test.ts
git commit -m "feat: /pod follows the theme, first use of the activation switch"
```

---

## Task 16: The overlap test

Ethan asked specifically that the final pass carry no strange overlapping parts. This bug class has already cost this project twice in one day.

**Files:**
- Create: `tests/pod-layout.spec.mjs`

- [ ] **Step 1: Write the test**

Create `tests/pod-layout.spec.mjs`:

```js
/* Layout regression check for /pod.
 *
 * WHY THIS EXISTS: on 2026-08-13 two separate overlap bugs shipped or nearly
 * shipped in this repo. Job-form inputs overflowed their boxes by 25 to 57px
 * with ordinary data, and the first POD mockup opened a several-hundred-pixel
 * gap mid-row. Both were invisible in review and obvious the instant something
 * rendered and measured them. Reading the CSS is not sufficient evidence.
 *
 * Run: node tests/pod-layout.spec.mjs   (dev server must be running)
 */
import { chromium } from "playwright";

const URL = process.env.POD_URL || "http://localhost:3000/pod";
const WIDTHS = [1920, 1440, 1280, 900, 375];

const browser = await chromium.launch();
let failures = 0;

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. Nothing overflows its own container horizontally.
  const overflows = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((el) => {
        const parent = el.parentElement;
        if (!parent) return false;
        const p = parent.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        if (e.width === 0) return false;
        // A scroll container is allowed to hold something wider than itself.
        if (getComputedStyle(parent).overflowX !== "visible") return false;
        return e.right > p.right + 1 || e.left < p.left - 1;
      })
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 90)),
  );

  // 2. No two cells in the same row overlap.
  const collisions = await page.evaluate(() => {
    const bad = [];
    for (const row of document.querySelectorAll("tbody tr")) {
      const cells = [...row.children].map((c) => c.getBoundingClientRect());
      for (let i = 0; i < cells.length - 1; i++) {
        if (cells[i].right > cells[i + 1].left + 1) bad.push(`row cell ${i} overlaps ${i + 1}`);
      }
    }
    return bad;
  });

  // 3. The page itself never scrolls sideways.
  const bodyScrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

  const ok = overflows.length === 0 && collisions.length === 0 && !bodyScrolls;
  console.log(`${ok ? "PASS" : "FAIL"}  ${width}px`);
  if (!ok) {
    failures++;
    if (overflows.length) console.log("  overflow:", overflows.slice(0, 5));
    if (collisions.length) console.log("  collision:", collisions.slice(0, 5));
    if (bodyScrolls) console.log("  page scrolls horizontally");
  }
  await page.close();
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it against the real page**

Start the dev server, sign in (see `scripts/dev-login.mjs`, or use a real magic link), then:

Run: `npx -p playwright node tests/pod-layout.spec.mjs`
Expected: `PASS` at all five widths.

**If `/pod` redirects to `/login` because you are not signed in, say so and do not report a pass.** An unauthenticated redirect renders the `TenantGate` panel, which trivially passes every assertion while testing nothing.

- [ ] **Step 3: Test with worst-case data**

The default data may be too tidy to catch anything. Re-run with a long customer name, a four-stop job, and a long driver name present. If you cannot create that data, inject it in the browser before measuring:

```js
await page.evaluate(() => {
  const cell = document.querySelector("tbody tr td:nth-child(2) span span");
  if (cell) cell.textContent = "Cambridge Audio International Logistics Group Limited";
});
```

Report which method you used. Truncation should keep the cell inside its column either way.

- [ ] **Step 4: Commit**

```bash
git add tests/pod-layout.spec.mjs
git commit -m "test: assert no overlap or overflow on /pod at five widths"
```

---

## Task 17: Full verification

No code changes.

- [ ] **Step 1: Automated**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean. Test count should have grown by roughly 36 from the `lib/pod/` suites.

- [ ] **Step 2: The write paths did not change**

```bash
git diff main..HEAD -- app/pod/page.tsx | grep -E "^[+-]" | grep -iE "upsert|storage|update\(|delivered_at|pod_status|status: \"completed\""
```

Read every line. Additions must be limited to the query's `select`. If any line changes what is written to the database, stop and report.

- [ ] **Step 3: Manual, signed in**

1. `/pod` renders the queue, KPI tiles and rail.
2. Open a row: the form appears, the route glyph matches the job's stops.
3. Upload a photo and a document. Both attach, and the Evidence dots fill.
4. Save an edit. The message banner reports success.
5. Mark a stop delivered. It moves from Awaiting to Completed, and if it was the last delivery stop, the job's status becomes completed.
6. Switch to Completed and confirm a delivered stop's form still opens and still saves.
7. Toggle to light. `/pod` now follows the theme rather than staying dark.

- [ ] **Step 4: Cross-check against the dashboard**

Open `/dashboard` and `/pod` side by side. The dashboard's "PODs awaiting" KPI and the POD page's "Awaiting POD" tile must show the **same number**. If they differ, the shared rule is not actually shared and that is a real bug, not a rounding difference.

- [ ] **Step 5: Legacy pages unaffected**

Visit `/tracking` and `/invoices`. They must still be pinned dark and unchanged.

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Stop-first queue with Awaiting / Completed tabs | 3, 13, 14 |
| Left rail: revenue awaiting, needs attention | 4, 11 |
| KPI tiles | 4, 14 |
| Columns: Job, Route, Progress, Vehicle & driver, Evidence, Status | 13 |
| RouteProgress, fixed width, arrowhead carries state | 5, 8 |
| Type tokens in all three blocks | 6 |
| Pure logic in `lib/pod/` with `now` injected | 1, 3, 4, 5 |
| One shared overdue rule with the dashboard | 1, 2, 17 step 4 |
| `planned_at` nullable, excluded from overdue | 1, 3 |
| Additive read-only query change | 14 |
| `/pod` joins THEMEABLE_ROUTES | 15 |
| Overlap prevention with a test | 13, 16 |
| Write paths untouched | 14 step 5, 17 step 2 |
| Card, Tabs, DataTable extension, kicker labels | 7, 9, 10 |
| No Icon component | Deviation 1 |
