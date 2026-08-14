import { pingLabel, signalState, type PositionReading } from "./position";

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

  const speed: Tile =
    state === "live" && reading
      ? {
          label: "Speed",
          value: reading.speedKph > 0 ? `${Math.round(reading.speedKph)} km/h` : "Stationary",
          muted: false,
        }
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
