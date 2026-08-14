import Card from "../../components/Card";
import type { ActivityEvent } from "../../lib/tracking/activity";
import { OPERATOR_TIME_ZONE } from "../../lib/time";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   borders here depend on the scoped reset in app/globals.css supplying
   border-style: solid. Outside `.ds` the borders disappear entirely. */

type Props = { events: ActivityEvent[] };

// Same operator calendar as the journey timeline and /pod. See lib/time.ts.
const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: OPERATOR_TIME_ZONE,
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

function stamp(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "—" : STAMP.format(d);
}

export default function ActivityFeed({ events }: Props) {
  return (
    /* <Card flush> renders exactly the chrome this used to hand-roll, and
       TrackingRail already uses it for the same header-plus-list shape. The
       element goes from <section> to <div>, which changes nothing for assistive
       technology: a <section> only becomes a `region` landmark once it has an
       accessible name, and this one never had one. */
    <Card flush>
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <h2 className="flex-1 text-sm font-semibold text-ink">Activity</h2>
        <span className="font-mono text-data-sm tabular-nums text-ink-3">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </header>

      {events.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-3">Nothing recorded for this job yet.</p>
      ) : (
        <ol className="m-0 list-none px-5 py-4">
          {events.map((event, i) => (
            <li key={event.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-3">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-1 block h-2 w-2 flex-none rounded-full border-2 ${
                    i === 0 ? "border-primary bg-primary" : "border-line-strong bg-surface"
                  }`}
                />
                {i < events.length - 1 ? (
                  <span aria-hidden className="mt-1 w-0 flex-1 border-l-2 border-line" />
                ) : null}
              </div>
              <div className="min-w-0 pb-3.5">
                <p className="text-sm text-ink">{event.text}</p>
                <p className="mt-0.5 font-mono text-data-sm tabular-nums text-ink-3">{stamp(event.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
