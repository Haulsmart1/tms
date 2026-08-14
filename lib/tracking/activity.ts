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
