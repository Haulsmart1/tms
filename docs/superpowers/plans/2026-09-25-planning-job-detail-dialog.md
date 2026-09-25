# Planning Job Detail Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a job card on the Planning board opens a read-only job detail dialog on the board, with Accept, Print labels and an Open in Jobs link, instead of navigating to the Jobs page.

**Architecture:** The dialog is a new client component fed entirely by the `PlanJob` the board already holds plus the board's draft lane state, so it runs no query. Pure display helpers (status label, ETA formatting, stop narrowing, draft assignment lookup) live in `lib/planning/jobDetail.ts` so vitest covers them. The shared `components/Modal.tsx` gains a `size` option and a scrolling panel so it can host a long list of stops.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, vitest (lib only), Tailwind with the repo's `ds` token classes.

Spec: `docs/superpowers/specs/2026-09-25-planning-job-detail-dialog-design.md`

Repo rules that apply to every task:

- Run commands from the repo root `C:\Users\ethan\Desktop\tms` (PowerShell: no `&&`, use `;`).
- Stage only the files named in the task. The working tree also holds uncommitted ledger-readonly changes belonging to another branch. Never `git add -A` or `git add .`.
- No em-dashes anywhere (code comments, docs, commit messages).
- Never use Tailwind `dark:` variants; theme differences go in tokens.
- Tests are colocated `*.test.ts` next to the module. Only `lib/` runs under vitest.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/planning/jobDetail.ts` (create) | Pure helpers: `jobStatusLabel`, `formatEta`, `stopTypeLabel`, `toLabelStops`, `draftAssignment`. |
| `lib/planning/jobDetail.test.ts` (create) | Unit tests for the five helpers. |
| `components/Modal.tsx` (modify) | Add optional `size?: "md" \| "lg"` prop; panel scrolls when tall. |
| `app/planning/JobDetailDialog.tsx` (create) | The dialog: header, assignment, times, stops, items, actions. |
| `app/jobs/JobLabelPrinter.tsx` (modify) | Render the print overlay through a portal to `document.body` so it is not clipped by the Modal when printing. |
| `app/planning/page.tsx` (modify) | Replace the two `router.push` calls with dialog state; render the dialog. |
| `README.md` (modify) | Planning page inventory line. |

---

### Task 1: Pure helpers in `lib/planning/jobDetail.ts`

**Files:**
- Create: `lib/planning/jobDetail.ts`
- Test: `lib/planning/jobDetail.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/planning/jobDetail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  draftAssignment,
  formatEta,
  jobStatusLabel,
  stopTypeLabel,
  toLabelStops,
} from "./jobDetail";
import type { PlanStop } from "./types";

describe("jobStatusLabel", () => {
  it("uses the Jobs page wording for pending acceptance", () => {
    expect(jobStatusLabel("pending_acceptance")).toBe("Awaiting acceptance");
  });

  it("replaces underscores in any other status", () => {
    expect(jobStatusLabel("in_transit")).toBe("in transit");
    expect(jobStatusLabel("planned")).toBe("planned");
  });

  it("renders a missing status as the absent-value marker", () => {
    expect(jobStatusLabel(null)).toBe("-");
    expect(jobStatusLabel("")).toBe("-");
  });
});

describe("formatEta", () => {
  it("renders a GMT instant in London time", () => {
    expect(formatEta("2026-01-15T09:00:00Z", "Europe/London")).toBe(
      "15 Jan 2026, 09:00"
    );
  });

  it("shifts a BST instant by an hour", () => {
    expect(formatEta("2026-07-15T09:00:00Z", "Europe/London")).toBe(
      "15 Jul 2026, 10:00"
    );
  });

  it("respects a non-UK company timezone", () => {
    expect(formatEta("2026-07-15T09:00:00Z", "Europe/Warsaw")).toBe(
      "15 Jul 2026, 11:00"
    );
  });

  it("renders midnight as 00, never 24", () => {
    expect(formatEta("2026-01-15T00:00:00Z", "Europe/London")).toBe(
      "15 Jan 2026, 00:00"
    );
  });

  it("renders null or unparseable input as the absent-value marker", () => {
    expect(formatEta(null, "Europe/London")).toBe("-");
    expect(formatEta("not a date", "Europe/London")).toBe("-");
  });
});

describe("stopTypeLabel", () => {
  it("capitalises the two known types", () => {
    expect(stopTypeLabel("collection")).toBe("Collection");
    expect(stopTypeLabel("delivery")).toBe("Delivery");
  });

  it("passes an unknown type through and marks null", () => {
    expect(stopTypeLabel("transfer")).toBe("transfer");
    expect(stopTypeLabel(null)).toBe("-");
  });
});

function stop(overrides: Partial<PlanStop> & { id: string }): PlanStop {
  return {
    stop_order: 1,
    type: "collection",
    address_line: "1 High St",
    city: "Leeds",
    postcode: "LS1 1AA",
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe("toLabelStops", () => {
  it("keeps collection and delivery stops in stop order", () => {
    const result = toLabelStops([
      stop({ id: "b", stop_order: 2, type: "delivery" }),
      stop({ id: "a", stop_order: 1, type: "collection" }),
    ]);
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result[0].type).toBe("collection");
    expect(result[1].type).toBe("delivery");
  });

  it("drops stops the label printer cannot classify", () => {
    const result = toLabelStops([
      stop({ id: "a", type: "collection" }),
      stop({ id: "x", stop_order: 2, type: null }),
      stop({ id: "y", stop_order: 3, type: "transfer" }),
    ]);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("carries only the label fields", () => {
    const [result] = toLabelStops([stop({ id: "a", lat: 53.8, lng: -1.5 })]);
    expect(result).toEqual({
      id: "a",
      stop_order: 1,
      type: "collection",
      address_line: "1 High St",
      city: "Leeds",
      postcode: "LS1 1AA",
    });
  });
});

describe("draftAssignment", () => {
  const laneOrders = { v1: ["j1", "j2"], v2: ["j3"] };
  const laneDrivers = { v1: "d1", v2: null };

  it("finds the lane that holds the job and that lane's driver", () => {
    expect(draftAssignment("j2", laneOrders, laneDrivers)).toEqual({
      vehicleId: "v1",
      driverId: "d1",
    });
  });

  it("reports a lane with no driver", () => {
    expect(draftAssignment("j3", laneOrders, laneDrivers)).toEqual({
      vehicleId: "v2",
      driverId: null,
    });
  });

  it("reports an unassigned job", () => {
    expect(draftAssignment("j9", laneOrders, laneDrivers)).toEqual({
      vehicleId: null,
      driverId: null,
    });
  });

  it("reads the draft, so a moved job reports its new lane", () => {
    const moved = { v1: ["j1"], v2: ["j3", "j2"] };
    expect(draftAssignment("j2", moved, laneDrivers)).toEqual({
      vehicleId: "v2",
      driverId: null,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/planning/jobDetail.test.ts`
Expected: FAIL with `Failed to resolve import "./jobDetail"` (module not found).

- [ ] **Step 3: Write the implementation**

Create `lib/planning/jobDetail.ts`:

```ts
/* Display helpers for the Planning job detail dialog. Kept out of the
   component so the status wording, the timezone-aware ETA and the "draft,
   not saved" assignment rule are unit tested (vitest covers lib/ only). */

import type { LabelStop } from "../printing/jobLabels";
import type { PlanStop } from "./types";

const ABSENT = "-";

/** Same wording the Jobs page list uses for a status cell. */
export function jobStatusLabel(status: string | null): string {
  if (!status) return ABSENT;
  if (status === "pending_acceptance") return "Awaiting acceptance";
  return status.replaceAll("_", " ");
}

/** "15 Jan 2026, 09:00" in the given IANA zone; "-" for null or junk. The
    string is assembled from parts so ICU punctuation changes cannot move the
    comma, and hourCycle h23 keeps midnight at 00 rather than 24. */
export function formatEta(value: string | null, timeZone: string): string {
  if (!value) return ABSENT;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return ABSENT;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return ABSENT;
  }

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
}

export function stopTypeLabel(type: string | null): string {
  if (!type) return ABSENT;
  if (type === "collection") return "Collection";
  if (type === "delivery") return "Delivery";
  return type;
}

/** The label printer keys its stop selection on exactly these two types, so
    anything else is dropped rather than mislabelled. */
export function toLabelStops(stops: PlanStop[]): LabelStop[] {
  return [...stops]
    .sort((a, b) => a.stop_order - b.stop_order)
    .flatMap((stop) => {
      if (stop.type !== "collection" && stop.type !== "delivery") return [];
      return [
        {
          id: stop.id,
          stop_order: stop.stop_order,
          type: stop.type,
          address_line: stop.address_line,
          city: stop.city,
          postcode: stop.postcode,
        },
      ];
    });
}

export type DraftAssignment = {
  vehicleId: string | null;
  driverId: string | null;
};

/** Where the job sits on the board right now, which may differ from the
    saved jobs.vehicle_id until the plan is saved. */
export function draftAssignment(
  jobId: string,
  laneOrders: Record<string, string[]>,
  laneDrivers: Record<string, string | null>
): DraftAssignment {
  for (const [vehicleId, jobIds] of Object.entries(laneOrders)) {
    if (jobIds.includes(jobId)) {
      return { vehicleId, driverId: laneDrivers[vehicleId] ?? null };
    }
  }
  return { vehicleId: null, driverId: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/planning/jobDetail.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```powershell
git add lib/planning/jobDetail.ts lib/planning/jobDetail.test.ts
git commit -m "Add display helpers for the Planning job detail dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Give the shared Modal a large, scrolling variant

**Files:**
- Modify: `components/Modal.tsx`

No vitest coverage is possible here (`components/` is outside `lib/`); `npm run typecheck` is the gate.

- [ ] **Step 1: Add the `size` prop and scrolling panel**

Replace the whole of `components/Modal.tsx` with:

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "md" is the confirm-dialog width. "lg" is for read-only detail views
      with lists (Planning job detail); the panel scrolls when tall. */
  size?: "md" | "lg";
};

const widths: Record<NonNullable<Props["size"]>, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
};

/* No focus trap or focus-restoration: the consumers today are a two-button
   confirm dialog (Task 20) and a read-only detail view, and this repo has no
   focus-trap dependency. Revisit if a modal ever needs multi-field forms or
   nested focusable content where Tab escaping the dialog would matter more. */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(11,18,32,0.55)]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={`relative z-10 flex max-h-[85vh] w-full flex-col rounded-lg bg-surface p-6 shadow-lg outline-none ${widths[size]}`}
      >
        <h2 id="modal-title" className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-3 min-h-0 overflow-y-auto text-sm text-ink-2">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
```

What changed: the `size` prop and `widths` map; the panel is now `flex flex-col max-h-[85vh]`; the body has `min-h-0 overflow-y-auto` so it scrolls while the title and footer stay put. The default `size="md"` keeps `DeleteJobDialog` pixel-identical.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output after `next typegen`.

- [ ] **Step 3: Commit**

```powershell
git add components/Modal.tsx
git commit -m "Let Modal render a large scrolling panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The `JobDetailDialog` component

**Files:**
- Modify: `app/jobs/JobLabelPrinter.tsx` (the `{open ? ... : null}` block near line 248)
- Create: `app/planning/JobDetailDialog.tsx`

Depends on Task 1 (helpers) and Task 2 (`size="lg"`).

- [ ] **Step 0: Render the label printer overlay through a portal**

Why: the printer's overlay is a `fixed inset-0` div rendered inline. Inside the Modal it becomes a descendant of the Modal's fixed, `max-h-[85vh]`, `overflow-y-auto` body. In print, the stylesheet makes `.label-print-root` `position: absolute`, whose containing block would then be the Modal panel, so a multi-page label run would be clipped to the modal body. A portal to `document.body` puts the overlay beside the Modal instead of inside it; the Jobs page renders identically.

In `app/jobs/JobLabelPrinter.tsx`, add to the imports:

```ts
import { createPortal } from "react-dom";
```

Then change the overlay block. It currently reads:

```tsx
      {open ? (
        <div className="fixed inset-0 z-[100] overflow-auto bg-black/50 p-4 print:static print:bg-white print:p-0">
          ...everything inside, unchanged...
        </div>
      ) : null}
```

Make it:

```tsx
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[100] overflow-auto bg-black/50 p-4 print:static print:bg-white print:p-0">
              ...everything inside, unchanged...
            </div>,
            document.body
          )
        : null}
```

Do not alter anything inside the overlay div (the `<style jsx global>` block, the controls, the pages). `document` is safe here because `open` only becomes true from a click handler on the client. Run `npm run typecheck` after this step.

- [ ] **Step 1: Write the component**

Create `app/planning/JobDetailDialog.tsx`:

```tsx
"use client";

import Link from "next/link";
import Modal from "../../components/Modal";
import Button, { buttonClasses } from "../../components/Button";
import JobLabelPrinter from "../jobs/JobLabelPrinter";
import {
  formatEta,
  jobStatusLabel,
  stopTypeLabel,
  toLabelStops,
} from "../../lib/planning/jobDetail";
import { sortedStops } from "../../lib/planning/waypoints";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  job: PlanJob;
  /** Registration of the lane the job sits in, "Unknown" when the lane's
      vehicle row is missing, null when the job is unassigned. */
  vehicleLabel: string | null;
  /** Driver name for that lane, "Unknown" when the row is missing, null when
      the lane has no driver or the job is unassigned. */
  driverLabel: string | null;
  timeZone: string;
  /** True once geocoding has been attempted, so a missing fix means "failed",
      never "still loading". Same meaning as on PlanJobCard. */
  geocodeSettled: boolean;
  onClose: () => void;
  onAccept: (jobId: string) => void;
};

const ABSENT = "-";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

export default function JobDetailDialog({
  job,
  vehicleLabel,
  driverLabel,
  timeZone,
  geocodeSettled,
  onClose,
  onAccept,
}: Props) {
  const stops = sortedStops(job);
  const items = job.items ?? [];
  const reference = job.reference ?? "No reference";

  const assignment = job.subcontractor_id
    ? "Subcontracted"
    : vehicleLabel === null
      ? "Unassigned"
      : driverLabel === null
        ? `${vehicleLabel} · No driver`
        : `${vehicleLabel} · ${driverLabel}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={reference}
      size="lg"
      footer={
        <>
          {job.status === "pending_acceptance" ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => onAccept(job.id)}
            >
              Accept
            </Button>
          ) : null}
          <JobLabelPrinter
            jobReference={reference}
            customerName={job.customer_name}
            stops={toLabelStops(job.stops)}
            items={items}
          />
          <Link
            href={`/jobs?job=${encodeURIComponent(job.id)}`}
            className={buttonClasses("secondary", "md", "whitespace-nowrap")}
          >
            Open in Jobs
          </Link>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ink">{job.customer_name ?? "No customer"}</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">
            {jobStatusLabel(job.status)}
          </span>
        </div>

        <dl className="grid gap-1.5">
          <Row label="Assignment" value={assignment} />
          <Row label="Collection ETA" value={formatEta(job.collection_eta, timeZone)} />
          <Row label="Delivery ETA" value={formatEta(job.delivery_eta, timeZone)} />
          {job.accepted_at ? (
            <Row label="Accepted" value={formatEta(job.accepted_at, timeZone)} />
          ) : null}
          {job.acceptance_note ? (
            <Row label="Acceptance note" value={job.acceptance_note} />
          ) : null}
        </dl>

        <section aria-label="Stops">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
            Stops
          </h3>
          {stops.length === 0 ? (
            <p className="text-ink-3">No stops</p>
          ) : (
            <ol className="grid gap-1.5">
              {stops.map((stop, index) => {
                const noFix = geocodeSettled && (stop.lat === null || stop.lng === null);
                const place = [stop.address_line, stop.city, stop.postcode]
                  .filter((part) => part && part.trim() !== "")
                  .join(", ");
                return (
                  <li key={stop.id} className="grid grid-cols-[1.5rem_6rem_1fr] gap-2">
                    <span className="text-ink-3">{index + 1}</span>
                    <span className="text-ink">{stopTypeLabel(stop.type)}</span>
                    <span className="text-ink">
                      {place || ABSENT}
                      {noFix ? (
                        <span
                          className="ml-1.5 rounded border border-line px-1 text-xs text-warning"
                          title="This stop could not be geocoded; the job is excluded from the route."
                        >
                          no map fix
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {items.length > 0 ? (
          <section aria-label="Items">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Items
            </h3>
            <ul className="grid gap-1.5">
              {items.map((item) => {
                const serials = item.serial_numbers?.length ?? 0;
                const detail = [
                  item.sku ? `SKU ${item.sku}` : null,
                  `Qty ${item.quantity}`,
                  serials > 0 ? `${serials} serial${serials === 1 ? "" : "s"}` : null,
                  item.external_reference ? `Ref ${item.external_reference}` : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(" · ");
                return (
                  <li key={item.id} className="grid gap-0.5">
                    <span className="text-ink">{item.description ?? "No description"}</span>
                    <span className="text-xs text-ink-3">{detail}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
```

Notes for the implementer:

- `Modal` owns the backdrop, Escape and `role="dialog"`. Do not add another listener.
- `JobLabelPrinter` renders its own button and print flow; it is used exactly as the Jobs page uses it.
- `buttonClasses` exists so a `<Link>` can look like a button without nesting a `<button>` in an anchor (see the comment in `components/Button.tsx`).
- The `"no map fix"` title copy matches `PlanJobCard` so the two never disagree.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. If it reports that `LabelJobItem` and `PlanJobItem` differ, compare `lib/printing/jobLabels.ts` with `lib/planning/types.ts`: the fields are identical today, so this should not happen.

- [ ] **Step 3: Commit**

```powershell
git add app/jobs/JobLabelPrinter.tsx app/planning/JobDetailDialog.tsx
git commit -m "Add the Planning job detail dialog component

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Wire the dialog into the Planning page

**Files:**
- Modify: `app/planning/page.tsx` (lines 4, 136, near 236, near 2727, near 2973, and the end of the JSX before `</TenantGate>`)

Line numbers are from the current file; search for the quoted text rather than trusting them exactly.

- [ ] **Step 1: Remove the router**

Delete line 4:

```ts
import { useRouter } from "next/navigation";
```

Delete line 136:

```ts
  const router = useRouter();
```

- [ ] **Step 2: Add the imports and state**

Below the existing `import VehicleLane from "./VehicleLane";` (line 11) add:

```ts
import JobDetailDialog from "./JobDetailDialog";
import { draftAssignment } from "../../lib/planning/jobDetail";
```

Directly above `const [acceptanceTarget, setAcceptanceTarget] = useState<{` (line 236) add:

```ts
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
```

- [ ] **Step 3: Close the dialog when the job leaves the board**

Directly below the `jobById` memo (line 264, `const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);`) add:

```ts
  /* A reload can drop the open job (moved to another day, deleted elsewhere);
     an empty dialog would otherwise linger over the board. */
  useEffect(() => {
    if (detailJobId && !jobById.has(detailJobId)) setDetailJobId(null);
  }, [detailJobId, jobById]);
```

- [ ] **Step 4: Replace both navigations**

In the `<UnassignedPool` element (around line 2727) replace:

```tsx
                onOpenJob={(jobId) =>
                  router.push(`/jobs?job=${encodeURIComponent(jobId)}`)
                }
```

with:

```tsx
                onOpenJob={setDetailJobId}
```

In the `<VehicleLane` element (around line 2973) replace:

```tsx
                      onOpenJob={(jobId) =>
                        router.push(`/jobs?job=${encodeURIComponent(jobId)}`)
                      }
```

with:

```tsx
                      onOpenJob={setDetailJobId}
```

- [ ] **Step 5: Render the dialog**

Find the end of the acceptance dialog, the lines:

```tsx
      ) : null}

    </TenantGate>
  );
}
```

and insert the dialog between `) : null}` and `</TenantGate>` so it reads:

```tsx
      ) : null}

      {(() => {
        const detailJob = detailJobId ? jobById.get(detailJobId) : undefined;
        if (!detailJob) return null;
        const { vehicleId, driverId } = draftAssignment(
          detailJob.id,
          laneOrders,
          laneDrivers
        );
        const vehicleLabel = vehicleId
          ? (vehicles.find((v) => v.id === vehicleId)?.registration ?? "Unknown")
          : null;
        const driverLabel =
          vehicleId && driverId
            ? (drivers.find((d) => d.id === driverId)?.name ?? "Unknown")
            : null;
        return (
          <JobDetailDialog
            job={detailJob}
            vehicleLabel={vehicleLabel}
            driverLabel={driverLabel}
            timeZone={planningTimeZone}
            geocodeSettled={geocodeSettled && !geocodeUnavailable}
            onClose={() => setDetailJobId(null)}
            onAccept={(jobId) => {
              setDetailJobId(null);
              openAcceptance(jobId);
            }}
          />
        );
      })()}
    </TenantGate>
  );
}
```

Why an IIFE: the page is a 3,000-line component and the other conditionals in its JSX are inline, so a small block keeps the label lookups next to the dialog rather than adding three more memos at the top. `geocodeSettled && !geocodeUnavailable` is the same expression the pool and lanes pass, so the "no map fix" mark agrees with the cards.

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npm run typecheck`
Expected: exits 0. An error `'router' is declared but its value is never read` means Step 1 missed the const; `Cannot find name 'router'` means a third `router.` use exists, which the spec says it does not (grep `router\.` in the file to confirm).

Run: `npm test`
Expected: all suites pass, including `lib/planning/jobDetail.test.ts` and the unchanged `lib/nav/themeableRoutes.test.ts` and `lib/auth/routeClassification.test.ts` (no route was added or removed).

- [ ] **Step 7: Commit**

```powershell
git add app/planning/page.tsx
git commit -m "Open a job detail dialog from Planning cards instead of leaving for Jobs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: README and manual verification

**Files:**
- Modify: `README.md:84`

- [ ] **Step 1: Update the Planning inventory line**

In `README.md` line 84, the entry that begins `- **`/planning`** [OK]: day planning lanes, Smart Optimize and driver-hours preview.`, append one sentence at the end of the line, after `refuse to overwrite a plan someone else changed.`:

```
Clicking a job card opens a read-only detail dialog on the board (stops, items, ETAs, draft vehicle and driver) with Accept, Print labels and an Open in Jobs link; the card no longer navigates away.
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m "Document the Planning job detail dialog in the page inventory

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Manual check, signed in (Ethan)**

`.env.local` points at the live Supabase project, so only read and close; do not Accept a real job unless it should be accepted. Start `npm run dev`, sign in (see `scripts/dev-login.mjs` header), open `/planning` on a day with jobs, then confirm:

1. Clicking a card in a vehicle lane opens the dialog for that job; the assignment line names that lane's vehicle and driver.
2. Clicking a card in the unassigned pool opens the dialog with "Unassigned".
3. Drag a card to another lane without saving, open it: the assignment line shows the new lane.
4. Close by the Close button, by clicking the backdrop, and by Escape.
5. Drag a card and release it in place: no dialog opens.
6. On an "Awaiting acceptance" job, Accept in the dialog closes it and opens the existing Accept dialog; Cancel that.
7. Print labels opens the label printer as on the Jobs page.
8. Open in Jobs lands on `/jobs` with that job expanded.
9. With "All tenants" selected (admin), the dialog still opens.

Record anything that fails as a follow-up rather than patching the spec silently.

---

## Self-review against the spec

- Opening and closing: Task 4 Steps 4 and 5 (open), Modal in Task 2 (Close, backdrop, Escape), `PlanJobCard` drag suppression unchanged, Accept closes first (Task 4 Step 5), reload clears the id (Task 4 Step 3).
- Contents 1 to 6: Task 3, one block each; status wording and ETA zone in Task 1.
- Read-only board: nothing gates the dialog on a tenant; Accept still goes through `openAcceptance`, which calls `planningReadOnly()` downstream.
- Files: `jobDetail.ts` and test (Task 1), `Modal.tsx` (Task 2, a deviation from the spec's "mirror the acceptance dialog markup" that the spec now records), `JobDetailDialog.tsx` and the `JobLabelPrinter` portal (Task 3, added after the Task 2 review found the print clipping risk), `page.tsx` (Task 4), README (Task 5). `PlanJobCard`, `VehicleLane` and `UnassignedPool` untouched.
- Types: `draftAssignment` returns `{ vehicleId, driverId }` in Task 1 and is destructured the same way in Task 4. `toLabelStops` takes `PlanStop[]` and is called with `job.stops` in Task 3. `JobDetailDialog` props in Task 3 match the call in Task 4 field for field.
