import { signalState, type PositionReading } from "../../lib/tracking/position";
import type { TrackingStop } from "../../lib/tracking/types";

type Props = {
  stops: TrackingStop[];
  reading: PositionReading | null;
  now: Date;
};

/* THE MAP SEAM.

   These props are already the ones a real TomTom Maps mount needs: the stops
   to draw a route through, and the reading to place the vehicle. Wiring TomTom
   later changes this file's internals and nothing else.

   Today it renders a labelled placeholder rather than a spinner or a fake map
   image. A spinner would claim something is loading that is not, and a static
   map picture would be a lie about a live system. */

const HEIGHT = 260;

export default function TrackingMap({ stops, reading, now }: Props) {
  const state = signalState(reading, now);
  const stopCount = stops.length;

  const message =
    state === "none"
      ? "Vehicle positions appear here once telematics is connected."
      : "Map tiles appear here once telematics is connected.";

  return (
    <section
      aria-label="Vehicle position map"
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 p-6 text-center shadow-sm"
      style={{ height: HEIGHT }}
    >
      <p className="text-sm font-semibold text-ink-2">{message}</p>
      <p className="max-w-[42ch] text-xs text-ink-3">
        {stopCount > 0
          ? `This job has ${stopCount} ${stopCount === 1 ? "stop" : "stops"} ready to plot.`
          : "This job has no stops to plot."}
      </p>
    </section>
  );
}
