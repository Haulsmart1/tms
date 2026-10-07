import { describe, expect, it } from "vitest";
import {
  evaluateTrackingLink,
  generateTrackingToken,
  hashTrackingToken,
  isWellFormedTrackingToken,
  trackingLinkExpiry,
} from "./links";

describe("tracking tokens", () => {
  it("mints well-formed, distinct tokens", () => {
    const a = generateTrackingToken();
    const b = generateTrackingToken();
    expect(isWellFormedTrackingToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith("trk_")).toBe(true);
  });

  it("refuses anything else, including POD share tokens", () => {
    for (const value of [undefined, "", "trk_short", `pod_${"a".repeat(43)}`, `trk_${"a".repeat(43)}/x`]) {
      expect(isWellFormedTrackingToken(value)).toBe(false);
    }
  });

  it("hashes to 64 hex characters, deterministically", () => {
    const token = generateTrackingToken();
    expect(hashTrackingToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTrackingToken(token)).toBe(hashTrackingToken(token));
  });
});

describe("trackingLinkExpiry", () => {
  const now = new Date("2026-10-07T09:00:00.000Z");

  it("lasts until the end of the planned date plus two days", () => {
    expect(trackingLinkExpiry("2026-10-08", now)).toBe("2026-10-11T00:00:00.000Z");
  });

  it("lasts at least 24 hours when the planned date is in the past", () => {
    expect(trackingLinkExpiry("2026-09-01", now)).toBe("2026-10-08T09:00:00.000Z");
  });

  it("lasts 7 days with no planned date", () => {
    expect(trackingLinkExpiry(null, now)).toBe("2026-10-14T09:00:00.000Z");
    expect(trackingLinkExpiry("not-a-date", now)).toBe("2026-10-14T09:00:00.000Z");
  });
});

describe("evaluateTrackingLink", () => {
  const now = new Date("2026-10-07T09:00:00.000Z");
  it("accepts a live link and refuses revoked, expired and missing ones", () => {
    expect(evaluateTrackingLink({ expires_at: "2026-10-08T00:00:00.000Z", revoked_at: null }, now)).toBe(true);
    expect(evaluateTrackingLink({ expires_at: "2026-10-08T00:00:00.000Z", revoked_at: "2026-10-07T08:00:00.000Z" }, now)).toBe(false);
    expect(evaluateTrackingLink({ expires_at: "2026-10-07T09:00:00.000Z", revoked_at: null }, now)).toBe(false);
    expect(evaluateTrackingLink(null, now)).toBe(false);
  });
});
