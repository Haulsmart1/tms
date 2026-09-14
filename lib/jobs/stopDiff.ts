/*
  Plan the writes for editing a job's stops, instead of deleting and
  recreating them (review POD-1).

  The old save deleted every job_stops row and inserted fresh ones. That wiped
  recipient names, delivery times and POD notes, changed the stop ids a driver
  on site was using, and failed half-applied once a barcode scan referenced a
  stop. This keeps ids stable:

  - a submitted stop with an id updates that row in place,
  - a submitted stop without an id is inserted,
  - an existing stop that is no longer submitted is deleted, but only when it
    has no POD recorded, no evidence and no scans.

  A stop with POD recorded ("locked") keeps its address and type: the form can
  reorder it, nothing more. Any refused change fails the whole plan before a
  single write, so an edit is never half-applied by this rule.

  Pure: the page loads the counts and performs the writes.
*/

export type StopType = "collection" | "delivery";

export type ExistingStop = {
  id: string;
  stop_order: number;
  type: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  status: string | null;
  pod_status: string | null;
  delivered_at?: string | null;
  collected_at?: string | null;
  recipient_name?: string | null;
  evidenceCount: number;
  scanCount: number;
};

export type SubmittedStop = {
  id?: string | null;
  type: StopType;
  address_line: string;
  city: string;
  postcode: string;
};

export type StopFields = {
  stop_order: number;
  type: StopType;
  address_line: string;
  city: string | null;
  postcode: string | null;
};

export type StopPlan =
  | {
      ok: true;
      updates: Array<{ id: string; patch: Partial<StopFields> }>;
      inserts: StopFields[];
      deletes: string[];
    }
  | { ok: false; message: string };

const OPEN_POD_STATUSES = new Set(["", "pending"]);
const FINISHED_STOP_STATUSES = new Set(["completed", "delivered", "collected"]);

/** A stop with any POD outcome recorded is not editable through the job form. */
export function isStopLocked(stop: Pick<ExistingStop, "status" | "pod_status" | "delivered_at" | "collected_at">): boolean {
  if (!OPEN_POD_STATUSES.has(String(stop.pod_status ?? "").trim())) return true;
  if (FINISHED_STOP_STATUSES.has(String(stop.status ?? "").trim())) return true;
  return Boolean(stop.delivered_at) || Boolean(stop.collected_at);
}

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function label(stop: { stop_order: number; type: string }): string {
  return `${stop.type === "collection" ? "Collection" : "Delivery"} stop ${stop.stop_order}`;
}

export function planStopChanges(existing: readonly ExistingStop[], submitted: readonly SubmittedStop[]): StopPlan {
  const byId = new Map(existing.map((stop) => [stop.id, stop]));
  const seen = new Set<string>();

  const updates: Array<{ id: string; patch: Partial<StopFields> }> = [];
  const inserts: StopFields[] = [];

  for (let index = 0; index < submitted.length; index += 1) {
    const stop = submitted[index];
    const fields: StopFields = {
      stop_order: index + 1,
      type: stop.type,
      address_line: String(stop.address_line ?? "").trim(),
      city: clean(stop.city),
      postcode: clean(stop.postcode),
    };

    if (!stop.id) {
      inserts.push(fields);
      continue;
    }

    const current = byId.get(stop.id);
    if (!current || seen.has(stop.id)) {
      return { ok: false, message: "This job's stops changed since you opened it. Refresh and try again." };
    }
    seen.add(stop.id);

    const contentChanged =
      current.type !== fields.type ||
      clean(current.address_line) !== fields.address_line ||
      clean(current.city) !== fields.city ||
      clean(current.postcode) !== fields.postcode;

    if (isStopLocked(current)) {
      if (contentChanged) {
        return { ok: false, message: `${label(current)} has POD recorded, so its address and type cannot be edited.` };
      }
      if (current.stop_order !== fields.stop_order) {
        updates.push({ id: current.id, patch: { stop_order: fields.stop_order } });
      }
      continue;
    }

    if (contentChanged || current.stop_order !== fields.stop_order) {
      updates.push({ id: current.id, patch: fields });
    }
  }

  const deletes: string[] = [];
  for (const stop of existing) {
    if (seen.has(stop.id)) continue;
    if (isStopLocked(stop)) {
      return { ok: false, message: `${label(stop)} has POD recorded and cannot be removed.` };
    }
    if (stop.evidenceCount > 0 || stop.scanCount > 0) {
      return { ok: false, message: `${label(stop)} has POD evidence or barcode scans and cannot be removed.` };
    }
    deletes.push(stop.id);
  }

  if (submitted.length === 0) {
    return { ok: false, message: "Add at least one stop." };
  }

  return { ok: true, updates, inserts, deletes };
}
