import { describe, expect, it } from "vitest";
import { geocodeRetryAfterHours, shouldRetryGeocode } from "./geocodeRetry";

describe("geocode failure backoff (PLAN-13)", () => {
  const now = new Date("2026-09-14T12:00:00Z");

  it("always tries a stop that has never failed", () => {
    expect(shouldRetryGeocode(null, 0, now)).toBe(true);
  });

  it("does not retry a recent failure on the next tracking poll", () => {
    expect(shouldRetryGeocode("2026-09-14T11:59:30Z", 1, now)).toBe(false);
  });

  it("retries after the backoff, which doubles and is capped", () => {
    expect(shouldRetryGeocode("2026-09-14T06:00:00Z", 1, now)).toBe(true);
    expect(shouldRetryGeocode("2026-09-14T06:00:00Z", 2, now)).toBe(false);
    expect(geocodeRetryAfterHours(1)).toBe(6);
    expect(geocodeRetryAfterHours(3)).toBe(24);
    expect(geocodeRetryAfterHours(20)).toBe(168);
  });

  it("treats an unreadable timestamp as retryable", () => {
    expect(shouldRetryGeocode("garbage", 3, now)).toBe(true);
  });
});
