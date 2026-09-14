import { describe, expect, it } from "vitest";
import {
  GPS_BACKOFF_MAX_MS,
  classifyLocationFailure,
  enqueuePosition,
  nextBackoffMs,
} from "./gpsRetry";

describe("classifyLocationFailure", () => {
  it("retries network failures, timeouts, rate limits and server errors", () => {
    expect(classifyLocationFailure(null)).toBe("retry");
    expect(classifyLocationFailure(408)).toBe("retry");
    expect(classifyLocationFailure(429)).toBe("retry");
    expect(classifyLocationFailure(500)).toBe("retry");
    expect(classifyLocationFailure(503)).toBe("retry");
  });

  it("stops on auth and assignment problems", () => {
    expect(classifyLocationFailure(401)).toBe("stop");
    expect(classifyLocationFailure(403)).toBe("stop");
    expect(classifyLocationFailure(409)).toBe("stop");
  });

  it("drops a position the server rejected as invalid", () => {
    expect(classifyLocationFailure(400)).toBe("drop");
    expect(classifyLocationFailure(413)).toBe("drop");
  });
});

describe("nextBackoffMs", () => {
  it("doubles from 5 seconds and caps at 2 minutes", () => {
    expect(nextBackoffMs(0)).toBe(5_000);
    expect(nextBackoffMs(1)).toBe(10_000);
    expect(nextBackoffMs(3)).toBe(40_000);
    expect(nextBackoffMs(10)).toBe(GPS_BACKOFF_MAX_MS);
    expect(nextBackoffMs(1_000_000)).toBe(GPS_BACKOFF_MAX_MS);
    expect(nextBackoffMs(-3)).toBe(5_000);
  });
});

describe("enqueuePosition", () => {
  it("keeps the newest positions up to the limit", () => {
    let queue: number[] = [];
    for (let i = 0; i < 5; i += 1) queue = enqueuePosition(queue, i, 3);
    expect(queue).toEqual([2, 3, 4]);
  });

  it("does not mutate the input", () => {
    const queue = [1];
    enqueuePosition(queue, 2);
    expect(queue).toEqual([1]);
  });
});
