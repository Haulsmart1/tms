import {
  describe,
  expect,
  it } from "vitest";
import {
  activitiesOverlap,
  normalizeDriverActivity,
  parseComplianceTimestamp,
  validateTransportInterruption,
} from "./activity";

describe("normalizeDriverActivity", () => {
  it("normalizes UTC instants into the tenant calendar", () => {
    const result = normalizeDriverActivity(
      {
        id: "a1",
        activityType: "Driving",
        activityKind: "driving",
        startTime: "2026-08-14T23:30:00Z",
        endTime: "2026-08-15T00:30:00Z",
        durationMinutes: 60,
        source: "tachograph",
      },
      "Europe/London",
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.activity.localStartDay).toBe("2026-08-15");
    expect(result.activity.localEndDay).toBe("2026-08-15");
    expect(result.activity.elapsedMilliseconds).toBe(3_600_000);
    expect(result.activity.durationMismatch).toBe(false);
  });

  it("keeps elapsed duration correct over the autumn clock change", () => {
    const result = normalizeDriverActivity(
      {
        id: "a2",
        activityType: "Rest",
        activityKind: "rest",
        startTime: "2026-10-25T00:30:00Z",
        endTime: "2026-10-25T02:30:00Z",
        durationMinutes: 120,
      },
      "Europe/London",
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.activity.elapsedMilliseconds).toBe(7_200_000);
    expect(result.activity.durationMismatch).toBe(false);
  });

  it("flags imported duration that disagrees with the timestamps", () => {
    const result = normalizeDriverActivity(
      {
        id: "a3",
        activityType: "Other work",
        activityKind: "other_work",
        startTime: "2026-08-15T08:00:00Z",
        endTime: "2026-08-15T09:00:00Z",
        durationMinutes: 30,
      },
      "Europe/London",
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.activity.durationMismatch).toBe(true);
  });

  it("returns incomplete-style failure for an invalid timezone", () => {
    expect(
      normalizeDriverActivity(
        {
          id: "a4",
          activityType: "Driving",
          activityKind: "driving",
          startTime: "2026-08-15T08:00:00Z",
          endTime: "2026-08-15T09:00:00Z",
        },
        "Invalid/Zone",
      ),
    ).toEqual({
      ok: false,
      reason: "Invalid IANA timezone: Invalid/Zone",
    });
  });

  it("returns failure for reversed timestamps", () => {
    const result = normalizeDriverActivity(
      {
        id: "a5",
        activityType: "Driving",
        activityKind: "driving",
        startTime: "2026-08-15T09:00:00Z",
        endTime: "2026-08-15T08:00:00Z",
      },
      "Europe/London",
    );

    expect(result.ok).toBe(false);
  });
});

describe("activitiesOverlap", () => {
  function activity(
    id: string,
    startTime: string,
    endTime: string,
  ) {
    const result = normalizeDriverActivity(
      {
        id,
        activityType: "Driving",
        activityKind: "driving",
        startTime,
        endTime,
      },
      "Europe/London",
    );

    if (!result.ok) {
      throw new Error(result.reason);
    }

    return result.activity;
  }

  it("detects intersecting activity periods", () => {
    expect(
      activitiesOverlap(
        activity(
          "a",
          "2026-08-15T08:00:00Z",
          "2026-08-15T10:00:00Z",
        ),
        activity(
          "b",
          "2026-08-15T09:00:00Z",
          "2026-08-15T11:00:00Z",
        ),
      ),
    ).toBe(true);
  });

  it("does not mark touching periods as overlapping", () => {
    expect(
      activitiesOverlap(
        activity(
          "a",
          "2026-08-15T08:00:00Z",
          "2026-08-15T09:00:00Z",
        ),
        activity(
          "b",
          "2026-08-15T09:00:00Z",
          "2026-08-15T10:00:00Z",
        ),
      ),
    ).toBe(false);
  });
});
describe("compliance timestamp safety", () => {
  it("accepts UTC Z timestamps", () => {
    expect(
      parseComplianceTimestamp("2026-08-31T12:00:00Z").toISOString(),
    ).toBe("2026-08-31T12:00:00.000Z");
  });

  it("accepts explicit positive and negative UTC offsets", () => {
    expect(
      parseComplianceTimestamp("2026-08-31T13:00:00+01:00").toISOString(),
    ).toBe("2026-08-31T12:00:00.000Z");

    expect(
      parseComplianceTimestamp("2026-08-31T07:00:00-05:00").toISOString(),
    ).toBe("2026-08-31T12:00:00.000Z");
  });

  it("rejects timezone-naive compliance timestamps", () => {
    expect(() =>
      parseComplianceTimestamp("2026-08-31T12:00:00"),
    ).toThrow(/explicit UTC offset/i);
  });

  it("accepts a ferry interruption inside its event", () => {
    expect(() =>
      validateTransportInterruption(
        {
          boardingTime: "2026-08-31T10:00:00Z",
          disembarkTime: "2026-08-31T14:00:00Z",
        },
        {
          startTime: "2026-08-31T10:15:00Z",
          endTime: "2026-08-31T10:30:00Z",
        },
      ),
    ).not.toThrow();
  });

  it("rejects a ferry interruption outside its event", () => {
    expect(() =>
      validateTransportInterruption(
        {
          boardingTime: "2026-08-31T10:00:00Z",
          disembarkTime: "2026-08-31T14:00:00Z",
        },
        {
          startTime: "2026-08-31T09:55:00Z",
          endTime: "2026-08-31T10:10:00Z",
        },
      ),
    ).toThrow(/within the ferry\/train event/i);
  });
});
