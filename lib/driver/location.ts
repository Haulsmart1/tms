export type DriverLocationPayload = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export function parseDriverLocation(
  value: unknown,
): DriverLocationPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid GPS location.");
  }

  const input = value as Record<string, unknown>;
  const latitude = finiteNumber(input.latitude);
  const longitude = finiteNumber(input.longitude);
  const accuracy = finiteNumber(input.accuracy);
  const speedKph = finiteNumber(input.speedKph);
  const heading = finiteNumber(input.heading);

  if (
    latitude === null ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("Invalid GPS latitude.");
  }

  if (
    longitude === null ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Invalid GPS longitude.");
  }

  if (accuracy !== null && accuracy < 0) {
    throw new Error("Invalid GPS accuracy.");
  }

  if (speedKph !== null && speedKph < 0) {
    throw new Error("Invalid GPS speed.");
  }

  if (
    heading !== null &&
    (heading < 0 || heading > 360)
  ) {
    throw new Error("Invalid GPS heading.");
  }

  if (typeof input.recordedAt !== "string") {
    throw new Error("Invalid GPS timestamp.");
  }

  const recordedDate = new Date(input.recordedAt);

  if (Number.isNaN(recordedDate.getTime())) {
    throw new Error("Invalid GPS timestamp.");
  }

  const now = Date.now();
  const futureToleranceMs = 2 * 60 * 1000;
  const oldestAllowedMs = 24 * 60 * 60 * 1000;

  if (recordedDate.getTime() > now + futureToleranceMs) {
    throw new Error("GPS timestamp is in the future.");
  }

  if (recordedDate.getTime() < now - oldestAllowedMs) {
    throw new Error("GPS timestamp is too old.");
  }

  return {
    latitude,
    longitude,
    accuracy,
    speedKph,
    heading,
    recordedAt: recordedDate.toISOString(),
  };
}

export function metresPerSecondToKph(
  speed: number | null,
): number | null {
  if (
    speed === null ||
    !Number.isFinite(speed) ||
    speed < 0
  ) {
    return null;
  }

  return speed * 3.6;
}
