# Planning job detail dialog

Date: 2026-09-25
Status: approved design, awaiting implementation plan

## Problem

On the Planning page every job card is a button. Clicking one, or pressing
Enter or Space on it, calls `router.push("/jobs?job=<id>")`, which leaves the
board and lands on the Jobs page with that job expanded. A planner who only
wants to check an address, an ETA or the items on a job has to leave the plan,
find the job in the Jobs list, and come back. Both the unassigned pool and
every vehicle lane wire the same navigation through `onOpenJob` in
`app/planning/page.tsx`.

## Goal

Clicking a job card on the Planning board opens a read-only job detail dialog
on the board itself, with the two quick actions that already exist on the
card (Accept, Print labels) and a link to the Jobs page for anything that
needs editing.

## Non-goals

- Editing any job field. The Jobs page edit form is coupled to that page's
  state and save logic (POD checks, stop rewrites) and is not reused.
- Deleting a job.
- Send to Planning: the job is already on the board.
- A docked side panel. A centred dialog was chosen because it follows the
  existing Accept dialog and does not squeeze the lanes and map.

## Behaviour

### Opening and closing

- The card click and keyboard handlers in `PlanJobCard` are unchanged. The
  page passes a new `onOpenJob` that records the clicked job id in state
  instead of navigating.
- The dialog closes on the Close button, on a click on the backdrop, and on
  Escape. Clicks inside the dialog do not close it.
- A drag that ends on the card does not open the dialog. `PlanJobCard`
  already suppresses the click after a drag, so no change is needed.
- Opening Accept from the dialog closes the detail dialog first, then calls
  the existing `openAcceptance(jobId)`, so only one dialog is on screen.
- If the board reloads while the dialog is open and the job is no longer
  loaded (moved to another day, deleted elsewhere), the dialog closes.

### Contents

The dialog is built entirely from the `PlanJob` the board already holds plus
the board's draft state. It runs no query.

1. **Header**: reference (or "No reference"), customer name (or "No
   customer"), status label. The status label uses the Jobs page wording:
   `pending_acceptance` shows "Awaiting acceptance", anything else shows the
   raw status with underscores replaced by spaces, and null shows "-".
2. **Assignment**: the vehicle whose lane currently contains the job, read
   from `laneOrders`, and that lane's driver from `laneDrivers`. This is the
   draft assignment, so an unsaved drag shows the new vehicle. A job in no
   lane shows "Unassigned". A job with `subcontractor_id` shows
   "Subcontracted" and no vehicle or driver. Vehicle is shown by
   registration, driver by name; an id with no matching row shows "Unknown".
3. **Times**: collection ETA and delivery ETA formatted as date and time in
   the company's planning timezone (`planningTimeZone`, already resolved by
   the page). Missing values show "-". When `accepted_at` is set, an
   "Accepted" line shows that time; when `acceptance_note` is set it is shown
   under it.
4. **Stops**: ordered by `stop_order`, each row shows its position, type
   ("Collection", "Delivery", or the raw value), address line, city and
   postcode. When `geocodeSettled` is true and a stop has no `lat`/`lng`, the
   row carries the same "no map fix" mark the card uses.
5. **Items**: SKU, description, quantity, serial count and external reference
   per item. The section is omitted when the job has no items.
6. **Actions**, right-aligned at the bottom:
   - **Accept**: shown only while `status === "pending_acceptance"`. Closes
     the detail dialog and opens the existing Accept dialog.
   - **Print labels**: the existing `JobLabelPrinter` from `app/jobs`, given
     the job's reference, customer, stops and items.
   - **Open in Jobs**: a link to `/jobs?job=<id>` styled with
     `buttonClasses("secondary")`. This is the old click behaviour.

### Read-only board

The dialog is available while "All tenants" is selected. Viewing needs no
tenant, and Accept already refuses on its own through `planningReadOnly()`.

## Components and files

### New: `app/planning/JobDetailDialog.tsx`

Client component. Props:

```ts
type Props = {
  job: PlanJob;
  vehicleLabel: string | null;   // registration, "Unknown", or null when unassigned
  driverLabel: string | null;    // name, "Unknown", or null when none
  timeZone: string;
  geocodeSettled: boolean;
  onClose: () => void;
  onAccept: (jobId: string) => void;
};
```

The dialog is rendered through the shared `components/Modal.tsx`, which the
Jobs delete dialog already uses and which owns the backdrop, `role="dialog"`,
`aria-modal`, Escape and backdrop-click closing. `Modal` gains an optional
`size?: "md" | "lg"` prop (`lg` is `max-w-2xl`; the default `md` keeps the
delete dialog unchanged) and its body scrolls (`max-h-[85vh]` on the panel,
`overflow-y-auto` on the body) so a job with many stops or items stays
usable. The reference is the modal title; customer and status sit at the top
of the body.

### New: `lib/planning/jobDetail.ts` and `jobDetail.test.ts`

Pure helpers, so vitest covers them:

- `jobStatusLabel(status: string | null): string`, the Jobs page rule above.
- `formatEta(value: string | null, timeZone: string): string`, `Intl`-based
  date and time in the given zone, "-" for null or unparseable input.
- `stopTypeLabel(type: string | null): string`.
- `toLabelStops(stops: PlanStop[]): LabelStop[]`, narrowing `type` to
  `"collection" | "delivery"` for the label printer and dropping stops with
  any other type, because the printer's stop selection keys on those two
  values.
- `draftAssignment(jobId, laneOrders, laneDrivers)`: returns
  `{ vehicleId: string | null; driverId: string | null }` by finding the lane
  that contains the job. Pure so the "draft, not saved" rule is tested.

Tests cover: both status branches and null; ETA formatting in
`Europe/London` across a BST boundary and for null; stop type narrowing;
draft assignment for an assigned, an unassigned and a moved job.

### Changed: `components/Modal.tsx`

Adds the `size` prop and the scrolling body described above, plus four
review follow-ups that also reach the existing consumers (DeleteJobDialog and
the super-admin MoveTenantModal): the title id comes from `useId` so two
mounted modals cannot share one; the footer wraps so four controls fit at
phone width; the focus-and-Escape effect depends on `open` only, with
`onClose` held in a ref, because callers pass inline arrows and the Planning
page re-renders on a 30-second position poll (with `onClose` in the deps that
poll pulled focus back to the panel, and in MoveTenantModal every keystroke
did); and focus returns to whatever had it when the dialog opened.

### Changed: `app/planning/page.tsx`

- New state `detailJobId: string | null`.
- Both `onOpenJob={(jobId) => router.push(...)}` callbacks become
  `onOpenJob={setDetailJobId}`.
- An effect clears `detailJobId` when `jobById` no longer contains it.
- Renders `<JobDetailDialog>` after the acceptance dialog when
  `detailJobId` resolves to a job, passing the labels computed through
  `draftAssignment`, `vehicles` and `drivers`. Both dialogs sit inside the
  page's `ds` root div. The acceptance dialog used to render after that div
  closed, so it had no borders or Plex font; moving it in is a two-line fix
  taken with this change because Accept opens it straight from the new
  dialog.
- The `useRouter` import and the `router` const are removed: the two
  navigations were its only uses in the page.

### Changed: `app/jobs/JobLabelPrinter.tsx`

The printer's full-screen overlay is rendered through `createPortal` to
`document.body` instead of inline. Inside the Modal it would otherwise sit
under a fixed, max-height, scrolling ancestor, and the print stylesheet's
`position: absolute` label root would be clipped to the modal body, so a
multi-page label run printed from the dialog would come out truncated.
Because the portal leaves every ancestor, the overlay root carries the `ds`
reset and `font-sans` itself (the `.ds` scope is per page root, not on
`body`), and it gets dialog semantics (`role="dialog"`, `aria-modal`, a
`useId` label), takes focus on open and hands it back on close, so keyboard
and screen-reader users can still reach it. Escape inside the overlay closes
only the overlay: the handler calls `stopImmediatePropagation` on the native
event, because Modal's Escape listener sits on `document`, which is also
React's root container, so a synthetic `stopPropagation` would not stop it.
The Jobs page gets the same overlay behaviour.

### Unchanged

`PlanJobCard.tsx`, `VehicleLane.tsx`, `UnassignedPool.tsx`.

## Error handling

There is nothing to fetch, so the only failure modes are missing data, and
each is rendered as a placeholder ("-", "Unknown", "No stops") rather than
thrown. The label printer already validates its own inputs.

## Testing

- `lib/planning/jobDetail.test.ts` as above; runs under `npm test` with the
  pinned `Europe/London` timezone.
- `npm run typecheck` for the page and component changes.
- Manual, signed in: click a card in a lane and in the unassigned pool,
  confirm the dialog opens with the right job, close it by each of the three
  routes, drag a card and confirm no dialog opens, open Accept from the
  dialog, print labels, and follow Open in Jobs to the expanded job.

## Documentation

`README.md`'s page inventory entry for Planning gains a line saying job cards
open an in-board detail dialog with a link to Jobs.
