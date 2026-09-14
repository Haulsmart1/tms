import { describe, expect, it } from "vitest";

import { quotationShareExpiry, startOfDayInZoneMs } from "./shareExpiry";

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("startOfDayInZoneMs", () => {
  it("finds London midnight in BST and in GMT", () => {
    expect(startOfDayInZoneMs("2026-07-02")).toBe(Date.parse("2026-07-01T23:00:00Z"));
    expect(startOfDayInZoneMs("2026-12-02")).toBe(Date.parse("2026-12-02T00:00:00Z"));
  });

  it("handles the days either side of a clock change", () => {
    expect(startOfDayInZoneMs("2026-03-29")).toBe(Date.parse("2026-03-29T00:00:00Z"));
    expect(startOfDayInZoneMs("2026-03-30")).toBe(Date.parse("2026-03-29T23:00:00Z"));
    expect(startOfDayInZoneMs("2026-10-25")).toBe(Date.parse("2026-10-24T23:00:00Z"));
    expect(startOfDayInZoneMs("2026-10-26")).toBe(Date.parse("2026-10-26T00:00:00Z"));
  });

  it("rejects a non-date", () => {
    expect(startOfDayInZoneMs("2026-02-30")).toBeNull();
  });
});

describe("quotationShareExpiry", () => {
  const now = new Date("2026-07-01T09:00:00Z");

  it("expires at the end of valid_until in London, not UTC (BST)", () => {
    expect(quotationShareExpiry({ validUntil: "2026-07-01", fallbackLifetimeSeconds: 60, now })).toEqual({
      ok: true,
      expiresAt: seconds("2026-07-01T22:59:59Z"),
    });
  });

  it("expires at UTC midnight in winter", () => {
    const winter = new Date("2026-12-01T09:00:00Z");
    expect(quotationShareExpiry({ validUntil: "2026-12-01", fallbackLifetimeSeconds: 60, now: winter })).toEqual({
      ok: true,
      expiresAt: seconds("2026-12-01T23:59:59Z"),
    });
  });

  it("refuses a quotation whose last London day has already ended", () => {
    const lateEvening = new Date("2026-07-01T23:30:00Z"); // 00:30 on 2 July in London
    expect(
      quotationShareExpiry({ validUntil: "2026-07-01", fallbackLifetimeSeconds: 60, now: lateEvening }),
    ).toEqual({ ok: false, reason: "quotation_expired" });
  });

  it("uses the fallback lifetime without a valid_until, and caps at the max lifetime", () => {
    const nowSeconds = seconds("2026-07-01T09:00:00Z");
    expect(quotationShareExpiry({ validUntil: null, fallbackLifetimeSeconds: 600, now })).toEqual({
      ok: true,
      expiresAt: nowSeconds + 600,
    });
    expect(
      quotationShareExpiry({ validUntil: "2026-09-01", fallbackLifetimeSeconds: 600, maxLifetimeSeconds: 3600, now }),
    ).toEqual({ ok: true, expiresAt: nowSeconds + 3600 });
  });

  it("reports an invalid date", () => {
    expect(quotationShareExpiry({ validUntil: "not-a-date", fallbackLifetimeSeconds: 60, now })).toEqual({
      ok: false,
      reason: "invalid_valid_until",
    });
  });
});
