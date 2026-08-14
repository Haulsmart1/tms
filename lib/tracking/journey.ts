import { isLive, pingLabel, type PositionReading } from "./position";
import type { TrackingStop } from "./types";
// Type-only import. RouteProgress is shared, its node shape is shared, and
// nothing at runtime crosses from tracking into pod.
import type { ArrowState, RouteNode } from "../pod/routeNodes";

export type JourneyStopState = "done" | "current" | "upcoming";

export type JourneyNode =
  | {
      kind: "stop";
      id: string;
      state: JourneyStopState;
      /** "Hull HU3 4AB" */
      label: string;
      addressLine: string | null;
      caption: string;
      when: string;
      isLast: boolean;
    }
  | {
      kind: "live";
      id: "live";
      speedLabel: string;
      pingLabel: string;
    };

/* Formatting is pinned to Europe/London rather than the runtime default. The
   fleet is UK-based (£ and en-GB throughout this codebase), and pinning it
   also makes these functions deterministic under Vitest, which would otherwise
   format against whatever TZ the machine happens to have. */
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
});

function formatWhen(stop: TrackingStop): string {
  /* delivered_at is a real event stamp, so it earns a time. planned_at is NOT:
     app/jobs/page.tsx writes it as `${scheduled_date}T08:00:00`, so showing a
     time from it would present a fabricated 8am as a booked slot. Date only.
     See lib/pod/overdue.ts, which documents the same column. */
  if (stop.delivered_at) {
    const d = new Date(stop.delivered_at);
    if (!Number.isNaN(d.getTime())) return `${DATE_FMT.format(d)} ${TIME_FMT.format(d)}`;
  }
  if (stop.planned_at) {
    const d = new Date(stop.planned_at);
    if (!Number.isNaN(d.getTime())) return DATE_FMT.format(d);
  }
  return "—";
}

function captionFor(stop: TrackingStop, state: JourneyStopState, isLast: boolean): string {
  if (state === "done") return stop.type === "collection" ? "Collected" : "Delivered";
  if (isLast) return "Destination";
  if (state === "current") return "Next stop";
  return "Waypoint";
}

export function buildJourney(
  stops: TrackingStop[],
  reading: PositionReading | null,
  now: Date,
): JourneyNode[] {
  const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);
  const currentIndex = ordered.findIndex((s) => s.pod_status !== "delivered");
  const showLive = isLive(reading, now);

  const nodes: JourneyNode[] = [];

  ordered.forEach((stop, i) => {
    const isLast = i === ordered.length - 1;
    const state: JourneyStopState =
      stop.pod_status === "delivered" ? "done" : i === currentIndex ? "current" : "upcoming";

    /* The live marker goes immediately BEFORE the stop being travelled to,
       which is how the mockup reads: the truck is between the last completed
       stop and the next one. A stale or absent fix inserts nothing at all
       rather than a marker nobody can date. */
    if (state === "current" && showLive && reading) {
      nodes.push({
        kind: "live",
        id: "live",
        speedLabel: reading.speedKph > 0 ? `${Math.round(reading.speedKph)} km/h` : "Stationary",
        pingLabel: `updated ${pingLabel(reading, now)}`,
      });
    }

    nodes.push({
      kind: "stop",
      id: stop.id,
      state,
      label: [stop.city, stop.postcode].filter(Boolean).join(" ") || "Unnamed stop",
      addressLine: stop.address_line,
      caption: captionFor(stop, state, isLast),
      when: formatWhen(stop),
      isLast,
    });
  });

  return nodes;
}

export function arrowStateFor(journey: JourneyNode[], isLate: boolean): ArrowState {
  const stopNodes = journey.filter((n) => n.kind === "stop");
  if (stopNodes.length > 0 && stopNodes.every((n) => n.kind === "stop" && n.state === "done")) {
    return "delivered";
  }
  return isLate ? "overdue" : "pending";
}

/** Adapts the journey to the node shape components/RouteProgress.tsx expects. */
export function routeGlyph(
  journey: JourneyNode[],
  arrowState: ArrowState,
): { nodes: RouteNode[]; arrowState: ArrowState } {
  const nodes: RouteNode[] = journey
    .filter((n) => n.kind === "stop")
    .map((n) => ({ id: n.id, state: (n as Extract<JourneyNode, { kind: "stop" }>).state }));
  return { nodes, arrowState };
}
