import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_ACCESS_VEHICLES,
  escapeLikePattern,
  leadClientKey,
  normalizeLeadEmail,
  vehicleCountError,
} from "./leadIntake";

describe("normalizeLeadEmail", () => {
  it("trims and lowercases so dedupe and the email limit ignore case", () => {
    expect(normalizeLeadEmail("  Sales@Haulier.co.UK ")).toBe("sales@haulier.co.uk");
  });
});

describe("vehicleCountError", () => {
  it("accepts a realistic fleet and the ceiling itself", () => {
    expect(vehicleCountError(12)).toBeNull();
    expect(vehicleCountError(MAX_REQUEST_ACCESS_VEHICLES)).toBeNull();
  });

  it.each([MAX_REQUEST_ACCESS_VEHICLES + 1, 99999999999, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects %s",
    (value) => {
      expect(vehicleCountError(value)).not.toBeNull();
    },
  );
});

describe("escapeLikePattern", () => {
  it("escapes wildcards and backslashes", () => {
    expect(escapeLikePattern("a_b%c\\d@x.com")).toBe("a\\_b\\%c\\\\d@x.com");
  });

  it("leaves an ordinary address alone", () => {
    expect(escapeLikePattern("ops@haulier.co.uk")).toBe("ops@haulier.co.uk");
  });
});

describe("leadClientKey", () => {
  const fallback = () => "from-fallback";

  it("prefers the platform header", () => {
    const headers = new Headers({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "9.9.9.9" });
    expect(leadClientKey(headers, fallback)).toBe("1.1.1.1");
  });

  it("uses x-real-ip next", () => {
    expect(leadClientKey(new Headers({ "x-real-ip": "2.2.2.2" }), fallback)).toBe("2.2.2.2");
  });

  it("falls back when no platform header is present", () => {
    expect(leadClientKey(new Headers(), fallback)).toBe("from-fallback");
  });
});
