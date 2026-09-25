"use client";

import Link from "next/link";
import Modal from "../../components/Modal";
import Button, { buttonClasses } from "../../components/Button";
import JobLabelPrinter from "../jobs/JobLabelPrinter";
import {
  ABSENT,
  assignmentLabel,
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

  const assignment = assignmentLabel({
    subcontracted: job.subcontractor_id !== null,
    vehicleLabel,
    driverLabel,
  });

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
                    <span className="text-ink-3" aria-hidden>{index + 1}</span>
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
