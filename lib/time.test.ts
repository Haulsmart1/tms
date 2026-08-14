import { describe, it, expect } from "vitest";
import { OPERATOR_TIME_ZONE, operatorDay } from "./time";

/* THE TEST vitest.config.ts CANNOT MAKE POINTLESS.

   That config pins TZ=Europe/London so timezone-sensitive tests discriminate
   on every machine. The side effect is that a runtime-local implementation and
   an OPERATOR_TIME_ZONE one agree on every ordinary instant, so no test in
   lib/tracking/ can prove which of the two is actually doing the work.

   The instants below are chosen to fall on DIFFERENT calendar days in UTC and
   in London. A getFullYear/getMonth/getDate implementation would pass them
   under the pinned TZ and fail on a UTC laptop or on Vercel, which is exactly
   the bug operatorDay exists to end. */

describe("operatorDay", () => {
  it("returns the LONDON day for an instant that is the previous day in UTC", () => {
    // 23:30 on the 14th UTC is 00:30 on the 15th in London during BST.
    expect(operatorDay(new Date("2026-08-14T23:30:00Z"))).toBe("2026-08-15");
  });

  it("returns the LONDON day for an instant just before that boundary", () => {
    // 22:30Z the same evening is still 23:30 on the 14th in London, so the two
    // cases together pin the boundary rather than one side of it.
    expect(operatorDay(new Date("2026-08-14T22:30:00Z"))).toBe("2026-08-14");
  });

  it("agrees with UTC in winter, when London carries no offset", () => {
    // GMT, so 23:30Z is 23:30 local and the day does not roll. A formatter that
    // hardcoded +1 rather than reading the zone would fail here.
    expect(operatorDay(new Date("2026-01-14T23:30:00Z"))).toBe("2026-01-14");
  });

  it("zero-pads to YYYY-MM-DD, which is what makes plain string comparison correct", () => {
    // jobs.scheduled_date arrives as "YYYY-MM-DD" and is compared with < and >
    // against this. "2026-1-5" would compare wrongly against "2026-01-05".
    expect(operatorDay(new Date("2026-01-05T09:00:00Z"))).toBe("2026-01-05");
  });
});

describe("OPERATOR_TIME_ZONE", () => {
  it("is Europe/London until company_profiles.timezone is plumbed through", () => {
    expect(OPERATOR_TIME_ZONE).toBe("Europe/London");
  });
});
