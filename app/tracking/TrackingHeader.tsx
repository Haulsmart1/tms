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
