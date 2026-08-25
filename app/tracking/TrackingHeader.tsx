import Link from "next/link";
import Badge from "../../components/Badge";
import Card from "../../components/Card";
import RouteProgress from "../../components/RouteProgress";
import { PHASE_LABEL, PHASE_TONE, routeEndpoints, type Phase } from "../../lib/tracking/onTheRoad";
import { arrowStateFor, routeGlyph, type JourneyNode } from "../../lib/tracking/journey";
import {
  FUTURE_TOLERANCE_MINUTES,
  pingLabel,
  readingAgeMinutes,
  signalState,
  type PositionReading,
} from "../../lib/tracking/position";
import { telemetryTiles } from "../../lib/tracking/telemetry";
import type { TrackingJob } from "../../lib/tracking/types";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   borders here depend on the scoped reset in app/globals.css supplying
   border-style: solid. Outside `.ds` the borders disappear entirely. */

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
    /* signalState folds a broken device clock into `stale`, but pingLabel's
       vocabulary for it is "clock ahead", a standalone phrase the telemetry
       tile renders on its own. Prefixing it here would read "Last seen clock
       ahead", which is not a sentence. This branch says the same thing as one
       instead, and pingLabel is left alone for the tile's sake. */
    const age = reading ? readingAgeMinutes(reading, now) : null;
    const clockAhead = age !== null && age < -FUTURE_TOLERANCE_MINUTES;

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-strong">
        <span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-warning" />
        {clockAhead ? "Device clock ahead" : `Last seen ${pingLabel(reading, now)}`}
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

  const { origin, destination } = routeEndpoints(job.stops);

  /* The visible route keeps routeEndpoints' "—" fallback, which is the right
     thing to SHOW. It is the wrong thing to SAY: a screen reader announces the
     glyph as "em dash", so the aria label below swaps in words instead. */
  const spokenOrigin = origin === "—" ? "Unknown origin" : origin;
  const spokenDestination = destination === "—" ? "Unknown destination" : destination;
  const stopCount = glyph.nodes.length;

  const isSubcontracted = Boolean(job.subcontractor_id);
  // A tel: link only when there is actually a number and the driver is ours.
  // Rendering a dead "Call driver" control is worse than rendering none.
  // Whitespace is legal in the column but not in a tel: URI (RFC 3966). UK
  // numbers are commonly stored as "07700 900123".
  const driverPhone = isSubcontracted ? null : job.driver_phone?.replace(/\s/g, "") || null;

  const subtitle = [
    job.customer_name ?? "No customer",
    `${origin} → ${destination}`,
    isSubcontracted ? `${job.driver_name ?? "Carrier"} (carrier)` : (job.driver_name ?? "No driver"),
  ].join(" · ");

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-md font-semibold tabular-nums text-ink">
          {job.vehicle_registration ?? "—"}
        </span>
        <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
        <GpsPill reading={reading} now={now} />

        <span className="flex-1" />

        {driverPhone ? (
          <a
            href={`tel:${driverPhone}`}
            className="rounded-sm border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-hover"
          >
            Call {job.driver_name ?? "driver"}
          </a>
        ) : null}

        {/* "All jobs", not "Job detail": app/jobs/ has no dynamic route, so
            there is no per-job page to send anyone to. The destination was
            always honest; the label was not. */}
        <Link
          href="/jobs"
          className="rounded-sm px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          All jobs
        </Link>
      </div>

      <p className="mt-1 text-xs text-ink-3">{subtitle}</p>

      <div className="mt-4">
        <RouteProgress
          nodes={glyph.nodes}
          arrowState={glyph.arrowState}
          label={`${spokenOrigin} to ${spokenDestination}, ${stopCount} ${
            stopCount === 1 ? "stop" : "stops"
          }, ${PHASE_LABEL[phase].toLowerCase()}`}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3.5 border-t border-line pt-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0">
            <dt className="truncate text-kicker uppercase text-ink-3">{tile.label}</dt>
            {/* The hint is rendered ONCE, in the sr-only span. It used to also
                sit in a title attribute, and several screen readers announce
                both, so the explanation was read out twice. title is mouse-only
                anyway; the span is the load-bearing one. */}
            <dd
              className={`m-0 font-mono text-md font-semibold tabular-nums ${
                tile.muted ? "text-ink-3" : "text-ink"
              }`}
            >
              {tile.value}
              {tile.hint ? <span className="sr-only"> ({tile.hint})</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
