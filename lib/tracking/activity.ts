import type { TrackingJob, TrackingStop } from "./types";

export type ActivityEvent = {
  id: string;
  /** Whatever PostgREST returned for the source timestamp column, used only
   * for sorting here. The component must format it in OPERATOR_TIME_ZONE
   * (lib/time.ts), the same zone the Journey card pins: format it without
   * that zone and the two cards disagree about the calendar, which gives
   * Next.js a hydration mismatch for an hour of every summer afternoon. */
  at: string;
  text: string;
};

/* THE FEED USES NO EXTRA TABLES AND NO EXTRA QUERY.

   The design spec listed pod_records, pod_files and job_documents as sources.
   Nothing in this repo writes any of them, so they would contribute exactly
   zero events while costing three joins. job_stops.pod_updated_at IS written,
   but only by the /pod save path (app/pod/page.tsx). app/jobs/page.tsx has a
   second savePod that writes delivered_at, pod_status and pod_photo_url but
   never pod_updated_at, so a stop POD'd from /jobs would otherwise hide a
   real file behind a null stamp. The evidence event below falls back to
   delivered_at for its stamp for that reason.

   Every line here is something that provably happened. When a position feed
   exists, departed and arrived events join this list from the same function. */

type EventKind = "delivered" | "evidence" | "created";

/* Both stamps for one stop are written a statement apart in app/pod/page.tsx,
   so an exact tie is the normal case, not an edge case. Rank makes the
   resulting order a decision rather than a side effect of how the id suffixes
   happen to sort: the file is uploaded before the stop is marked delivered,
   so newest-first puts "Delivered" above "POD evidence attached". */
const KIND_RANK: Record<EventKind, number> = { delivered: 0, evidence: 1, created: 2 };

type BuiltEvent = ActivityEvent & { kind: EventKind };

function stopPlace(stop: TrackingStop): string {
  return stop.city || stop.postcode || "an unnamed stop";
}

export function buildActivity(job: TrackingJob): ActivityEvent[] {
  const events: BuiltEvent[] = [];

  if (job.created_at) {
    events.push({
      id: `${job.id}:created`,
      at: job.created_at,
      text: job.reference ? `Job ${job.reference} created` : "Job created",
      kind: "created",
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
      events.push({ id: `${stop.id}:delivered`, at: stop.delivered_at, text, kind: "delivered" });
    }

    // pod_updated_at alone proves only that the POD form was saved. Requiring a
    // file too means this line always corresponds to evidence a dispatcher can
    // actually open. /jobs writes the file without pod_updated_at (see header
    // comment above), so fall back to delivered_at for the stamp rather than
    // hiding a real file.
    const hasEvidence = Boolean(stop.pod_photo_url || stop.pod_document_url);
    const evidenceAt = stop.pod_updated_at ?? stop.delivered_at;
    if (hasEvidence && evidenceAt) {
      events.push({
        id: `${stop.id}:evidence`,
        at: evidenceAt,
        text: `POD evidence attached at ${stopPlace(stop)}`,
        kind: "evidence",
      });
    }
  }

  // Newest first by stamp, using < / > rather than localeCompare: ICU
  // collation gives punctuation variable weight and disagrees with chronology
  // once one stamp carries fractional seconds and another does not. Ties on
  // the stamp fall to KIND_RANK, and only two different stops sharing both a
  // stamp and a kind fall through to the id, which is a genuine string sort.
  events.sort((a, b) => {
    if (a.at < b.at) return 1;
    if (a.at > b.at) return -1;
    const byRank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return byRank !== 0 ? byRank : a.id.localeCompare(b.id);
  });

  return events.map(({ kind, ...event }) => event);
}
