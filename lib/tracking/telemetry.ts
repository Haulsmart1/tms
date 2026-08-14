import { pingLabel, signalState, speedLabel, type PositionReading } from "./position";

export type Tile = {
  label: string;
  value: string;
  /** Render in the muted ink colour: this value is absent or not trustworthy. */
  muted: boolean;
  /** Explains an absent value. Rendered as a title attribute and for screen readers. */
  hint?: string;
};

export const ROUTING_HINT = "Available once telematics routing is connected";

const NO_SIGNAL = "No signal";

/* The mockup's four header slots. Two of them cannot be filled today and say
   so rather than guessing:

   Distance to go and ETA both need road routing. A straight-line haversine
   from the last fix to a destination postcode is not a road distance, and it
   would be wrong by a different amount on every job, which is the worst kind
   of wrong: plausible. They stay blank until TomTom Routing exists. */
export function telemetryTiles(reading: PositionReading | null, now: Date): Tile[] {
  const state = signalState(reading, now);

  /* speedLabel returns null when the source gave a speed that cannot be
     rendered, which from this tile's point of view is the same situation as
     having no fix at all: it takes the NO_SIGNAL treatment. A "Stationary"
     that came back non-null is a real reading, so it is NOT muted. */
  const speedValue = state === "live" && reading ? speedLabel(reading) : null;
  const speed: Tile = speedValue
    ? { label: "Speed", value: speedValue, muted: false }
    : { label: "Speed", value: NO_SIGNAL, muted: true };

  const ping: Tile =
    state === "none"
      ? { label: "Last ping", value: NO_SIGNAL, muted: true }
      : { label: "Last ping", value: pingLabel(reading, now), muted: state === "stale" };

  return [
    speed,
    { label: "Distance to go", value: "—", muted: true, hint: ROUTING_HINT },
    ping,
    { label: "ETA", value: "—", muted: true, hint: ROUTING_HINT },
  ];
}
